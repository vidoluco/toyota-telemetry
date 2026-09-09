"""Aggregations, GeoJSON builders and hotspot clustering over the SQLite store."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from typing import Any

from toyota_telemetry import derive
from toyota_telemetry.labels import MODES, severity_or_none
from toyota_telemetry.store import get_settings


def _range_clause(from_date: str | None, to_date: str | None, col: str = "start_ts") -> tuple[str, list[Any]]:
    clauses, params = [], []
    if from_date:
        clauses.append(f"{col} >= ?")
        params.append(from_date)
    if to_date:
        clauses.append(f"{col} < ?")
        params.append(to_date + "T99")  # inclusive day: lexicographic trick on ISO strings
    return (" WHERE " + " AND ".join(clauses)) if clauses else "", params


def _cost(fuel_l: float, settings: dict[str, Any]) -> float:
    return round(fuel_l * settings["fuel_price"], 2)


def _trip_dict(r: sqlite3.Row, settings: dict[str, Any]) -> dict[str, Any]:
    km = (r["length_m"] or 0) / 1000
    fuel_l = (r["fuel_ml"] or 0) / 1000
    total_mode = (r["mode0_m"] or 0) + (r["mode1_m"] or 0) + (r["mode2_m"] or 0)
    route_m = max(total_mode, 1.0)
    return {
        "id": r["id"], "start_ts": r["start_ts"], "end_ts": r["end_ts"],
        "start": {"lat": r["start_lat"], "lon": r["start_lon"]}, "end": {"lat": r["end_lat"], "lon": r["end_lon"]},
        "km": round(km, 2), "duration_s": r["duration_s"], "avg_speed": r["avg_speed"],
        "fuel_l": round(fuel_l, 3),
        "l_per_100km": round(fuel_l / km * 100, 2) if km > 0.2 else None, "cost": _cost(fuel_l, settings),
        "ev_km": round((r["ev_dist"] or 0) / 1000, 2),
        "ev_share": round((r["ev_dist"] or 0) / (r["length_m"] or 1), 3), "night": bool(r["night"]),
        "scores": {"global": r["score_global"], "acceleration": r["score_accel"], "braking": r["score_brake"],
                   "advice": r["score_advice"]},
        "events": {"harsh_brake": r["harsh_brake"], "harsh_accel": r["harsh_accel"], "good": r["good_events"]},
        "overspeed_km": round((r["overspeed_m"] or 0) / 1000, 2), "highway_km": round((r["highway_m"] or 0) / 1000, 2),
        "mode_share": {MODES[m]: round((r[f"mode{m}_m"] or 0) / route_m, 3) for m in (0, 1, 2)},
        "climb_m": r["climb_m"], "descent_m": r["descent_m"],
        "bbox": [r["min_lon"], r["min_lat"], r["max_lon"], r["max_lat"]],
    }


def trips(conn: sqlite3.Connection, from_date: str | None = None, to_date: str | None = None) -> list[dict[str, Any]]:
    where, params = _range_clause(from_date, to_date)
    settings = get_settings(conn)
    rows = conn.execute(f"SELECT * FROM trips{where} ORDER BY start_ts DESC", params).fetchall()
    return [_trip_dict(r, settings) for r in rows]


def trip_ids(conn: sqlite3.Connection, from_date: str | None, to_date: str | None) -> list[str]:
    where, params = _range_clause(from_date, to_date)
    return [r["id"] for r in conn.execute(f"SELECT id FROM trips{where}", params)]


def _event_feature(r: sqlite3.Row) -> dict[str, Any]:
    return {
        "type": "Feature", "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]},
        "properties": {"id": r["id"], "trip_id": r["trip_id"], "ts": r["ts"], "type": r["type"],
                       "good": bool(r["good"]), "code": r["code"], "label": r["label"],
                       "severity": severity_or_none(r["severity"]), "slope": r["slope"]},
    }


def events_geojson(conn: sqlite3.Connection, from_date: str | None = None, to_date: str | None = None,
                   event_type: str | None = None, good: bool | None = None) -> dict[str, Any]:
    where, params = _range_clause(from_date, to_date, "ts")
    extra = []
    if event_type:
        extra.append("type = ?")
        params.append(event_type)
    if good is not None:
        extra.append("good = ?")
        params.append(1 if good else 0)
    if extra:
        where = (where + " AND " if where else " WHERE ") + " AND ".join(extra)
    rows = conn.execute(f"SELECT * FROM events{where} ORDER BY ts", params).fetchall()
    return {"type": "FeatureCollection", "features": [_event_feature(r) for r in rows]}


def _route_features(conn: sqlite3.Connection, trip_id: str, start_ts: str, tolerance: float = 0.0) -> list[dict]:
    """Split a trip's route into LineStrings where is_ev or overspeed changes."""
    rows = conn.execute(
        "SELECT lat, lon, is_ev, mode, overspeed, highway, speed_est FROM route_points WHERE trip_id = ? ORDER BY idx",
        (trip_id,),
    ).fetchall()
    features: list[dict] = []
    seg: list[sqlite3.Row] = []

    def flush() -> None:
        if len(seg) < 2:
            return
        pts = [(r["lat"], r["lon"]) for r in seg]
        if tolerance:
            pts = derive.simplify(pts, tolerance)
        speeds = [r["speed_est"] or 0 for r in seg]
        own = seg[1]  # seg[0] is the carried-over last point of the previous segment
        features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [[lon, lat] for lat, lon in pts]},
            "properties": {"trip_id": trip_id, "is_ev": bool(own["is_ev"]), "mode": own["mode"],
                           "overspeed": bool(own["overspeed"]), "highway": bool(own["highway"]),
                           "speed_est": round(sum(speeds) / len(speeds), 1), "start_ts": start_ts},
        })

    prev_key = None
    for r in rows:
        key = (r["is_ev"], r["overspeed"])
        if prev_key is not None and key != prev_key:
            last = seg[-1]
            flush()
            seg = [last]
        seg.append(r)
        prev_key = key
    flush()
    return features


