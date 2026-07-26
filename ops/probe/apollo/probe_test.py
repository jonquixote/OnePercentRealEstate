import json
import pytest
from pathlib import Path
from probe import Budget, BudgetExhausted, Mission, MissionAborted, ProbeResult, estimate_requests, is_blocked, run_probe


def test_budget_counts_http_requests_not_library_calls():
    assert estimate_requests(1) == 1
    assert estimate_requests(200) == 1
    assert estimate_requests(201) == 2
    assert estimate_requests(10000) == 50  # a state query is ~50 requests, not one


def test_budget_is_enforced():
    b = Budget(max_requests=3)
    b.spend(2)
    with pytest.raises(BudgetExhausted):
        b.spend(2)


def test_block_aborts_the_mission():
    m = Mission()
    m.record(ProbeResult(location="x", shape="zip", blocked=True))
    assert m.aborted is True
    with pytest.raises(MissionAborted):
        m.guard()


def test_results_are_written_before_analysis(tmp_path: Path):
    m = Mission()
    out = tmp_path / "r.jsonl"
    m.record(ProbeResult(location="85281", shape="zip", rows=5), out)
    assert json.loads(out.read_text().strip())["location"] == "85281"


def test_minimum_delay_between_requests():
    assert Mission(min_delay_s=20).next_delay() >= 20


def test_block_detection_covers_the_documented_signals():
    assert is_blocked(Exception("Received 403 Forbidden from Realtor.com API."))
    assert is_blocked(Exception("429 Too Many Requests"))
    assert is_blocked(None) is False
    assert is_blocked(Exception("Read timed out")) is False  # transient, not a block


def test_a_blocked_probe_does_not_spend_budget(tmp_path: Path):
    m = Mission(Budget(max_requests=10), min_delay_s=0)
    def boom(**kw): raise Exception("Received 403 Forbidden")
    r = run_probe(m, "85281", "zip", boom, tmp_path / "r.jsonl")
    assert r.blocked and m.aborted and m.budget.spent == 0


def test_a_successful_probe_spends_estimated_requests(tmp_path: Path):
    import pandas as pd
    m = Mission(Budget(max_requests=10), min_delay_s=0)
    df = pd.DataFrame({"zip_code": ["85281"] * 400})
    r = run_probe(m, "Tempe, AZ", "city", lambda **kw: df, tmp_path / "r.jsonl")
    assert r.rows == 400 and r.est_http_requests == 2 and m.budget.spent == 2
