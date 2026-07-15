"""Unit tests for route_row_type() — the demux routing used when a combined
[for_sale, for_rent] homeharvest query returns mixed-status rows.

conftest.py stubs homeharvest/psycopg2/dotenv so `import main` works without
those heavy/native deps.
"""
import pytest

from main import route_row_type, _FOR_SALE_STATUSES


class TestCombinedRouting:
    """is_combined=True -> route on the row's own `status`."""

    def test_for_rent_goes_to_rental(self):
        assert route_row_type("for_rent", True, ["for_sale", "for_rent"]) == "for_rent"

    def test_sold_goes_to_sold(self):
        assert route_row_type("sold", True, ["for_sale", "for_rent"]) == "sold"

    def test_for_sale_goes_to_listings(self):
        assert route_row_type("for_sale", True, ["for_sale", "for_rent"]) == "for_sale"

    @pytest.mark.parametrize("status", ["FOR_RENT", "For_Rent", " for_rent ", "rent"])
    def test_rent_matching_is_case_and_whitespace_insensitive(self, status):
        assert route_row_type(status, True, ["for_sale", "for_rent"]) == "for_rent"

    @pytest.mark.parametrize(
        "status",
        ["pending", "contingent", "off_market", "ready_to_build", "other", "active", ""],
    )
    def test_unexpected_or_pending_statuses_fall_back_to_for_sale(self, status):
        # These must never be silently dropped — they land in listings.
        assert route_row_type(status, True, ["for_sale", "for_rent"]) == "for_sale"

    def test_none_status_falls_back_to_for_sale(self):
        assert route_row_type(None, True, ["for_sale", "for_rent"]) == "for_sale"


class TestSingleTypeRouting:
    """is_combined=False -> trust the request (legacy passes unchanged)."""

    @pytest.mark.parametrize("lt", ["for_sale", "for_rent", "sold", "pending"])
    def test_single_type_ignores_row_status(self, lt):
        # Even if the row status disagrees, single-type passes route by request.
        assert route_row_type("sold", False, lt) == lt


def test_for_sale_status_set_sanity():
    # pending/contingent are intentionally treated as for_sale-side rows.
    assert "pending" in _FOR_SALE_STATUSES
    assert "contingent" in _FOR_SALE_STATUSES
    assert "for_rent" not in _FOR_SALE_STATUSES
    assert "sold" not in _FOR_SALE_STATUSES
