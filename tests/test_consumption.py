from pathlib import Path

from fastapi.testclient import TestClient

from toyota_telemetry import analytics, api, store


def _insert_trip(conn, trip_id: str, start_ts: str, length_m: int, fuel_ml: float, ev_dist: int, duration_s: int = 1200) -> None:
    conn.execute(
        """INSERT INTO trips (id, start_ts, end_ts, length_m, duration_s, avg_speed, fuel_ml, ev_dist, highway_m)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (trip_id, start_ts, start_ts, length_m, duration_s, 30.0, fuel_ml, ev_dist, 0),
    )


def test_consumption_seasons_and_halves(tmp_path: Path):
    c = store.connect(tmp_path / "c.db")
    _insert_trip(c, "t_aug", "2026-08-10T10:00:00+00:00", 100000, 4000.0, 60000)
    _insert_trip(c, "t_nov", "2026-11-10T10:00:00+00:00", 50000, 2500.0, 25000)
    _insert_trip(c, "t_jan", "2026-01-15T10:00:00+00:00", 20000, 1200.0, 8000)
    _insert_trip(c, "t_short", "2026-01-16T10:00:00+00:00", 3000, 240.0, 600)
    c.commit()

    rep = analytics.consumption(c)
    seasons = {s["id"]: s for s in rep["seasons"]}

    assert seasons["summer"]["trips"] == 1
    assert seasons["summer"]["l_per_100km"] == 4.0
    assert seasons["summer"]["ev_share_km"] == 0.6

    assert seasons["autumn"]["trips"] == 1
    assert seasons["autumn"]["l_per_100km"] == 5.0

    assert seasons["winter"]["trips"] == 2
    assert seasons["winter"]["km"] == 23.0
    assert seasons["winter"]["fuel_l"] == 1.44
    assert seasons["winter"]["l_per_100km"] == 6.26
    assert seasons["winter"]["short_trips_share"] == 0.5

    assert seasons["spring"]["trips"] == 0
    assert seasons["spring"]["l_per_100km"] is None

    assert rep["halves"]["warm"]["l_per_100km"] == 4.0
    assert rep["halves"]["cold"]["trips"] == 3
    assert [m["ym"] for m in rep["monthly"]] == ["2026-01", "2026-08", "2026-11"]


def test_consumption_api_endpoint(tmp_path: Path, monkeypatch):
    db_path = tmp_path / "api.db"
    c = store.connect(db_path)
    _insert_trip(c, "t1", "2026-08-01T12:00:00+00:00", 50000, 2100.0, 28000)
    c.commit()
    c.close()

    monkeypatch.setattr(store, "DB_PATH", db_path)
    monkeypatch.delenv("TOYOTA_TELEMETRY_PASSWORD", raising=False)
    client = TestClient(api.app)
    resp = client.get("/api/consumption")
    assert resp.status_code == 200
    body = resp.json()
    assert body["overall"]["trips"] == 1
    assert body["overall"]["l_per_100km"] == 4.2
