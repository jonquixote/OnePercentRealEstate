"""Unit tests for normalize_row() — the pure normalization function in scraper.py."""
import json
import math
import sys
import os

import pandas as pd
import pytest

# Add services/ to path so we can import scraper
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from scraper import normalize_row


@pytest.fixture
def for_sale_row():
    """For-sale row with schools, tax_history, and agent info."""
    return {
        "street": "123 Main St",
        "city": "Austin",
        "state": "TX",
        "zip_code": "78701",
        "list_price": 450000.0,
        "beds": 3,
        "full_baths": 2,
        "half_baths": 1,
        "baths": 2.5,  # pre-calculated like run_scraper does
        "sqft": 1800,
        "year_built": 2005,
        "style": "Single Family",
        "listing_id": "MLS-12345",
        "status": "FOR_SALE",
        "days_on_mls": 12,
        "hoa_fee": 250.0,
        "tax_annual_amount": 5400.0,
        "agent_name": "Jane Doe",
        "agent_email": "jane@example.com",
        "agent_phones": "512-555-1234",
        "broker_name": "Best Realty",
        "office_name": "Best Realty Austin",
        "lot_sqft": 8712,
        "stories": 2,
        "garage_spaces": 2,
        "parking_garage": True,
        "fips_code": "48453",
        "neighborhoods": "Downtown",
        "new_construction": False,
        "nearby_schools": [
            {"name": "Austin HS", "rating": 8, "distance_mi": 0.5},
            {"name": "Downtown Elem", "rating": 7, "distance_mi": 0.3},
        ],
        "tax_history": [
            {"year": 2024, "tax": 5400},
            {"year": 2023, "tax": 5200},
        ],
        "primary_photo": "https://img.example.com/photo1.jpg",
        "alt_photos": "https://img.example.com/a.jpg, https://img.example.com/b.jpg",
        "latitude": 30.2672,
        "longitude": -97.7431,
    }


@pytest.fixture
def for_rent_row():
    """Minimal for-rent row — no schools, no tax_history, no agent."""
    return {
        "street": "456 Oak Ave",
        "city": "Denver",
        "state": "CO",
        "zip_code": "80202",
        "list_price": 2200.0,
        "beds": 2,
        "full_baths": 1,
        "half_baths": 0,
        "baths": 1.0,
        "sqft": 900,
        "year_built": 1998,
        "listing_id": "MLS-67890",
        "status": "FOR_RENT",
        "fips_code": "08031",
        "latitude": 39.7392,
        "longitude": -104.9903,
    }


@pytest.fixture
def sold_row_nan_heavy():
    """Sold row with NaN everywhere — tests guard logic."""
    return {
        "street": "789 Pine Rd",
        "city": "Seattle",
        "state": "WA",
        "zip_code": float("nan"),
        "list_price": float("nan"),
        "beds": float("nan"),
        "full_baths": float("nan"),
        "half_baths": float("nan"),
        "baths": 0,
        "sqft": float("nan"),
        "year_built": float("nan"),
        "style": float("nan"),
        "listing_id": float("nan"),
        "status": "SOLD",
        "days_on_mls": float("nan"),
        "hoa_fee": float("nan"),
        "tax_annual_amount": float("nan"),
        "agent_name": float("nan"),
        "agent_email": float("nan"),
        "agent_phones": float("nan"),
        "broker_name": float("nan"),
        "office_name": float("nan"),
        "lot_sqft": float("nan"),
        "stories": float("nan"),
        "garage_spaces": float("nan"),
        "parking_garage": float("nan"),
        "fips_code": float("nan"),
        "neighborhoods": float("nan"),
        "new_construction": float("nan"),
        "nearby_schools": float("nan"),
        "tax_history": float("nan"),
        "latitude": float("nan"),
        "longitude": float("nan"),
        "sold_price": 500000.0,
        "last_sold_date": "2025-06-15",
    }


class TestNormalizeRow:
    """Tests for the normalize_row() pure function."""

    def test_for_sale_jsonb_fields(self, for_sale_row):
        result = normalize_row(for_sale_row, "for_sale")

        # nearby_schools should be serialized JSON
        schools = json.loads(result["nearby_schools"])
        assert isinstance(schools, list)
        assert len(schools) == 2
        assert schools[0]["name"] == "Austin HS"

        # tax_history should be serialized JSON
        tax = json.loads(result["tax_history"])
        assert isinstance(tax, list)
        assert tax[0]["year"] == 2024

        # agent_info should be serialized JSON (for-sale only)
        agent = json.loads(result["agent_info"])
        assert agent["agent_name"] == "Jane Doe"
        assert agent["agent_email"] == "jane@example.com"
        assert agent["broker_name"] == "Best Realty"

    def test_for_sale_fips_preserves_leading_zeros(self, for_sale_row):
        for_sale_row["fips_code"] = "01001"
        result = normalize_row(for_sale_row, "for_sale")
        assert result["fips_code"] == "01001"

    def test_for_rent_has_nearby_schools(self, for_rent_row):
        for_rent_row["nearby_schools"] = [{"name": "Park Elem", "rating": 6}]
        result = normalize_row(for_rent_row, "for_rent")
        schools = json.loads(result["nearby_schools"])
        assert schools[0]["name"] == "Park Elem"

    def test_for_rent_no_agent_info(self, for_rent_row):
        for_rent_row["agent_name"] = "John Agent"
        result = normalize_row(for_rent_row, "for_rent")
        assert "agent_info" not in result

    def test_sold_nan_to_none(self, sold_row_nan_heavy):
        result = normalize_row(sold_row_nan_heavy, "sold")

        # NaN fields should be None
        assert result["zip_code"] == ""
        assert result["bedrooms"] is None
        assert result["bathrooms"] == 0
        assert result["sqft"] is None
        assert result["year_built"] is None
        assert result["stories"] is None
        assert result["parking_garage"] is None
        assert result["fips_code"] is None
        assert result["neighborhoods"] is None
        assert result["new_construction"] is None
        assert result["nearby_schools"] is None
        assert result["tax_history"] is None

    def test_unknown_keys_ignored(self, for_sale_row):
        for_sale_row["unknown_field"] = "should not crash"
        for_sale_row["another_extra"] = 42
        result = normalize_row(for_sale_row, "for_sale")
        assert "unknown_field" not in result
        assert "another_extra" not in result

    def test_neighborhoods_stringified(self, for_sale_row):
        result = normalize_row(for_sale_row, "for_sale")
        assert result["neighborhoods"] == "Downtown"

    def test_price_from_list_price(self, for_sale_row):
        result = normalize_row(for_sale_row, "for_sale")
        assert result["price"] == 450000.0

    def test_images_from_primary_and_alt(self, for_sale_row):
        result = normalize_row(for_sale_row, "for_sale")
        assert len(result["images"]) == 3
        assert result["images"][0] == "https://img.example.com/photo1.jpg"
