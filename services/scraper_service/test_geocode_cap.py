import main


def _setup(monkeypatch, cap, census_hits=(), nominatim_all_fail=True):
    """Patch out the network + sleep. census_hits = set of indices Census resolves."""
    monkeypatch.setattr(main, "MAX_NOMINATIM_FALLBACK", cap)
    monkeypatch.setattr(main, "sleep", lambda _s: None)

    calls = {"census": 0, "nominatim": 0}
    hitset = set(census_hits)

    def fake_census(addr):
        calls["census"] += 1
        # addr encodes its index as the leading token "i<idx> ..."
        idx = int(addr.split()[0][1:])
        return (1.0, 2.0) if idx in hitset else None

    def fake_nominatim(addr):
        calls["nominatim"] += 1
        return None if nominatim_all_fail else (3.0, 4.0)

    monkeypatch.setattr(main, "geocode_address_census", fake_census)
    monkeypatch.setattr(main, "geocode_address_nominatim", fake_nominatim)
    return calls


def _addrs(n):
    # index-encoded so fake_census can decide per-row
    return [(i, f"i{i} Main St, Town, ST 00000") for i in range(n)]


def test_nominatim_fallback_is_capped(monkeypatch):
    # 50 addresses, none resolved by Census -> all 50 would hit Nominatim
    # uncapped. With cap=15, only 15 Nominatim calls happen.
    calls = _setup(monkeypatch, cap=15)
    main.batch_geocode(_addrs(50))
    assert calls["census"] == 50   # Census is never capped (cheap, parallel)
    assert calls["nominatim"] == 15


def test_small_batches_are_untouched_by_the_cap(monkeypatch):
    # The common case (p50 = 1 address) must be unaffected.
    calls = _setup(monkeypatch, cap=15)
    main.batch_geocode(_addrs(3))
    assert calls["nominatim"] == 3


def test_census_hits_reduce_the_nominatim_fallback(monkeypatch):
    # Census resolves 40 of 50; only the 10 misses reach Nominatim, under the cap.
    calls = _setup(monkeypatch, cap=15, census_hits=range(40))
    result = main.batch_geocode(_addrs(50))
    assert calls["nominatim"] == 10
    # 40 Census coords land; the 10 Nominatim misses stay unresolved.
    assert len(result) == 40


def test_capped_rows_are_simply_absent_from_the_result(monkeypatch):
    # Over the cap, rows get no coords here (caller stores NULL, source fills later).
    _setup(monkeypatch, cap=5)
    result = main.batch_geocode(_addrs(20))
    assert result == {}  # nothing resolved, 15 skipped silently
