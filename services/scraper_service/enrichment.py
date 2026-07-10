"""Map a homeharvest DataFrame row (as a dict) to typed enrichment columns.

Kept pure + dependency-free (no pandas) so it is unit-testable and reused by
both the live scraper insert and any future re-processing. The scraper already
NaN-normalizes raw_data before calling us, but we defend anyway."""
from __future__ import annotations

import datetime as dt
import json
import re
from typing import Any, Optional

_NUM_RE = re.compile(r"[^0-9.\-]")


def _num(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return None if v != v or v < 0 else float(v)  # v!=v catches NaN, v<0 rejects negatives
    s = str(v).strip()
    if not s or s.lower() in ("nan", "none", "n/a", "null"):
        return None
    s = _NUM_RE.sub("", s)
    if s in ("", "-", ".", "-."):
        return None
    try:
        val = float(s)
        return None if val < 0 else val
    except ValueError:
        return None


def _date(v: Any) -> Optional[dt.date]:
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    s = str(v).strip()
    if not s or s.lower() in ("nan", "none", "null"):
        return None
    try:
        return dt.date.fromisoformat(s[:10])
    except ValueError:
        return None


def _text(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, (list, tuple)):
        parts = [str(x).strip() for x in v if x is not None and str(x).strip()]
        return ", ".join(parts) or None
    s = str(v).strip()
    if not s or s.lower() in ("nan", "none", "null"):
        return None
    return s


def _bool(v: Any) -> Optional[bool]:
    if v is None or (isinstance(v, float) and v != v):
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) and v in (0, 1):
        return bool(v)
    s = str(v).strip().lower()
    if s in ("true", "t", "1", "yes"):
        return True
    if s in ("false", "f", "0", "no"):
        return False
    return None


def extract_enrichment(row: dict) -> dict:
    return {
        "county": _text(row.get("county")),
        "fips_code": _text(row.get("fips_code")),
        "neighborhoods": _text(row.get("neighborhoods")),
        "last_sold_price": _num(row.get("last_sold_price")),
        "last_sold_date": _date(row.get("last_sold_date")),
        "assessed_value": _num(row.get("assessed_value")),
        "estimated_value": _num(row.get("estimated_value")),
        "description": _text(row.get("text")),  # homeharvest calls it 'text'
        "style": _text(row.get("style")),
        "new_construction": _bool(row.get("new_construction")),
        "list_date": _date(row.get("list_date")),
        "price_per_sqft": _num(row.get("price_per_sqft")),
        "hoa_fee": _num(row.get("hoa_fee")),
        "tax_annual_amount": _num(row.get("tax")),  # homeharvest calls it 'tax'
        "property_url": _text(row.get("property_url")),
        "parking_garage": _bool(row.get("parking_garage")),
        "lot_sqft": _num(row.get("lot_sqft")),
        "stories": _num(row.get("stories")),
        "nearby_schools": _json(row.get("nearby_schools")),
        "agent_info": _agent_info(row),
        "tax_history": _json(row.get("tax_history")),
    }


def _json(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, (list, dict)):
        return json.dumps(v)
    return None


def _agent_info(row: dict) -> Optional[str]:
    fields = ("agent_name", "agent_email", "broker_name", "office_name")
    data = {k: row.get(k) for k in fields if row.get(k) is not None}
    return json.dumps(data) if data else None
