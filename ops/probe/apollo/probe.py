"""Apollo probe harness — budget, cooldown, abort-on-block.

The safety rails matter more than the measurements: a block costs more than the
information the mission would have gathered. See README.md and
docs/superpowers/plans/2026-08-06-apollo-probe-homeharvest.md.
"""
from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any, Callable

RESULTS = Path(__file__).parent / "results"
PAGE_SIZE = 200  # homeharvest pages the GraphQL query at limit:200


class BudgetExhausted(RuntimeError):
    pass


class MissionAborted(RuntimeError):
    pass


@dataclass
class ProbeResult:
    location: str
    shape: str
    rows: int = 0
    distinct_zips: int = 0
    wall_s: float = 0.0
    est_http_requests: int = 0
    blocked: bool = False
    error: str | None = None
    truncated: bool = False
    sample: dict[str, Any] | None = None


class Budget:
    """Denominated in ESTIMATED HTTP REQUESTS, not library calls.

    One scrape_property() call costs ceil(rows/200) requests internally, so
    counting library calls would understate a state query by ~50x.
    """

    def __init__(self, max_requests: int = 60) -> None:
        self.max_requests = max_requests
        self.spent = 0

    def spend(self, n: int = 1) -> None:
        if self.spent + n > self.max_requests:
            raise BudgetExhausted(f"budget {self.max_requests} exhausted (spent {self.spent}, wanted {n})")
        self.spent += n

    def remaining(self) -> int:
        return self.max_requests - self.spent


class Mission:
    def __init__(self, budget: Budget | None = None, min_delay_s: float = 20.0) -> None:
        self.budget = budget or Budget()
        self.min_delay_s = min_delay_s
        self.aborted = False
        self.results: list[ProbeResult] = []
        self._last_request_at: float | None = None

    def next_delay(self) -> float:
        return self.min_delay_s

    def record(self, r: ProbeResult, path: Path | None = None) -> None:
        # Write BEFORE analysis so an abort still leaves the evidence.
        self.results.append(r)
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a") as fh:
                fh.write(json.dumps(asdict(r)) + "\n")
        if r.blocked:
            self.aborted = True

    def guard(self) -> None:
        if self.aborted:
            raise MissionAborted("mission aborted after a block — no further requests")

    def wait(self) -> None:
        if self._last_request_at is not None:
            elapsed = time.time() - self._last_request_at
            if elapsed < self.min_delay_s:
                time.sleep(self.min_delay_s - elapsed)
        self._last_request_at = time.time()


def estimate_requests(rows: int) -> int:
    return max(1, math.ceil(rows / PAGE_SIZE))


def is_blocked(exc: Exception | None) -> bool:
    """Reuse the production taxonomy rather than inventing a second one."""
    if exc is None:
        return False
    t = f"{type(exc).__name__}: {exc}".lower()
    return any(s in t for s in ("403", "forbidden", "authentication", "429", "captcha", "challenge"))


def run_probe(
    mission: Mission,
    location: str,
    shape: str,
    scraper: Callable[..., Any],
    out: Path,
    **kw: Any,
) -> ProbeResult:
    mission.guard()
    mission.wait()

    t0 = time.time()
    exc: Exception | None = None
    df = None
    try:
        df = scraper(location=location, parallel=False, extra_property_data=False, **kw)
    except Exception as e:  # noqa: BLE001 — any failure is a datapoint
        exc = e

    rows = 0 if df is None else len(df)
    zips = 0
    sample = None
    if rows:
        try:
            zips = int(df["zip_code"].nunique())
            sample = {k: str(v)[:60] for k, v in df.iloc[0].head(8).to_dict().items()}
        except Exception:
            pass

    r = ProbeResult(
        location=location,
        shape=shape,
        rows=rows,
        distinct_zips=zips,
        wall_s=round(time.time() - t0, 2),
        est_http_requests=estimate_requests(rows),
        blocked=is_blocked(exc),
        error=None if exc is None else f"{type(exc).__name__}: {exc}"[:300],
        truncated=(rows >= kw.get("limit", 10000)),
        sample=sample,
    )
    mission.record(r, out)
    if not r.blocked:
        mission.budget.spend(r.est_http_requests)
    return r
