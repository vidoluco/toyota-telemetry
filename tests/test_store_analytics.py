import json
import sqlite3
from pathlib import Path

import pytest

from toyota_telemetry import analytics, store

RAW_TRIP = {
    "id": "t1", "category": 0,
    "summary": {"length": 3000, "duration": 300, "averageSpeed": 36.0, "fuelConsumption": 200.0,
                "startLat": 45.18, "startLon": 5.72, "startTs": "2026-09-01T08:00:00Z",
                "endLat": 45.207, "endLon": 5.72, "endTs": "2026-09-01T08:05:00Z", "nightTrip": False},
    "scores": {"global": 80, "acceleration": 85, "braking": 75, "advice": 3},
    "hdc": {"evTime": 100, "evDistance": 1000, "chargeTime": 0, "chargeDist": 0, "ecoTime": 200, "ecoDist": 2000,
            "powerTime": 0, "powerDist": 0},
    "route": [{"lat": 45.18 + i * 0.0027, "lon": 5.72, "overspeed": i > 7, "highway": False, "indexInPoints": i,
               "mode": 1 if i < 5 else 0, "isEv": i >= 5} for i in range(11)],
    "behaviours": [
        {"lat": 45.1935, "lon": 5.72, "ts": "2026-09-01T08:02:00Z", "type": "B", "good": False, "coachingMsg": 13,
         "diagnosticMsg": 13, "context": {"slope": 1.5}, "priority": True, "severity": 10000.0},
        {"lat": 45.1935, "lon": 5.7201, "ts": "2026-09-01T08:02:10Z", "type": "A", "good": False, "coachingMsg": 25,
         "diagnosticMsg": 25, "context": {"slope": 0.0}, "priority": True, "severity": 10000.0},
        {"lat": 45.205, "lon": 5.72, "ts": "2026-09-01T08:04:30Z", "type": "B", "good": True, "coachingMsg": 1,
         "diagnosticMsg": 1, "context": {"slope": 0.0}, "priority": False, "severity": 0.0},
    ],
}


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = store.connect(tmp_path / "t.db")
    store.load_trip(c, RAW_TRIP, elevation=None)
    c.commit()
    return c


def test_trip_row_and_derived_columns(conn):
    r = conn.execute("SELECT * FROM trips").fetchone()
    assert r["n_points"] == 11 and r["n_events"] == 3
    assert r["harsh_brake"] == 1 and r["harsh_accel"] == 1 and r["good_events"] == 1
    assert r["overspeed_m"] > 0 and r["ev_m"] > 0
    assert conn.execute("SELECT COUNT(*) c FROM route_points").fetchone()["c"] == 11


def test_events_get_labels(conn):
    labels = {r["label"] for r in conn.execute("SELECT label FROM events")}
    assert labels == {"late brake", "hard acceleration", "smooth stop"}


def test_reload_is_idempotent(conn):
    store.load_trip(conn, RAW_TRIP, elevation=None)
    assert conn.execute("SELECT COUNT(*) c FROM trips").fetchone()["c"] == 1
    assert conn.execute("SELECT COUNT(*) c FROM events").fetchone()["c"] == 3


def test_summary_and_cost(conn):
    store.set_settings(conn, fuel_price=10.0)
    s = analytics.summary(conn)
    assert s["trips"] == 1 and s["km"] == 3.0 and s["fuel_l"] == 0.2 and s["cost"] == 2.0
    assert s["events"] == {"harsh_brake": 1, "harsh_accel": 1, "smooth_brake": 1, "smooth_accel": 0, "other": 0}
    assert s["l_per_100km"] == 6.67


def test_date_filter_excludes(conn):
    assert analytics.trips(conn, "2026-09-02", None) == []
    assert len(analytics.trips(conn, "2026-09-01", "2026-09-01")) == 1


def test_hotspot_clusters_the_two_close_harsh_events(conn):
    h = analytics.hotspots(conn, radius_m=60, min_count=2)
    assert len(h) == 1 and h[0]["count"] == 2 and h[0]["harsh_brake"] == 1 and h[0]["harsh_accel"] == 1


def test_route_geojson_splits_on_ev_and_overspeed(conn):
    fc = analytics.routes_geojson(conn, tolerance=0)
    assert [f["properties"]["is_ev"] for f in fc["features"]] == [False, True, True]
    assert [f["properties"]["overspeed"] for f in fc["features"]] == [False, False, True]


def test_trip_detail_profile(conn):
    d = analytics.trip_detail(conn, "t1")
    assert len(d["profile"]) == 11 and d["profile"][-1]["t"] == 300.0
    assert d["events_geojson"]["features"][0]["properties"]["label"] == "late brake"


def test_month_file_loads_summaries(tmp_path):
    c = store.connect(tmp_path / "m.db")
    month = {"trips": [RAW_TRIP], "summary": [{"year": 2026, "month": 9,
             "summary": {"length": 3000, "duration": 300, "averageSpeed": 36.0, "fuelConsumption": 150.0},
             "scores": {"global": 80, "acceleration": 85, "braking": 75, "constantSpeed": 70, "advice": 3},
             "hdc": {"evTime": 100, "evDistance": 1000},
             "histograms": [{"year": 2026, "month": 9, "day": 1, "summary": {"length": 3000, "duration": 300,
                             "averageSpeed": 36.0, "fuelConsumption": 150.0}, "scores": {"global": 80}, "hdc": {}}]}]}
    p = tmp_path / "trips" / "2026-09.json"
    p.parent.mkdir()
    p.write_text(json.dumps(month))
    assert store.load_month_file(c, p, elevation=None) == 1
    assert analytics.monthly(c)[0]["scores"]["constant_speed"] == 70
    assert c.execute("SELECT date FROM daily_stats").fetchone()["date"] == "2026-09-01"
