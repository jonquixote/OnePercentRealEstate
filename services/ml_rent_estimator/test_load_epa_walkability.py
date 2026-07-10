"""Unit tests for the EPA Smart Location Database walkability loader.

    cd services && PYTHONPATH=. python -m pytest ml_rent_estimator/test_load_epa_walkability.py -v
"""
from __future__ import annotations

import os

import pandas as pd
import pytest

from ml_rent_estimator.load_epa_walkability import parse_rows, _to_float


FIXTURE_CSV = """\
GEOID10,NatWalkInd,D2A_EPHHM,D3B,D4A
1000000000001,7.5,0.8,0.6,3
1000000000002,.,.,0.5,2
1000000000003,5.2,,0.7,.
"""


def _read_fixture(tmp_path) -> pd.DataFrame:
    p = os.path.join(tmp_path, "fixture.csv")
    with open(p, "w") as f:
        f.write(FIXTURE_CSV)
    return pd.read_csv(p, dtype=str)


def test_to_float_normal():
    assert _to_float("123.45") == 123.45


def test_to_float_missing_dot():
    assert _to_float(".") is None


def test_to_float_missing_empty():
    assert _to_float("") is None
    assert _to_float(None) is None


def test_parse_rows_count(tmp_path):
    df = _read_fixture(tmp_path)
    df.rename(columns={"GEOID10": "geoid_bg", "NatWalkInd": "natwalkind",
                        "D2A_EPHHM": "d2a_ephhm", "D3B": "d3b", "D4A": "d4a"}, inplace=True)
    rows = parse_rows(df)
    assert len(rows) == 3


def test_parse_rows_geoid_preserved(tmp_path):
    df = _read_fixture(tmp_path)
    df.rename(columns={"GEOID10": "geoid_bg", "NatWalkInd": "natwalkind",
                        "D2A_EPHHM": "d2a_ephhm", "D3B": "d3b", "D4A": "d4a"}, inplace=True)
    rows = parse_rows(df)
    geoids = [r[0] for r in rows]
    assert geoids == ["1000000000001", "1000000000002", "1000000000003"]


def test_parse_rows_missing_values(tmp_path):
    df = _read_fixture(tmp_path)
    df.rename(columns={"GEOID10": "geoid_bg", "NatWalkInd": "natwalkind",
                        "D2A_EPHHM": "d2a_ephhm", "D3B": "d3b", "D4A": "d4a"}, inplace=True)
    rows = parse_rows(df)
    # Row 2: dot for natwalkind and d2a_ephhm -> None
    assert rows[1][1] is None
    assert rows[1][2] is None
    # Row 3: empty d2a_ephhm -> None, dot d4a -> None
    assert rows[2][2] is None
    assert rows[2][4] is None
    # Row 1: all valid
    assert rows[0][1] == 7.5
    assert rows[0][2] == 0.8


def test_parse_rows_valid_values(tmp_path):
    df = _read_fixture(tmp_path)
    df.rename(columns={"GEOID10": "geoid_bg", "NatWalkInd": "natwalkind",
                        "D2A_EPHHM": "d2a_ephhm", "D3B": "d3b", "D4A": "d4a"}, inplace=True)
    rows = parse_rows(df)
    assert rows[0] == ("1000000000001", 7.5, 0.8, 0.6, 3.0)
    assert rows[2][1] == 5.2
    assert rows[2][3] == 0.7
