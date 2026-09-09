"""SQLite storage: schema, loading from the raw cache, derived columns."""

from __future__ import annotations

import itertools
import json
import os
import sqlite3
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from toyota_telemetry import derive
from toyota_telemetry.labels import is_harsh, label

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.environ.get("TOYOTA_TELEMETRY_DB") or ROOT / "data" / "telemetry.db")
RAW_DIR = ROOT / "data" / "raw"
DEM_DIR = ROOT / "data" / "dem"

SCHEMA = """
CREATE TABLE IF NOT EXISTS vehicle (
  vin TEXT PRIMARY KEY, model TEXT, model_year TEXT, manufactured TEXT, color TEXT, raw TEXT);
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY, start_ts TEXT, end_ts TEXT, start_lat REAL, start_lon REAL, end_lat REAL, end_lon REAL,
  length_m INTEGER, duration_s INTEGER, avg_speed REAL, fuel_ml REAL, night INTEGER, category INTEGER,
  score_global INTEGER, score_accel INTEGER, score_brake INTEGER, score_advice INTEGER,
  ev_time INTEGER, ev_dist INTEGER, charge_time INTEGER, charge_dist INTEGER, eco_time INTEGER, eco_dist INTEGER,
  power_time INTEGER, power_dist INTEGER,
  n_points INTEGER, n_events INTEGER, harsh_brake INTEGER, harsh_accel INTEGER, good_events INTEGER,
  climb_m REAL, descent_m REAL, overspeed_m REAL, highway_m REAL, ev_m REAL,
  mode0_m REAL, mode1_m REAL, mode2_m REAL,
  min_lat REAL, min_lon REAL, max_lat REAL, max_lon REAL);
CREATE INDEX IF NOT EXISTS trips_start ON trips(start_ts);
CREATE TABLE IF NOT EXISTS route_points (
  trip_id TEXT, idx INTEGER, lat REAL, lon REAL, is_ev INTEGER, mode INTEGER, overspeed INTEGER, highway INTEGER,
  t_est REAL, dist_m REAL, speed_est REAL, elev_m REAL, PRIMARY KEY (trip_id, idx));
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id TEXT, ts TEXT, type TEXT, good INTEGER, code INTEGER, diag INTEGER,
  severity REAL, priority INTEGER, slope REAL, lat REAL, lon REAL, point_idx INTEGER, label TEXT, harsh INTEGER);
CREATE INDEX IF NOT EXISTS events_trip ON events(trip_id);
CREATE INDEX IF NOT EXISTS events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS daily_stats (
  date TEXT PRIMARY KEY, length_m INTEGER, duration_s INTEGER, avg_speed REAL, fuel_ml REAL,
  score_global INTEGER, score_accel INTEGER, score_brake INTEGER, score_const INTEGER, score_advice INTEGER,
  ev_time INTEGER, ev_dist INTEGER);
CREATE TABLE IF NOT EXISTS monthly_stats (
  year INTEGER, month INTEGER, length_m INTEGER, duration_s INTEGER, avg_speed REAL, fuel_ml REAL,
  score_global INTEGER, score_accel INTEGER, score_brake INTEGER, score_const INTEGER, score_advice INTEGER,
  ev_time INTEGER, ev_dist INTEGER, PRIMARY KEY (year, month));
CREATE TABLE IF NOT EXISTS snapshots (
  ts TEXT PRIMARY KEY, odometer_km INTEGER, fuel_pct INTEGER, range_km INTEGER, lat REAL, lon REAL);
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY, date TEXT, mileage_km INTEGER, provider TEXT, category TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
"""

DEFAULT_SETTINGS = {"fuel_price": "1.75", "currency": "EUR", "tank_capacity_l": "36"}  # set your own price in the UI; 36 l is the Yaris Hybrid tank


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    for k, v in DEFAULT_SETTINGS.items():
        conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (k, v))
    conn.commit()
    return conn


def get_settings(conn: sqlite3.Connection) -> dict[str, Any]:
    """Settings, with the fuel price resolved.

    Every cost in the app uses ``fuel_price``. When the tank log holds fills with a real
    price per litre, that average wins over the number typed in settings: it is what the
    fuel actually cost. ``fuel_price_manual`` keeps the typed value, ``fuel_price_source``
    says which one is in use.
    """
    rows = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM settings")}
    manual = float(rows.get("fuel_price", DEFAULT_SETTINGS["fuel_price"]))
    avg, fills = _fill_price_average(conn)
    return {"fuel_price": avg if avg else manual, "fuel_price_manual": manual,
            "fuel_price_source": "fills" if avg else "manual", "fuel_price_fills": fills,
            "currency": rows.get("currency", DEFAULT_SETTINGS["currency"]),
            "tank_capacity_l": float(rows.get("tank_capacity_l", DEFAULT_SETTINGS["tank_capacity_l"]))}


