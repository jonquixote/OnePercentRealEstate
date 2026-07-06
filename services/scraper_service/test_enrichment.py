import datetime as dt
from enrichment import extract_enrichment


def test_maps_and_types_a_full_homeharvest_row():
    row = {
        "county": "Harris", "fips_code": "48201",
        "neighborhoods": "Montrose, Midtown",
        "last_sold_price": "250000", "last_sold_date": "2019-06-01",
        "assessed_value": 210000.0, "estimated_value": 305000.0,
        "text": "Charming bungalow.", "style": "SINGLE_FAMILY",
        "new_construction": False, "list_date": "2026-07-01",
        "price_per_sqft": 180, "hoa_fee": "45", "tax": 5400.0,
        "property_url": "https://realtor.com/x",
        "parking_garage": True, "lot_sqft": "5000",
    }
    out = extract_enrichment(row)
    assert out["county"] == "Harris"
    assert out["fips_code"] == "48201"
    assert out["neighborhoods"] == "Montrose, Midtown"
    assert out["last_sold_price"] == 250000.0
    assert out["last_sold_date"] == dt.date(2019, 6, 1)
    assert out["estimated_value"] == 305000.0
    assert out["description"] == "Charming bungalow."
    assert out["style"] == "SINGLE_FAMILY"
    assert out["new_construction"] is False
    assert out["list_date"] == dt.date(2026, 7, 1)
    assert out["price_per_sqft"] == 180.0
    assert out["hoa_fee"] == 45.0
    assert out["tax_annual_amount"] == 5400.0
    assert out["property_url"] == "https://realtor.com/x"
    assert out["parking_garage"] is True
    assert out["lot_sqft"] == 5000.0


def test_missing_and_nan_become_none():
    row = {"county": None, "tax": float("nan"), "hoa_fee": "", "last_sold_date": "nan"}
    out = extract_enrichment(row)
    assert out["county"] is None
    assert out["tax_annual_amount"] is None
    assert out["hoa_fee"] is None
    assert out["last_sold_date"] is None
    assert out["property_url"] is None  # absent key


def test_neighborhoods_list_is_joined():
    assert extract_enrichment({"neighborhoods": ["A", "B"]})["neighborhoods"] == "A, B"


def test_bad_numbers_do_not_raise():
    out = extract_enrichment({"price_per_sqft": "N/A", "assessed_value": "$210,000"})
    assert out["price_per_sqft"] is None
    assert out["assessed_value"] == 210000.0  # currency stripped


def test_parking_garage_bool_conversion():
    assert extract_enrichment({"parking_garage": True})["parking_garage"] is True
    assert extract_enrichment({"parking_garage": "true"})["parking_garage"] is True
    assert extract_enrichment({"parking_garage": "1"})["parking_garage"] is True
    assert extract_enrichment({"parking_garage": "yes"})["parking_garage"] is True
    assert extract_enrichment({"parking_garage": False})["parking_garage"] is False
    assert extract_enrichment({"parking_garage": "false"})["parking_garage"] is False
    assert extract_enrichment({"parking_garage": "0"})["parking_garage"] is False
    assert extract_enrichment({"parking_garage": None})["parking_garage"] is None