def routes_geojson(conn: sqlite3.Connection, from_date: str | None = None, to_date: str | None = None,
                   tolerance: float = 0.00005) -> dict[str, Any]:
    where, params = _range_clause(from_date, to_date)
    feats: list[dict] = []
    for r in conn.execute(f"SELECT id, start_ts FROM trips{where} ORDER BY start_ts", params):
        feats.extend(_route_features(conn, r["id"], r["start_ts"], tolerance))
    return {"type": "FeatureCollection", "features": feats}


def trip_detail(conn: sqlite3.Connection, trip_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM trips WHERE id = ?", (trip_id,)).fetchone()
    if row is None:
        return None
    d = _trip_dict(row, get_settings(conn))
    d["route"] = {"type": "FeatureCollection", "features": _route_features(conn, trip_id, row["start_ts"])}
    ev = conn.execute("SELECT * FROM events WHERE trip_id = ? ORDER BY ts", (trip_id,)).fetchall()
    d["events_geojson"] = {"type": "FeatureCollection", "features": [_event_feature(r) for r in ev]}
    d["profile"] = [
        {"t": round(r["t_est"], 1), "km": round(r["dist_m"] / 1000, 3), "speed_est": round(r["speed_est"] or 0, 1),
         "elevation_m": None if r["elev_m"] is None else round(r["elev_m"], 1), "is_ev": bool(r["is_ev"])}
        for r in conn.execute("SELECT t_est, dist_m, speed_est, elev_m, is_ev FROM route_points WHERE trip_id = ? ORDER BY idx",
                              (trip_id,))
    ]
    return d


def summary(conn: sqlite3.Connection, from_date: str | None = None, to_date: str | None = None) -> dict[str, Any]:
    where, params = _range_clause(from_date, to_date)
    settings = get_settings(conn)
    r = conn.execute(
        f"""SELECT COUNT(*) n, COALESCE(SUM(length_m),0) m, COALESCE(SUM(duration_s),0) s, COALESCE(SUM(fuel_ml),0) ml,
            COALESCE(SUM(ev_dist),0) ev_m, COALESCE(SUM(ev_time),0) ev_s, AVG(score_global) g, AVG(score_accel) a,
            AVG(score_brake) b, SUM(harsh_brake) hb, SUM(harsh_accel) ha, SUM(good_events) good, SUM(n_events) ne,
            SUM(night) night, COALESCE(SUM(overspeed_m),0) osm, COALESCE(SUM(highway_m),0) hwm,
            COALESCE(SUM(climb_m),0) climb FROM trips{where}""", params).fetchone()
    km = r["m"] / 1000
    fuel_l = r["ml"] / 1000
    ev = conn.execute(f"SELECT type, good, COUNT(*) c FROM events{_range_clause(from_date, to_date, 'ts')[0]} GROUP BY type, good",
                      _range_clause(from_date, to_date, "ts")[1]).fetchall()
    counts = {(e["type"], bool(e["good"])): e["c"] for e in ev}
    other = sum(c for (t, _), c in counts.items() if t not in ("A", "B"))
    const = conn.execute("SELECT AVG(score_const) c FROM monthly_stats").fetchone()["c"]

    def pick(order: str) -> dict[str, Any] | None:
        row = conn.execute(f"SELECT id, score_global, length_m FROM trips{where} AND length_m > 2000 ORDER BY {order} LIMIT 1"
                           if where else f"SELECT id, score_global, length_m FROM trips WHERE length_m > 2000 ORDER BY {order} LIMIT 1",
                           params).fetchone()
        return None if row is None else {"id": row["id"], "score": row["score_global"], "km": round(row["length_m"] / 1000, 1)}

    longest = conn.execute(f"SELECT id, length_m FROM trips{where} ORDER BY length_m DESC LIMIT 1", params).fetchone()
    return {
        "trips": r["n"], "km": round(km, 1), "hours": round(r["s"] / 3600, 1), "fuel_l": round(fuel_l, 1),
        "l_per_100km": round(fuel_l / km * 100, 2) if km else None, "cost": _cost(fuel_l, settings),
        "ev_share_km": round(r["ev_m"] / r["m"], 3) if r["m"] else None,
        "ev_share_time": round(r["ev_s"] / r["s"], 3) if r["s"] else None,
        "scores": {"global": _r(r["g"]), "acceleration": _r(r["a"]), "braking": _r(r["b"]), "constant_speed": _r(const)},
        "events": {"harsh_brake": counts.get(("B", False), 0), "harsh_accel": counts.get(("A", False), 0),
                   "smooth_brake": counts.get(("B", True), 0), "smooth_accel": counts.get(("A", True), 0), "other": other},
        "harsh_per_100km": round(((r["hb"] or 0) + (r["ha"] or 0)) / km * 100, 2) if km else None,
        "night_trips": r["night"] or 0, "overspeed_km": round(r["osm"] / 1000, 1), "highway_km": round(r["hwm"] / 1000, 1),
        "longest_trip": None if longest is None else {"id": longest["id"], "km": round(longest["length_m"] / 1000, 1)},
        "best_trip": pick("score_global DESC, length_m DESC"), "worst_trip": pick("score_global ASC, length_m DESC"),
        "climb_m": round(r["climb"], 0), "avg_speed": round(r["m"] / 1000 / (r["s"] / 3600), 1) if r["s"] else None,
    }


def _r(v: float | None) -> int | None:
    return None if v is None else round(v)


def hotspots(conn: sqlite3.Connection, from_date: str | None = None, to_date: str | None = None,
             radius_m: float = 60.0, min_count: int = 2) -> list[dict[str, Any]]:
    """Greedy clustering of harsh events: densest neighbourhoods first."""
    where, params = _range_clause(from_date, to_date, "ts")
    rows = conn.execute(f"SELECT * FROM events{where}", params).fetchall()
    bad = [r for r in rows if r["harsh"]]
    good = [r for r in rows if not r["harsh"]]
    # neighbour counts
    neigh: dict[int, list[int]] = {}
    for i, a in enumerate(bad):
        neigh[i] = [j for j, b in enumerate(bad) if derive.haversine_m(a["lat"], a["lon"], b["lat"], b["lon"]) <= radius_m]
    assigned: set[int] = set()
    clusters: list[dict[str, Any]] = []
    elevation = derive.Elevation(derive.Path(__file__).resolve().parent.parent / "data" / "dem", online=False)
    for i in sorted(neigh, key=lambda k: -len(neigh[k])):
        if i in assigned:
            continue
        members = [j for j in neigh[i] if j not in assigned]
        if len(members) < min_count:
            continue
        assigned.update(members)
        ms = [bad[j] for j in members]
        lat = sum(m["lat"] for m in ms) / len(ms)
        lon = sum(m["lon"] for m in ms) / len(ms)
        near_good = [g for g in good if derive.haversine_m(lat, lon, g["lat"], g["lon"]) <= radius_m]
        labels: dict[str, int] = {}
        for m in ms:
            labels[m["label"]] = labels.get(m["label"], 0) + 1
        hb = sum(1 for m in ms if m["type"] == "B")
        ha = sum(1 for m in ms if m["type"] == "A")
        trips_here = sorted({m["trip_id"] for m in ms})
        clusters.append({
            "lat": round(lat, 6), "lon": round(lon, 6), "count": len(ms), "harsh_brake": hb, "harsh_accel": ha,
            "good": len(near_good), "trips": trips_here,
            "score": round(len(ms) / (len(ms) + len(near_good)), 2),
            "label": max(labels, key=labels.get), "elevation_m": elevation.at(lat, lon),
            "slope_avg": round(sum(m["slope"] or 0 for m in ms) / len(ms), 2),
            "last_ts": max(m["ts"] for m in ms),
        })
    clusters.sort(key=lambda c: (-c["count"], -c["score"]))
    return clusters


def heatmap(conn: sqlite3.Connection, from_date: str | None = None, to_date: str | None = None) -> dict[str, Any]:
    where, params = _range_clause(from_date, to_date)
    cells: dict[tuple[int, int], dict[str, float]] = {}
    for r in conn.execute(f"SELECT start_ts, length_m, harsh_brake, harsh_accel FROM trips{where}", params):
        dt = datetime.fromisoformat(r["start_ts"]).astimezone()  # local machine time zone
        key = (dt.weekday(), dt.hour)
        c = cells.setdefault(key, {"trips": 0, "km": 0.0, "harsh": 0})
        c["trips"] += 1
        c["km"] += (r["length_m"] or 0) / 1000
        c["harsh"] += (r["harsh_brake"] or 0) + (r["harsh_accel"] or 0)
    weekday_hour = [{"weekday": k[0], "hour": k[1], "trips": v["trips"], "km": round(v["km"], 1), "harsh": v["harsh"]}
                    for k, v in sorted(cells.items())]
    daily: dict[str, dict[str, Any]] = {}
    for r in conn.execute(f"SELECT * FROM trips{where} ORDER BY start_ts", params):
        day = datetime.fromisoformat(r["start_ts"]).astimezone().strftime("%Y-%m-%d")
        d = daily.setdefault(day, {"date": day, "trips": 0, "km": 0.0, "fuel_l": 0.0, "harsh": 0, "ev_m": 0.0, "m": 0.0, "scores": []})
        d["trips"] += 1
        d["km"] += (r["length_m"] or 0) / 1000
        d["fuel_l"] += (r["fuel_ml"] or 0) / 1000
        d["harsh"] += (r["harsh_brake"] or 0) + (r["harsh_accel"] or 0)
        d["ev_m"] += r["ev_dist"] or 0
        d["m"] += r["length_m"] or 0
        if r["score_global"] is not None:
            d["scores"].append((r["score_global"], r["length_m"] or 1))
    out = []
    for d in daily.values():
        w = sum(km for _, km in d["scores"]) or 1
        out.append({
            "date": d["date"], "trips": d["trips"], "km": round(d["km"], 1), "fuel_l": round(d["fuel_l"], 2),
            "l_per_100km": round(d["fuel_l"] / d["km"] * 100, 2) if d["km"] > 0.5 else None,
            "score": round(sum(s * km for s, km in d["scores"]) / w) if d["scores"] else None,
            "harsh": d["harsh"], "ev_share": round(d["ev_m"] / d["m"], 3) if d["m"] else None,
        })
    return {"weekday_hour": weekday_hour, "daily": out}


def monthly(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    out = []
    for r in conn.execute("SELECT * FROM monthly_stats ORDER BY year, month"):
        km = (r["length_m"] or 0) / 1000
        fuel_l = (r["fuel_ml"] or 0) / 1000
        out.append({
            "year": r["year"], "month": r["month"], "km": round(km, 1), "hours": round((r["duration_s"] or 0) / 3600, 1),
            "fuel_l": round(fuel_l, 1), "l_per_100km": round(fuel_l / km * 100, 2) if km else None,
            "avg_speed": r["avg_speed"],
            "scores": {"global": r["score_global"], "acceleration": r["score_accel"], "braking": r["score_brake"],
                       "constant_speed": r["score_const"], "advice": r["score_advice"]},
            "ev_share_km": round((r["ev_dist"] or 0) / (r["length_m"] or 1), 3),
            "ev_share_time": round((r["ev_time"] or 0) / (r["duration_s"] or 1), 3),
        })
    return out


def vehicle(conn: sqlite3.Connection) -> dict[str, Any] | None:
    v = conn.execute("SELECT * FROM vehicle LIMIT 1").fetchone()
    if v is None:
        return None
    snap = conn.execute("SELECT * FROM snapshots ORDER BY ts DESC LIMIT 1").fetchone()
    first = conn.execute("SELECT MIN(start_ts) f, COUNT(*) n FROM trips").fetchone()
    return {
        "vin": v["vin"], "model": v["model"], "model_year": v["model_year"], "manufactured": v["manufactured"],
        "color": v["color"],
        "odometer_km": snap["odometer_km"] if snap else None, "fuel_level_pct": snap["fuel_pct"] if snap else None,
        "range_km": snap["range_km"] if snap else None,
        "last_location": {"lat": snap["lat"], "lon": snap["lon"], "ts": snap["ts"]} if snap else None,
        "services": [{"date": s["date"], "mileage_km": s["mileage_km"], "provider": s["provider"]}
                     for s in conn.execute("SELECT * FROM services ORDER BY date DESC")],
        "history_from": (first["f"] or "")[:10], "trips_total": first["n"],
    }
