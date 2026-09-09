import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from toyota_telemetry import places, store

HOME = (45.1885, 5.7245)      # fictional: Grenoble, matching the demo dataset
WORK = (45.2103, 5.6845)
SHOP = (45.1742, 5.7118)


def _iso(day: int, hour: int, minute: int, plus_minutes: int = 0) -> str:
    """A local wall-clock time as an offset-aware ISO string, so these tests pass in any time zone."""
    return (datetime(2026, 8, day, hour, minute).astimezone() + timedelta(minutes=plus_minutes)).isoformat()


def trip(i: int, start, end, day: int, hour: int, minute: int = 0, harsh=(0, 0), km=10.0, ml=400.0, ev=6000, dur=1500):
    ts, te = _iso(day, hour, minute), _iso(day, hour, minute, dur // 60)
    return {
        "id": f"t{i}", "category": 0,
        "summary": {"length": int(km * 1000), "duration": dur, "averageSpeed": 30.0, "fuelConsumption": ml,
                    "startLat": start[0], "startLon": start[1], "startTs": ts, "endLat": end[0], "endLon": end[1], "endTs": te, "nightTrip": False},
        "scores": {"global": 80, "acceleration": 80, "braking": 80, "advice": 1},
        "hdc": {"evTime": 500, "evDistance": ev},
        "route": [{"lat": start[0] + (end[0] - start[0]) * k / 10, "lon": start[1] + (end[1] - start[1]) * k / 10, "overspeed": False,
                   "highway": False, "indexInPoints": k, "mode": 1, "isEv": True} for k in range(11)],
        "behaviours": [{"lat": end[0], "lon": end[1], "ts": te, "type": "B", "good": False, "coachingMsg": 5, "diagnosticMsg": 5,
                        "context": {"slope": 0}, "priority": True, "severity": 10000.0}] * harsh[0],
    }


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = store.connect(tmp_path / "p.db")
    trips = []
    # weekday commutes home -> work at 08:00 (fast, 5 runs) and 08:30 (slow, 3 runs), work -> home at 17:00
    for d in range(3, 8):
        trips.append(trip(len(trips), HOME, WORK, d, 8, 0, km=10, ml=400, dur=1500))
        trips.append(trip(len(trips), WORK, HOME, d, 17, 0, km=10, ml=450, harsh=(1, 0), dur=1800))
    for d in range(10, 13):
        trips.append(trip(len(trips), HOME, WORK, d, 8, 30, km=10, ml=520, dur=2100, harsh=(2, 0)))
    # a shop errand chain on a Saturday: home -> shop -> home within minutes
    trips.append(trip(len(trips), HOME, SHOP, 8, 11, 0, km=4, dur=600))
    trips.append(trip(len(trips), SHOP, HOME, 8, 11, 30, km=4, dur=600))
    for t in trips:
        store.load_trip(c, t, elevation=None)
    c.commit()
    return c


def test_places_are_clustered_and_named(conn):
    n = places.cluster_places(conn)
    assert n == 3
    ps = places.places(conn)
    assert ps[0]["auto_name"] == "Home" and ps[0]["visits"] == 15
    assert ps[1]["auto_name"] == "Work" and ps[1]["arrivals"] == 8


def test_clustering_is_stable_and_names_survive(conn):
    places.cluster_places(conn)
    home = places.places(conn)[0]
    places.rename_place(conn, home["id"], "Casa")
    places.cluster_places(conn)
    ps = places.places(conn)
    assert len(ps) == 3 and ps[0]["id"] == home["id"] and ps[0]["label"] == "Casa"


def test_journeys_and_commute_flag(conn):
    places.cluster_places(conn)
    js = places.journeys(conn)
    top = js[0]
    assert (top["from_label"], top["to_label"], top["trips"], top["is_commute"]) == ("Home", "Work", 8, True)
    assert any(j["to_label"] == "Place 3" and not j["is_commute"] for j in js)


def test_commute_slots_and_findings(conn):
    places.cluster_places(conn)
    home, work = places.places(conn)[0]["id"], places.places(conn)[1]["id"]
    cm = places.commute(conn, home, work)
    slots = {s["slot"]: s for s in cm["slots"]}
    assert slots["08:00"]["runs"] == 5 and slots["08:30"]["runs"] == 3
    assert slots["08:00"]["duration_median_min"] < slots["08:30"]["duration_median_min"]
    assert any("08:00" in f and "min saved" in f for f in cm["findings"])
    assert cm["best_run"] in {r["id"] for r in cm["runs"]}


def test_chains_detect_errand_runs(conn):
    places.cluster_places(conn)
    ch = places.chains(conn)
    assert len(ch) == 1 and ch[0]["legs"] == 2 and ch[0]["stops"] == ["Home", "Place 3", "Home"]
