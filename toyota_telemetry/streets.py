"""Streets where you speed: over-limit route segments clustered across trips.

The car flags each GPS point with ``overspeed``. Consecutive flagged points in a trip form
a segment; segment midpoints are grouped into cells of about ``CELL_M`` metres, so the same
stretch of road driven on different days lands in the same cluster.
"""

from __future__ import annotations

import math
import sqlite3
from collections import defaultdict
from typing import Any

from toyota_telemetry import derive

CELL_M = 120.0
MIN_SEGMENT_M = 40.0


def _cell(lat: float, lon: float, cell_m: float) -> tuple[int, int]:
    dlat = cell_m / 111_195.0
    dlon = cell_m / (111_195.0 * math.cos(math.radians(lat)))
    return int(lat // dlat), int(lon // dlon)


def segments(conn: sqlite3.Connection, from_date: str | None = None, to_date: str | None = None) -> list[dict[str, Any]]:
    """Over-limit segments: one per unbroken run of flagged points in a trip."""
    where, params = "", []
    if from_date:
        where += " AND t.start_ts >= ?"
        params.append(from_date)
    if to_date:
        where += " AND t.start_ts < ?"
        params.append(to_date + "T99")
    rows = conn.execute(
        f"""SELECT rp.trip_id, rp.idx, rp.lat, rp.lon, rp.overspeed, rp.highway, rp.speed_est, rp.dist_m, rp.t_est, t.start_ts
            FROM route_points rp JOIN trips t ON t.id = rp.trip_id WHERE 1=1{where} ORDER BY rp.trip_id, rp.idx""", params).fetchall()
    out: list[dict[str, Any]] = []
    cur: list[sqlite3.Row] = []

    def flush() -> None:
        if len(cur) < 2:
            return
        length = cur[-1]["dist_m"] - cur[0]["dist_m"]
        if length < MIN_SEGMENT_M:
            return
        mid = cur[len(cur) // 2]
        speeds = [r["speed_est"] or 0 for r in cur]
        out.append({"trip_id": cur[0]["trip_id"], "start_ts": cur[0]["start_ts"], "length_m": round(length, 1),
                    "seconds": round(cur[-1]["t_est"] - cur[0]["t_est"], 1), "speed_avg": round(sum(speeds) / len(speeds), 1),
                    "speed_max": round(max(speeds), 1), "highway": bool(mid["highway"]), "mid": (mid["lat"], mid["lon"]),
                    "coords": [(r["lat"], r["lon"]) for r in cur]})

    prev_trip = None
    for r in rows:
        if r["trip_id"] != prev_trip:
            flush()
            cur = []
            prev_trip = r["trip_id"]
        if r["overspeed"]:
            cur.append(r)
        else:
            flush()
            cur = []
    flush()
    return out


def clusters(conn: sqlite3.Connection, from_date: str | None = None, to_date: str | None = None,
             cell_m: float = CELL_M, min_trips: int = 2) -> list[dict[str, Any]]:
    """Group segments by road cell, rank by how often and how far you were over the limit there."""
    groups: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for s in segments(conn, from_date, to_date):
        groups[_cell(s["mid"][0], s["mid"][1], cell_m)].append(s)
    out = []
    for key, segs in groups.items():
        trips = {s["trip_id"] for s in segs}
        if len(trips) < min_trips:
            continue
        lat = sum(s["mid"][0] for s in segs) / len(segs)
        lon = sum(s["mid"][1] for s in segs) / len(segs)
        longest = max(segs, key=lambda s: s["length_m"])
        out.append({
            "id": f"{key[0]}_{key[1]}", "lat": round(lat, 6), "lon": round(lon, 6), "trips": len(trips), "segments": len(segs),
            "km_over": round(sum(s["length_m"] for s in segs) / 1000, 2), "seconds_over": round(sum(s["seconds"] for s in segs)),
            "speed_avg": round(sum(s["speed_avg"] for s in segs) / len(segs), 1), "speed_max": round(max(s["speed_max"] for s in segs), 1),
            "highway": sum(1 for s in segs if s["highway"]) > len(segs) / 2, "last_ts": max(s["start_ts"] for s in segs),
            "line": [[lo, la] for la, lo in derive.simplify(longest["coords"], 0.00003)],
            "score": round(len(trips) * sum(s["length_m"] for s in segs) / 1000, 2),
        })
    out.sort(key=lambda c: -c["score"])
    return out


def clusters_geojson(cl: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "LineString", "coordinates": c["line"]},
         "properties": {k: v for k, v in c.items() if k != "line"}} for c in cl if len(c["line"]) >= 2]}
