"""Unit tests for the NCES school locations loader.

    cd services && PYTHONPATH=. python -m pytest ml_rent_estimator/test_load_nces_schools.py -v
"""
from __future__ import annotations

import os

import pytest

from ml_rent_estimator.load_nces_schools import derive_level, parse_csv, parse_txt


FIXTURE_TXT = """\
010000500870|0100005|Albertville Middle School|01|600 E Alabama Ave|Albertville|AL|35950|01|01095|Marshall County|32|34.260200|-86.206200|10700|Albertville, AL|2|290|Huntsville-Decatur-Albertville, AL-TN|0104|01026|01009|2024-2025
010000500871|0100005|Albertville High School|01|402 E McCord Ave|Albertville|AL|35950|01|01095|Marshall County|32|34.261772|-86.204911|10700|Albertville, AL|2|290|Huntsville-Decatur-Albertville, AL-TN|0104|01026|01009|2024-2025
010000500889|0100005|Albertville Elementary School|01|145 West End Drive|Albertville|AL|35950|01|01095|Marshall County|32|34.252700|-86.221806|10700|Albertville, AL|2|290|Huntsville-Decatur-Albertville, AL-TN|0104|01026|01009|2024-2025
010000501616|0100005|Albertville Kindergarten and PreK|01|257 Country Club Rd|Albertville|AL|35951|01|01095|Marshall County|32|34.289945|-86.193056|10700|Albertville, AL|2|290|Huntsville-Decatur-Albertville, AL-TN|0104|01026|01009|2024-2025
"""

FIXTURE_CSV = """\
NCESSCH,LEAID,NAME,STFIP,CNTY,STREET,CITY,STATE,ZIP,LOCALE,LAT,LON
010000500870,0100005,Albertville Middle School,01,01095,600 E Alabama Ave,Albertville,AL,35950,32,34.260200,-86.206200
010000500871,0100005,Albertville High School,01,01095,402 E McCord Ave,Albertville,AL,35950,32,34.261772,-86.204911
010000500889,0100005,Maplewood Elementary Academy,01,01095,145 West End Drive,Albertville,AL,35950,32,34.252700,-86.221806
"""


def _write_fixture_txt(tmp_path) -> str:
    p = os.path.join(tmp_path, "schools.txt")
    with open(p, "w") as f:
        f.write(FIXTURE_TXT)
    return p


def _write_fixture_csv(tmp_path) -> str:
    p = os.path.join(tmp_path, "schools.csv")
    with open(p, "w") as f:
        f.write(FIXTURE_CSV)
    return p


# -- derive_level tests --


def test_derive_level_middle():
    assert derive_level("Albertville Middle School") == "Middle"


def test_derive_level_high():
    assert derive_level("Albertville High School") == "High"


def test_derive_level_elementary():
    assert derive_level("Albertville Elementary School") == "Elementary"


def test_derive_level_prek():
    assert derive_level("Kindergarten and PreK Center") == "Other"


def test_derive_level_other():
    assert derive_level("Lincoln Technical Institute") == "Other"


def test_derive_level_intermediate():
    assert derive_level("Sunset Intermediate School") == "Middle"


def test_derive_level_academy():
    assert derive_level("Lincoln Academy") == "High"


# -- parse_txt tests --


def test_parse_txt_count(tmp_path):
    p = _write_fixture_txt(tmp_path)
    rows = parse_txt(p)
    assert len(rows) == 4


def test_parse_txt_ncessch(tmp_path):
    p = _write_fixture_txt(tmp_path)
    rows = parse_txt(p)
    ids = [r[0] for r in rows]
    assert ids == ["010000500870", "010000500871", "010000500889", "010000501616"]


def test_parse_txt_names(tmp_path):
    p = _write_fixture_txt(tmp_path)
    rows = parse_txt(p)
    names = [r[1] for r in rows]
    assert names[0] == "Albertville Middle School"
    assert names[2] == "Albertville Elementary School"


def test_parse_txt_levels(tmp_path):
    p = _write_fixture_txt(tmp_path)
    rows = parse_txt(p)
    levels = [r[2] for r in rows]
    assert levels == ["Middle", "High", "Elementary", "Other"]


def test_parse_txt_coords(tmp_path):
    p = _write_fixture_txt(tmp_path)
    rows = parse_txt(p)
    assert rows[0][3] == 34.260200
    assert rows[0][4] == -86.206200


# -- parse_csv tests --


def test_parse_csv_count(tmp_path):
    p = _write_fixture_csv(tmp_path)
    rows = parse_csv(p)
    assert len(rows) == 3


def test_parse_csv_ncessch(tmp_path):
    p = _write_fixture_csv(tmp_path)
    rows = parse_csv(p)
    ids = [r[0] for r in rows]
    assert ids == ["010000500870", "010000500871", "010000500889"]


def test_parse_csv_levels(tmp_path):
    p = _write_fixture_csv(tmp_path)
    rows = parse_csv(p)
    levels = [r[2] for r in rows]
    assert levels == ["Middle", "High", "Elementary"]


def test_parse_csv_coords(tmp_path):
    p = _write_fixture_csv(tmp_path)
    rows = parse_csv(p)
    assert rows[1][3] == 34.261772
    assert rows[1][4] == -86.204911


def test_parse_csv_skips_zero_coords(tmp_path):
    content = "NCESSCH,NAME,LAT,LON\n999999,Test School,0.0,0.0\n"
    p = os.path.join(tmp_path, "zero.csv")
    with open(p, "w") as f:
        f.write(content)
    rows = parse_csv(p)
    assert len(rows) == 0
