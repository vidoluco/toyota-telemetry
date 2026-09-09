import sqlite3
from pathlib import Path

import pytest

from toyota_telemetry import store, streets, tank


def trip_with_overspeed(i: int, day: int, over_idx: set[int], lat0=45.19, lon0=5.72):
    ts = f"2026-08-{day:02d}T05:00:00+00:00"
    pts = [{"lat": lat0 + k * 0.0006, "lon": lon0, "overspeed": k in over_idx, "highway": False, "indexInPoints": k, "mode": 1, "isEv": False}
           for k in range(30)]
    return {"id": f"s{i}", "category": 0,
            "summary": {"length": 1950, "duration": 300, "averageSpeed": 23.4, "fuelConsumption": 100.0, "startLat": lat0, "startLon": lon0,
                        "startTs": ts, "endLat": pts[-1]["lat"], "endLon": lon0, "endTs": f"2026-08-{day:02d}T05:05:00+00:00", "nightTrip": False},
            "scores": {"global": 80}, "hdc": {}, "route": pts, "behaviours": []}


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = store.connect(tmp_path / "s.db")
    for i, day in enumerate((1, 2, 3)):
        store.load_trip(c, trip_with_overspeed(i, day, set(range(10, 16))), elevation=None)  # same stretch, three days
    store.load_trip(c, trip_with_overspeed(9, 4, {25}), elevation=None)  # single point: too short to count
    c.commit()
    return c


def test_segments_need_length(conn):
    segs = streets.segments(conn)
    assert len(segs) == 3 and all(s["length_m"] > 300 for s in segs)


def test_clusters_group_same_stretch_across_trips(conn):
    cl = streets.clusters(conn, min_trips=2)
    assert len(cl) == 1 and cl[0]["trips"] == 3 and cl[0]["segments"] == 3
    gj = streets.clusters_geojson(cl)
    assert gj["features"][0]["geometry"]["type"] == "LineString"


def test_clusters_respect_date_range(conn):
    assert streets.clusters(conn, from_date="2026-08-03", min_trips=1)[0]["trips"] == 1


def test_fill_detection_and_real_consumption(tmp_path):
    c = store.connect(tmp_path / "t.db")
    snaps = [("2026-08-01T05:00:00Z", 100000, 60), ("2026-08-02T05:00:00Z", 100120, 40), ("2026-08-03T05:00:00Z", 100130, 95),
             ("2026-08-10T05:00:00Z", 100600, 30), ("2026-08-11T05:00:00Z", 100610, 96)]
    for ts, odo, pct in snaps:
        c.execute("INSERT INTO snapshots VALUES (?,?,?,?,?,?)", (ts, odo, pct, None, None, None))
    c.commit()
    assert tank.detect_fills(c) == 2
    assert tank.detect_fills(c) == 0  # idempotent
    fs = tank.fills(c)
    assert fs[0]["ts"].startswith("2026-08-11") and fs[0]["pct_after"] == 96
    assert fs[0]["litres_est"] == round(66 / 100 * 36, 1) and fs[0]["estimated"]
    assert fs[0]["km_since_prev"] == 480 and fs[0]["l_per_100km_real"] == round(fs[0]["litres_est"] / 480 * 100, 2)
    tank.update_fill(c, fs[0]["ts"], litres=25.4, price_per_l=9.5)
    f = tank.fills(c)[0]
    assert f["litres_used"] == 25.4 and f["cost"] == round(25.4 * 9.5, 2) and not f["estimated"]
    s = tank.summary(c)
    assert s["fills"] == 2 and s["level_now"] == 96
