from main import is_rental_url, route_row_type

def test_rental_details_url_is_rental():
    assert is_rental_url("https://www.realtor.com/rentals/details/2831-S-Bayshore-Dr...") is True

def test_sale_url_is_not_rental():
    assert is_rental_url("https://www.realtor.com/realestateandhomes-detail/225-Sun-Ter...") is False
    assert is_rental_url(None) is False

def test_url_overrides_pending_pass():
    # The exact prod bug: pending pass returns a rental row.
    assert route_row_type("PENDING", False, "pending",
                          property_url="https://www.realtor.com/rentals/details/x") == "for_rent"

def test_no_url_keeps_legacy_behavior():
    assert route_row_type("PENDING", False, "pending", property_url=None) == "pending"

def test_combined_rental_status_with_rental_url_routes_rental():
    assert route_row_type("FOR_RENT", True, ["for_sale", "for_rent"],
                          property_url="https://www.realtor.com/rentals/details/x") == "for_rent"

def test_url_wins_over_for_sale_looking_status_on_combined_pass():
    # Even when a COMBINED row carries a for-sale-looking status, the URL wins.
    assert route_row_type("PENDING", True, ["for_sale", "for_rent"],
                          property_url="https://www.realtor.com/rentals/details/x") == "for_rent"