def _fill_price_average(conn: sqlite3.Connection) -> tuple[float | None, int]:
    """Litre-weighted average price across fills that carry both litres and a price."""
    try:
        rows = conn.execute("SELECT litres, price_per_l FROM fills WHERE price_per_l IS NOT NULL AND litres IS NOT NULL").fetchall()
    except sqlite3.OperationalError:  # the tank log has never been opened
        return None, 0
    if not rows:
        return None, 0
    litres = sum(r["litres"] for r in rows)
    if litres <= 0:
        return None, 0
    return round(sum(r["litres"] * r["price_per_l"] for r in rows) / litres, 3), len(rows)


def set_settings(conn: sqlite3.Connection, **values: Any) -> dict[str, Any]:
    for k, v in values.items():
        if v is not None and k in DEFAULT_SETTINGS:
            conn.execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)", (k, str(v)))
    conn.commit()
    return get_settings(conn)


def _segment_lengths(dist: list[float]) -> list[float]:
    return [0.0] + [b - a for a, b in itertools.pairwise(dist)]


def load_trip(conn: sqlite3.Connection, trip: dict[str, Any], elevation: derive.Elevation | None) -> None:
    """Insert or replace one raw trip with all derived columns."""
    s = trip.get("summary") or {}
    sc = trip.get("scores") or {}
    hdc = trip.get("hdc") or {}
    tid = str(trip["id"])
    route = trip.get("route") or []
    events = trip.get("behaviours") or []
    points = [(p["lat"], p["lon"]) for p in route]
    start_ts = derive.parse_ts(s["startTs"])
    end_ts = derive.parse_ts(s["endTs"])
    ev_anchor = [(derive.parse_ts(b["ts"]), b["lat"], b["lon"]) for b in events if b.get("lat") is not None]
    t_est = derive.estimate_timestamps(points, start_ts, end_ts, ev_anchor)
    dist = derive.cumulative_distance_m(points)
    speed = derive.speeds_kmh(dist, t_est)
    elev = elevation.profile(points) if elevation else [None] * len(points)
    climb, descent = derive.climb_descent(elev)
    seg = _segment_lengths(dist)
    overspeed_m = sum(d for d, p in zip(seg, route, strict=False) if p.get("overspeed"))
    highway_m = sum(d for d, p in zip(seg, route, strict=False) if p.get("highway"))
    ev_m = sum(d for d, p in zip(seg, route, strict=False) if p.get("isEv"))
    mode_m = {m: sum(d for d, p in zip(seg, route, strict=False) if p.get("mode") == m) for m in (0, 1, 2)}
    lats = [p[0] for p in points] or [s.get("startLat")]
    lons = [p[1] for p in points] or [s.get("startLon")]
    harsh_b = sum(1 for b in events if b.get("type") == "B" and is_harsh(b.get("good")))
    harsh_a = sum(1 for b in events if b.get("type") == "A" and is_harsh(b.get("good")))
    good = sum(1 for b in events if b.get("good"))

    conn.execute("DELETE FROM route_points WHERE trip_id = ?", (tid,))
    conn.execute("DELETE FROM events WHERE trip_id = ?", (tid,))
    conn.execute(
        """INSERT OR REPLACE INTO trips VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            tid, start_ts.isoformat(), end_ts.isoformat(), s.get("startLat"), s.get("startLon"), s.get("endLat"),
            s.get("endLon"), s.get("length"), s.get("duration"), s.get("averageSpeed"), s.get("fuelConsumption"),
            1 if s.get("nightTrip") else 0, trip.get("category"),
            sc.get("global"), sc.get("acceleration"), sc.get("braking"), sc.get("advice"),
            hdc.get("evTime"), hdc.get("evDistance"), hdc.get("chargeTime"), hdc.get("chargeDist"),
            hdc.get("ecoTime"), hdc.get("ecoDist"), hdc.get("powerTime"), hdc.get("powerDist"),
            len(points), len(events), harsh_b, harsh_a, good,
            climb, descent, overspeed_m, highway_m, ev_m,
            mode_m[0], mode_m[1], mode_m[2],
            min(lats), min(lons), max(lats), max(lons),
        ),
    )
    conn.executemany(
        "INSERT INTO route_points VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        [
            (tid, i, p["lat"], p["lon"], 1 if p.get("isEv") else 0, p.get("mode"), 1 if p.get("overspeed") else 0,
             1 if p.get("highway") else 0, t_est[i], dist[i], speed[i], elev[i])
            for i, p in enumerate(route)
        ],
    )
    for b in events:
        idx = derive.nearest_index(points, b["lat"], b["lon"])[0] if points and b.get("lat") is not None else None
        conn.execute(
            "INSERT INTO events(trip_id, ts, type, good, code, diag, severity, priority, slope, lat, lon, point_idx, label, harsh)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                tid, derive.parse_ts(b["ts"]).isoformat(), b.get("type"), 1 if b.get("good") else 0,
                b.get("coachingMsg"), b.get("diagnosticMsg"), b.get("severity"), 1 if b.get("priority") else 0,
                (b.get("context") or {}).get("slope"), b.get("lat"), b.get("lon"), idx,
                label(b.get("type"), b.get("coachingMsg"), b.get("good")), 1 if is_harsh(b.get("good")) else 0,
            ),
        )


def _stats_row(summary: dict[str, Any], scores: dict[str, Any], hdc: dict[str, Any]) -> tuple:
    return (
        summary.get("length"), summary.get("duration"), summary.get("averageSpeed"), summary.get("fuelConsumption"),
        scores.get("global"), scores.get("acceleration"), scores.get("braking"), scores.get("constantSpeed"),
        scores.get("advice"), hdc.get("evTime"), hdc.get("evDistance"),
    )


def load_month_file(conn: sqlite3.Connection, path: Path, elevation: derive.Elevation | None) -> int:
    data = json.loads(path.read_text())
    for trip in data.get("trips") or []:
        load_trip(conn, trip, elevation)
    for m in data.get("summary") or []:
        conn.execute(
            "INSERT OR REPLACE INTO monthly_stats VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (m["year"], m["month"], *_stats_row(m.get("summary") or {}, m.get("scores") or {}, m.get("hdc") or {})),
        )
        for d in m.get("histograms") or []:
            conn.execute(
                "INSERT OR REPLACE INTO daily_stats VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (f"{d['year']:04d}-{d['month']:02d}-{d['day']:02d}",
                 *_stats_row(d.get("summary") or {}, d.get("scores") or {}, d.get("hdc") or {})),
            )
    conn.commit()
    return len(data.get("trips") or [])


def load_vehicle_files(conn: sqlite3.Connection, raw_dir: Path) -> None:
    veh = raw_dir / "vehicles.json"
    if veh.exists():
        for car in json.loads(veh.read_text()) or []:
            if not isinstance(car, dict) or "vin" not in car:
                continue
            conn.execute(
                "INSERT OR REPLACE INTO vehicle VALUES (?,?,?,?,?,?)",
                (car["vin"], car.get("displayModelDescription") or car.get("modelName"), car.get("modelYear"),
                 car.get("manufacturedDate"), car.get("color"), json.dumps(car)),
            )
    tel = raw_dir / "telemetry.json"
    loc = raw_dir / "location.json"
    if tel.exists():
        t = json.loads(tel.read_text())
        if isinstance(t, dict) and t.get("timestamp"):
            pos = {}
            if loc.exists():
                pos = (json.loads(loc.read_text()) or {}).get("vehicleLocation") or {}
            conn.execute(
                "INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?,?)",
                (t["timestamp"], (t.get("odometer") or {}).get("value"), t.get("fuelLevel"),
                 (t.get("distanceToEmpty") or {}).get("value"), pos.get("latitude"), pos.get("longitude")),
            )
    svc = raw_dir / "service_history.json"
    if svc.exists():
        s = json.loads(svc.read_text())
        for h in (s or {}).get("serviceHistories") or [] if isinstance(s, dict) else []:
            conn.execute(
                "INSERT OR REPLACE INTO services VALUES (?,?,?,?,?)",
                (h.get("serviceHistoryId"), h.get("serviceDate"), int(h.get("mileage") or 0),
                 h.get("serviceProvider"), h.get("serviceCategory")),
            )
    conn.commit()


def load_raw(conn: sqlite3.Connection, raw_dir: Path = RAW_DIR, *, online: bool = True,
             only: list[Path] | None = None) -> int:
    """Load vehicle files and every month file (or ``only`` those given). Returns trips loaded."""
    elevation = derive.Elevation(DEM_DIR, online=online)
    load_vehicle_files(conn, raw_dir)
    files = only if only is not None else sorted((raw_dir / "trips").glob("*.json"))
    n = 0
    for f in files:
        if f.name.endswith(".json") and f.parent.name == "trips":
            n += load_month_file(conn, f, elevation)
    from toyota_telemetry import places, tank  # local import: they depend on this module

    places.cluster_places(conn)
    tank.detect_fills(conn)
    return n


def now_iso() -> str:
    return datetime.now(UTC).isoformat()
