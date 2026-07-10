"""Unit tests for the PadMapper adapter."""
import datetime as dt
import sys
import os

import pytest

# Add services/scraper_service to path
sys.path.insert(0, os.path.dirname(__file__))

from adapters.padmapper import normalize, MIN_PRICE_FLOOR


@pytest.fixture
def complete_listable():
    """A fully populated PadMapper listable."""
    return {
        "min_price": 1500,
        "max_price": 1800,
        "min_bedrooms": 2,
        "min_bathrooms": 1.5,
        "min_square_feet": 850,
        "lat": 40.7128,
        "lng": -74.0060,
        "formatted_address": "123 Main St, New York, NY 10001",
        "listing_type": "apartment",
        "building_name": "Main St Apartments",
        "city": "New York",
        "pet_policies": "cats_only",
    }


@pytest.fixture
def missing_address_listable():
    """Listable with no address and no building_name/city."""
    return {
        "min_price": 1200,
        "min_bedrooms": 1,
        "min_bathrooms": 1,
        "lat": 40.7128,
        "lng": -74.0060,
        "listing_type": "apartment",
    }


@pytest.fixture
def low_price_listable():
    """Listable with price below the floor."""
    return {
        "min_price": 150,
        "min_bedrooms": 1,
        "min_bathrooms": 1,
        "formatted_address": "456 Low St, Anytown, USA 12345",
        "lat": 40.7128,
        "lng": -74.0060,
    }


@pytest.fixture
def price_range_listable():
    """Listable with price range (min_price and max_price)."""
    return {
        "min_price": 1000,
        "max_price": 1500,
        "min_bedrooms": 1,
        "min_bathrooms": 1,
        "formatted_address": "789 Range Rd, Sometown, USA 54321",
        "lat": 34.0522,
        "lng": -118.2437,
    }


class TestNormalize:
    """Tests for the normalize() function."""

    def test_complete_listable(self, complete_listable):
        """Test a fully populated listable maps to correct fields."""
        result = normalize(complete_listable)

        assert result is not None
        assert result["address"] == "123 Main St, New York, NY 10001"
        assert result["price"] == 1500  # uses min_price
        assert result["bedrooms"] == 2
        assert result["bathrooms"] == 1.5
        assert result["sqft"] == 850
        assert result["latitude"] == 40.7128
        assert result["longitude"] == -74.0060
        assert result["property_type"] == "apartment"
        assert result["building_name"] == "Main St Apartments"
        assert result["pet_policies"] == "cats_only"
        assert result["source"] == "padmapper"
        assert result["listing_date"] == dt.date.today().isoformat()

    def test_missing_address_returns_none(self, missing_address_listable):
        """Test that missing address with no fallback returns None."""
        result = normalize(missing_address_listable)
        assert result is None

    def test_price_below_floor_returns_none(self, low_price_listable):
        """Test that price below MIN_PRICE_FLOOR returns None."""
        assert MIN_PRICE_FLOOR == 300
        result = normalize(low_price_listable)
        assert result is None

    def test_price_uses_min_price(self, price_range_listable):
        """Test that when both min_price and max_price exist, min_price is used."""
        result = normalize(price_range_listable)

        assert result is not None
        assert result["price"] == 1000  # min_price, not max_price

    def test_source_is_padmapper(self, complete_listable):
        """Test that source field is always 'padmapper'."""
        result = normalize(complete_listable)
        assert result["source"] == "padmapper"

    def test_listing_date_is_today(self, complete_listable):
        """Test that listing_date is set to today."""
        result = normalize(complete_listable)
        assert result["listing_date"] == dt.date.today().isoformat()

    def test_missing_price_returns_none(self):
        """Test that missing price returns None."""
        listable = {
            "min_bedrooms": 1,
            "min_bathrooms": 1,
            "formatted_address": "123 Test St, Testville, USA 12345",
        }
        result = normalize(listable)
        assert result is None

    def test_non_numeric_price_returns_none(self):
        """Test that non-numeric price returns None."""
        listable = {
            "min_price": "invalid",
            "min_bedrooms": 1,
            "min_bathrooms": 1,
            "formatted_address": "123 Test St, Testville, USA 12345",
        }
        result = normalize(listable)
        assert result is None

    def test_fallback_to_building_name(self):
        """Test fallback to building_name when formatted_address is missing."""
        listable = {
            "min_price": 1000,
            "min_bedrooms": 1,
            "min_bathrooms": 1,
            "building_name": "Oak Apartments",
            "city": "Portland",
            "lat": 45.5152,
            "lng": -122.6784,
        }
        result = normalize(listable)
        assert result is not None
        assert result["address"] == "Oak Apartments, Portland"

    def test_fallback_to_building_name_only(self):
        """Test fallback to building_name only when city is missing."""
        listable = {
            "min_price": 1000,
            "min_bedrooms": 1,
            "min_bathrooms": 1,
            "building_name": "Oak Apartments",
            "lat": 45.5152,
            "lng": -122.6784,
        }
        result = normalize(listable)
        assert result is not None
        assert result["address"] == "Oak Apartments"

    def test_fallback_to_city_only(self):
        """Test fallback to city when building_name and formatted_address are missing."""
        listable = {
            "min_price": 1000,
            "min_bedrooms": 1,
            "min_bathrooms": 1,
            "city": "Seattle",
            "lat": 47.6062,
            "lng": -122.3321,
        }
        result = normalize(listable)
        assert result is not None
        assert result["address"] == "Seattle"

    def test_numeric_conversion_error_returns_none(self):
        """Test that non-numeric bedrooms/bathrooms returns None for those fields."""
        listable = {
            "min_price": 1000,
            "min_bedrooms": "invalid",
            "min_bathrooms": "invalid",
            "formatted_address": "123 Test St, Testville, USA 12345",
        }
        result = normalize(listable)
        assert result is not None
        assert result["bedrooms"] is None
        assert result["bathrooms"] is None

    def test_missing_optional_fields(self):
        """Test that missing optional fields (sqft, etc.) are None."""
        listable = {
            "min_price": 1000,
            "min_bedrooms": 1,
            "min_bathrooms": 1,
            "formatted_address": "123 Test St, Testville, USA 12345",
        }
        result = normalize(listable)
        assert result is not None
        assert result["sqft"] is None
        assert result["building_name"] is None
        assert result["pet_policies"] is None
