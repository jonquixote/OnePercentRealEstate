"""Unit tests for the FHFA ZIP5 HPI loader (parse + missing-value handling).

    cd services && PYTHONPATH=. python -m pytest ml_rent_estimator/test_load_fhfa.py -v
"""
from __future__ import annotations

import csv
import io
import os
import tempfile

import pytest

from ml_rent_estimator.load_fhfa_hpi import parse_csv, _to_float


FIXTURE_CSV = """\
Five-Digit ZIP Code,Year,HPI,Annual Change (%)
90001,2020,100.00,5.2
90002,2020,110.50,.
90003,2020,95.30,3.1
"""


def _write_fixture(tmp_path) -> str:
    p = os.path.join(tmp_path, "fixture.csv")
    with open(p, "w") as f:
        f.write(FIXTURE_CSV)
    return p


def test_to_float_normal():
    assert _to_float("123.45") == 123.45


def test_to_float_missing_dot():
    assert _to_float(".") is None


def test_to_float_missing_empty():
    assert _to_float("") is None
    assert _to_float(None) is None


def test_to_float_na():
    assert _to_float("NA") is None
    assert _to_float("N/A") is None


def test_parse_csv_correct_rows(tmp_path):
    p = _write_fixture(tmp_path)
    rows = parse_csv(p)
    assert len(rows) == 3


def test_parse_csv_values(tmp_path):
    p = _write_fixture(tmp_path)
    rows = parse_csv(p)
    zips = [r[0] for r in rows]
    assert zips == ["90001", "90002", "90003"]


def test_parse_csv_missing_annual_change(tmp_path):
    p = _write_fixture(tmp_path)
    rows = parse_csv(p)
    # Row 2 has "." for annual_change_pct -> None
    assert rows[1][2] is None
    # Row 1 and 3 have valid values
    assert rows[0][2] == 5.2
    assert rows[2][2] == 3.1


def test_parse_csv_zero_padded(tmp_path):
    p = _write_fixture(tmp_path)
    rows = parse_csv(p)
    for z, *_ in rows:
        assert len(z) == 5
        assert z.isdigit()


def test_parse_csv_hpi_values(tmp_path):
    p = _write_fixture(tmp_path)
    rows = parse_csv(p)
    hpis = [r[3] for r in rows]
    assert hpis == [100.0, 110.5, 95.3]


def test_parse_csv_alternate_column_names(tmp_path):
    content = "zip5,year,hpi,annual_change_pct\n80201,2021,200.0,7.5\n"
    p = os.path.join(tmp_path, "alt.csv")
    with open(p, "w") as f:
        f.write(content)
    rows = parse_csv(p)
    assert len(rows) == 1
    assert rows[0] == ("80201", 2021, 7.5, 200.0)


def test_parse_csv_empty_file(tmp_path):
    p = os.path.join(tmp_path, "empty.csv")
    with open(p, "w") as f:
        f.write("Five-Digit ZIP Code,Year,HPI,Annual Change (%)\n")
    rows = parse_csv(p)
    assert rows == []
