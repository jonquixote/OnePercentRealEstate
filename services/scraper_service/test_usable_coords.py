from main import usable_coords

# The source supplies latitude/longitude on 97.3% of rows (measured over 20,000
# for_sale rows seen in 48h). The scraper used to geocode every row anyway and
# treat those coordinates as a fallback, so every sweep re-resolved addresses it
# had already been handed — through a Nominatim path that sleeps 1.1 s per
# address, sequentially. That was the dense-ZIP tail: 39 ZIPs consuming 19.1% of
# all crawl runner time, every one hitting the 240 s timeout.
#
# usable_coords is what decides whether a row can skip geocoding, so it has to
# be strict about what counts as a real location.


def test_plain_coordinates_are_usable():
    assert usable_coords(29.7604, -95.3698) == (29.7604, -95.3698)


def test_numeric_strings_are_accepted():
    # homeharvest hands these back through pandas; they arrive as strings often
    # enough that rejecting them would silently re-enable the slow path.
    assert usable_coords("29.7604", "-95.3698") == (29.7604, -95.3698)


def test_missing_coordinates_fall_through_to_geocoding():
    assert usable_coords(None, None) is None
    assert usable_coords(29.7604, None) is None
    assert usable_coords(None, -95.3698) is None


def test_nan_falls_through_to_geocoding():
    nan = float("nan")
    assert usable_coords(nan, nan) is None
    assert usable_coords(29.7604, nan) is None


def test_null_island_is_rejected():
    # (0, 0) is the classic "no idea" sentinel. Trusting it would plant listings
    # in the Gulf of Guinea instead of sending them to the geocoder.
    assert usable_coords(0, 0) is None
    assert usable_coords(0.0, 0.0) is None


def test_a_real_zero_on_one_axis_is_still_usable():
    # Only the pair (0, 0) is the sentinel. A genuine zero on one axis is a
    # real place and must not be thrown away.
    assert usable_coords(0.0, -95.3698) == (0.0, -95.3698)
    assert usable_coords(29.7604, 0.0) == (29.7604, 0.0)


def test_out_of_range_is_rejected():
    assert usable_coords(91.0, 0.5) is None
    assert usable_coords(-91.0, 0.5) is None
    assert usable_coords(45.0, 181.0) is None
    assert usable_coords(45.0, -181.0) is None


def test_range_bounds_are_inclusive():
    assert usable_coords(90.0, 180.0) == (90.0, 180.0)
    assert usable_coords(-90.0, -180.0) == (-90.0, -180.0)


def test_garbage_is_rejected():
    assert usable_coords("not a number", "-95.3698") is None
    assert usable_coords({}, []) is None
