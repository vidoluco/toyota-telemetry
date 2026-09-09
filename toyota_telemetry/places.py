"""Places, journeys and the commute coach.

A place is a cluster of trip start or end points within ``PLACE_RADIUS_M``. Names live in
the ``places`` table (auto-created, editable). A journey is an ordered pair of places; a
commute is a journey driven at least ``COMMUTE_MIN_TRIPS`` times.
"""

from __future__ import annotations

import itertools
import sqlite3
from collections import defaultdict
from datetime import datetime
from typing import Any

from toyota_telemetry import derive
from toyota_telemetry.store import get_settings

PLACE_RADIUS_M = 250.0
COMMUTE_MIN_TRIPS = 5
CHAIN_GAP_MIN = 30
SLOT_MIN = 15

SCHEMA = """
CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY, lat REAL, lon REAL, name TEXT, auto_name TEXT, visits INTEGER, created_ts TEXT);
CREATE TABLE IF NOT EXISTS trip_places (
  trip_id TEXT PRIMARY KEY, start_place INTEGER, end_place INTEGER);
"""


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def _local(ts: str) -> datetime:
    return datetime.fromisoformat(ts).astimezone()


def _range(from_date: str | None, to_date: str | None, col: str = "t.start_ts") -> tuple[str, list[Any]]:
    """SQL fragment and parameters for an inclusive date window on trips."""
    clauses, params = [], []
    if from_date:
        clauses.append(f"{col} >= ?")
        params.append(from_date)
    if to_date:
        clauses.append(f"{col} < ?")
        params.append(to_date + "T99")
    return (" AND " + " AND ".join(clauses)) if clauses else "", params


def cluster_places(conn: sqlite3.Connection, radius_m: float = PLACE_RADIUS_M) -> int:
    """Assign every trip start and end to a place, creating places as needed.

    Existing places keep their id and name; a new point joins the nearest existing place
    within ``radius_m`` (ties resolved by distance), otherwise it founds a new one.
    Returns the number of places.
    """
    ensure_schema(conn)
    places = [dict(r) for r in conn.execute("SELECT * FROM places ORDER BY id")]

    def assign(lat: float | None, lon: float | None) -> int | None:
        if lat is None or lon is None:
            return None
        best, best_d = None, radius_m
        for p in places:
            d = derive.haversine_m(lat, lon, p["lat"], p["lon"])
            if d <= best_d:
                best, best_d = p, d
        if best is None:
            cur = conn.execute("INSERT INTO places(lat, lon, name, auto_name, visits, created_ts) VALUES (?,?,?,?,?,?)",
                               (lat, lon, None, None, 0, datetime.now().astimezone().isoformat()))
            best = {"id": cur.lastrowid, "lat": lat, "lon": lon, "name": None, "visits": 0}
            places.append(best)
        return best["id"]

    trips = conn.execute("SELECT id, start_lat, start_lon, end_lat, end_lon FROM trips ORDER BY start_ts").fetchall()
    for t in trips:
        s = assign(t["start_lat"], t["start_lon"])
        e = assign(t["end_lat"], t["end_lon"])
        conn.execute("INSERT OR REPLACE INTO trip_places VALUES (?,?,?)", (t["id"], s, e))
    # visit counts and auto names
    counts: dict[int, int] = defaultdict(int)
    for r in conn.execute("SELECT start_place, end_place FROM trip_places"):
        counts[r["start_place"]] += 1
        counts[r["end_place"]] += 1
    for p in places:
        conn.execute("UPDATE places SET visits = ? WHERE id = ?", (counts.get(p["id"], 0), p["id"]))
    _auto_names(conn)
    conn.commit()
    return len(places)


def _auto_names(conn: sqlite3.Connection) -> None:
    """Heuristic labels for unnamed places: the most visited is Home, the busiest weekday
    place with midday arrivals is Work; the rest get 'Place N'. Never overrides a user name."""
    rows = [dict(r) for r in conn.execute("SELECT * FROM places ORDER BY visits DESC, id")]
    if not rows:
        return
    home = rows[0]["id"]
    work = None
    best = 0
    for p in rows[1:]:
        n = conn.execute(
            "SELECT COUNT(*) c FROM trip_places tp JOIN trips t ON t.id = tp.trip_id WHERE tp.end_place = ?"
            " AND CAST(strftime('%w', t.end_ts) AS INT) BETWEEN 1 AND 5", (p["id"],)).fetchone()["c"]
        if n >= 4 and n > best:
            work, best = p["id"], n
    for i, p in enumerate(rows):
        auto = "Home" if p["id"] == home else "Work" if p["id"] == work else f"Place {i + 1}"
        conn.execute("UPDATE places SET auto_name = ? WHERE id = ?", (auto, p["id"]))


def rename_place(conn: sqlite3.Connection, place_id: int, name: str | None) -> dict[str, Any] | None:
    ensure_schema(conn)
    conn.execute("UPDATE places SET name = ? WHERE id = ?", (name.strip() if name else None, place_id))
    conn.commit()
    row = conn.execute("SELECT * FROM places WHERE id = ?", (place_id,)).fetchone()
    return _place_dict(conn, row) if row else None


def _label(p: sqlite3.Row | dict[str, Any]) -> str:
    return p["name"] or p["auto_name"] or f"Place {p['id']}"


def _place_dict(conn: sqlite3.Connection, p: sqlite3.Row, from_date: str | None = None, to_date: str | None = None) -> dict[str, Any]:
    settings = get_settings(conn)
    rng, rp = _range(from_date, to_date)
    agg = conn.execute(
        f"""SELECT COUNT(*) n, COALESCE(SUM(t.length_m),0) m, COALESCE(SUM(t.fuel_ml),0) ml, SUM(t.harsh_brake + t.harsh_accel) harsh,
                  MIN(t.start_ts) first_ts, MAX(t.start_ts) last_ts
           FROM trip_places tp JOIN trips t ON t.id = tp.trip_id WHERE tp.end_place = ?{rng}""", (p["id"], *rp)).fetchone()
    starts = conn.execute(f"SELECT COUNT(*) c FROM trip_places tp JOIN trips t ON t.id = tp.trip_id WHERE tp.start_place = ?{rng}", (p["id"], *rp)).fetchone()["c"]
    ends = conn.execute(f"SELECT COUNT(*) c FROM trip_places tp JOIN trips t ON t.id = tp.trip_id WHERE tp.end_place = ?{rng}", (p["id"], *rp)).fetchone()["c"]
    # dwell: time between arriving here and the next departure from here
    dwell = []
    arrivals = conn.execute(
        f"SELECT t.end_ts FROM trip_places tp JOIN trips t ON t.id = tp.trip_id WHERE tp.end_place = ?{rng} ORDER BY t.end_ts", (p["id"], *rp)).fetchall()
    departures = [r["start_ts"] for r in conn.execute(
        f"SELECT t.start_ts FROM trip_places tp JOIN trips t ON t.id = tp.trip_id WHERE tp.start_place = ?{rng} ORDER BY t.start_ts", (p["id"], *rp))]
    for a in arrivals:
        nxt = next((d for d in departures if d > a["end_ts"]), None)
        if nxt:
            dwell.append((datetime.fromisoformat(nxt) - datetime.fromisoformat(a["end_ts"])).total_seconds() / 60)
    hours = defaultdict(int)
    for r in conn.execute(f"SELECT t.end_ts FROM trip_places tp JOIN trips t ON t.id = tp.trip_id WHERE tp.end_place = ?{rng}", (p["id"], *rp)):
        hours[_local(r["end_ts"]).hour] += 1
    return {
        "id": p["id"], "lat": p["lat"], "lon": p["lon"], "name": p["name"], "auto_name": p["auto_name"], "label": _label(p),
        "visits": starts + ends, "departures": starts, "arrivals": ends,
        "km_to_here": round(agg["m"] / 1000, 1), "fuel_l_to_here": round(agg["ml"] / 1000, 2),
        "cost_to_here": round(agg["ml"] / 1000 * settings["fuel_price"], 2), "harsh_to_here": agg["harsh"] or 0,
        "dwell_median_min": round(sorted(dwell)[len(dwell) // 2]) if dwell else None,
        "first_ts": agg["first_ts"], "last_ts": agg["last_ts"],
        "arrival_hours": [{"hour": h, "n": n} for h, n in sorted(hours.items())],
    }


def places(conn: sqlite3.Connection, from_date: str | None = None, to_date: str | None = None) -> list[dict[str, Any]]:
    """Places with their stats. With a date window, only trips inside it are counted and
    places with no trip in the window are dropped."""
    ensure_schema(conn)
    out = [_place_dict(conn, r, from_date, to_date) for r in conn.execute("SELECT * FROM places ORDER BY visits DESC, id")]
    if from_date or to_date:
        out = [p for p in out if p["visits"] > 0]
        out.sort(key=lambda p: -p["visits"])
    return out


def journeys(conn: sqlite3.Connection, min_trips: int = 1, from_date: str | None = None, to_date: str | None = None) -> list[dict[str, Any]]:
    """Ordered place pairs with counts and medians, most driven first."""
    ensure_schema(conn)
    settings = get_settings(conn)
    names = {r["id"]: _label(r) for r in conn.execute("SELECT * FROM places")}
    rng, rp = _range(from_date, to_date)
    groups: dict[tuple[int, int], list[sqlite3.Row]] = defaultdict(list)
    for r in conn.execute(f"SELECT tp.start_place s, tp.end_place e, t.* FROM trip_places tp JOIN trips t ON t.id = tp.trip_id WHERE 1=1{rng} ORDER BY t.start_ts", rp):
        if r["s"] is not None and r["e"] is not None:
            groups[(r["s"], r["e"])].append(r)
    out = []
    for (s, e), rows in groups.items():
        if len(rows) < min_trips:
            continue
        durs = sorted(r["duration_s"] for r in rows)
        kms = sorted(r["length_m"] for r in rows)
        l100 = sorted((r["fuel_ml"] / r["length_m"] * 100) for r in rows if r["length_m"] > 500)
        out.append({
            "from": s, "to": e, "from_label": names.get(s), "to_label": names.get(e), "trips": len(rows),
            "is_commute": len(rows) >= COMMUTE_MIN_TRIPS, "loop": s == e,
            "duration_median_min": round(durs[len(durs) // 2] / 60), "duration_min_min": round(durs[0] / 60), "duration_max_min": round(durs[-1] / 60),
            "km_median": round(kms[len(kms) // 2] / 1000, 1),
            "l_per_100km_median": round(l100[len(l100) // 2], 2) if l100 else None,
            "cost_total": round(sum(r["fuel_ml"] for r in rows) / 1000 * settings["fuel_price"], 2),
            "harsh_per_trip": round(sum(r["harsh_brake"] + r["harsh_accel"] for r in rows) / len(rows), 2),
            "ev_share": round(sum(r["ev_dist"] or 0 for r in rows) / max(sum(r["length_m"] for r in rows), 1), 3),
            "last_ts": rows[-1]["start_ts"], "trip_ids": [r["id"] for r in rows],
        })
    out.sort(key=lambda j: -j["trips"])
    return out


def commute(conn: sqlite3.Connection, from_place: int, to_place: int) -> dict[str, Any] | None:
    """The coach view for one journey: every run, departure-slot comparison, best run, findings."""
    ensure_schema(conn)
    settings = get_settings(conn)
    rows = conn.execute(
        "SELECT t.* FROM trip_places tp JOIN trips t ON t.id = tp.trip_id WHERE tp.start_place = ? AND tp.end_place = ? ORDER BY t.start_ts",
        (from_place, to_place)).fetchall()
    if not rows:
        return None
    runs = []
    for r in rows:
        d = _local(r["start_ts"])
        harsh = (r["harsh_brake"] or 0) + (r["harsh_accel"] or 0)
        late = conn.execute(
            "SELECT COUNT(*) c FROM events WHERE trip_id = ? AND harsh = 1 AND (julianday(ts) - julianday(?)) * 86400 > ? * 0.9",
            (r["id"], r["start_ts"], r["duration_s"])).fetchone()["c"]
        runs.append({
            "id": r["id"], "start_ts": r["start_ts"], "weekday": d.weekday(), "hour": d.hour, "minute": d.minute,
            "slot": f"{d.hour:02d}:{(d.minute // SLOT_MIN) * SLOT_MIN:02d}", "duration_min": round(r["duration_s"] / 60, 1),
            "km": round(r["length_m"] / 1000, 2), "l_per_100km": round(r["fuel_ml"] / r["length_m"] * 100, 2) if r["length_m"] > 500 else None,
            "cost": round(r["fuel_ml"] / 1000 * settings["fuel_price"], 2), "score": r["score_global"], "harsh": harsh,
            "harsh_arrival": late, "ev_share": round((r["ev_dist"] or 0) / max(r["length_m"], 1), 3), "night": bool(r["night"]),
        })
    # departure slots
    slots: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for run in runs:
        slots[run["slot"]].append(run)
    slot_rows = []
    for slot, rs in sorted(slots.items()):
        durs = sorted(x["duration_min"] for x in rs)
        l100 = [x["l_per_100km"] for x in rs if x["l_per_100km"] is not None]
        slot_rows.append({"slot": slot, "runs": len(rs), "duration_median_min": durs[len(durs) // 2],
                          "l_per_100km_median": round(sorted(l100)[len(l100) // 2], 2) if l100 else None,
                          "harsh_per_run": round(sum(x["harsh"] for x in rs) / len(rs), 2),
                          "score_avg": round(sum(x["score"] or 0 for x in rs) / len(rs))})
    typical = sorted(x["duration_min"] for x in runs)[len(runs) // 2]
    comparable = [x for x in runs if x["l_per_100km"] is not None and x["km"] >= 0.7 * sorted(r["km"] for r in runs)[len(runs) // 2]]
    best = min(comparable, key=lambda x: (x["harsh"], x["l_per_100km"] or 99, x["duration_min"])) if comparable else runs[0]
    findings = _findings(runs, slot_rows, typical, best)
    return {"from": from_place, "to": to_place, "runs": runs, "slots": slot_rows, "typical_duration_min": typical,
            "best_run": best["id"], "findings": findings,
            "harsh_arrival_share": round(sum(x["harsh_arrival"] for x in runs) / max(sum(x["harsh"] for x in runs), 1), 2)}


def _findings(runs: list[dict[str, Any]], slots: list[dict[str, Any]], typical: float, best: dict[str, Any]) -> list[str]:
    out = []
    busy = [s for s in slots if s["runs"] >= 3]
    if len(busy) >= 2:
        fast = min(busy, key=lambda s: s["duration_median_min"])
        slow = max(busy, key=lambda s: s["duration_median_min"])
        if slow["duration_median_min"] - fast["duration_median_min"] >= 3:
            out.append(f"Leaving around {fast['slot']} takes {fast['duration_median_min']:.0f} min, around {slow['slot']} it takes "
                       f"{slow['duration_median_min']:.0f}: {slow['duration_median_min'] - fast['duration_median_min']:.0f} min saved per run.")
        calm = min(busy, key=lambda s: s["harsh_per_run"])
        rough = max(busy, key=lambda s: s["harsh_per_run"])
        if rough["harsh_per_run"] - calm["harsh_per_run"] >= 1:
            out.append(f"Runs around {rough['slot']} carry {rough['harsh_per_run']:.1f} harsh events each, around {calm['slot']} only {calm['harsh_per_run']:.1f}.")
    total_harsh = sum(x["harsh"] for x in runs)
    arrival = sum(x["harsh_arrival"] for x in runs)
    if total_harsh >= 5 and arrival / total_harsh >= 0.25:
        out.append(f"{arrival} of {total_harsh} harsh events on this route happen in the last tenth of the trip: the arrival, not the road.")
    l100 = [x["l_per_100km"] for x in runs if x["l_per_100km"] is not None]
    if l100 and best.get("l_per_100km") is not None:
        med = sorted(l100)[len(l100) // 2]
        if med - best["l_per_100km"] >= 0.5:
            out.append(f"Your best run used {best['l_per_100km']:.2f} l/100km against a typical {med:.2f}: "
                       f"{(1 - best['l_per_100km'] / med) * 100:.0f}% less fuel on the same route.")
    ev = [x["ev_share"] for x in runs]
    if ev and max(ev) - min(ev) >= 0.25:
        out.append(f"Electric share on this route swings from {min(ev) * 100:.0f}% to {max(ev) * 100:.0f}%; the high runs are the cheap ones.")
    if not out:
        out.append("Runs on this route are consistent; nothing stands out yet.")
    return out


def chains(conn: sqlite3.Connection, gap_min: int = CHAIN_GAP_MIN, from_date: str | None = None, to_date: str | None = None) -> list[dict[str, Any]]:
    """Sequences of trips separated by less than ``gap_min`` minutes: errand runs."""
    ensure_schema(conn)
    names = {r["id"]: _label(r) for r in conn.execute("SELECT * FROM places")}
    rng, rp = _range(from_date, to_date)
    rows = conn.execute(f"SELECT t.*, tp.start_place s, tp.end_place e FROM trips t LEFT JOIN trip_places tp ON tp.trip_id = t.id WHERE 1=1{rng} ORDER BY t.start_ts", rp).fetchall()
    out: list[dict[str, Any]] = []
    cur: list[sqlite3.Row] = []
    for a, b in itertools.pairwise(rows):
        gap = (datetime.fromisoformat(b["start_ts"]) - datetime.fromisoformat(a["end_ts"])).total_seconds() / 60
        if not cur:
            cur = [a]
        if gap < gap_min:
            cur.append(b)
        else:
            if len(cur) >= 2:
                out.append(_chain_dict(cur, names))
            cur = []
    if len(cur) >= 2:
        out.append(_chain_dict(cur, names))
    out.sort(key=lambda c: c["start_ts"], reverse=True)
    return out


def _chain_dict(legs: list[sqlite3.Row], names: dict[int, str]) -> dict[str, Any]:
    stops = [names.get(legs[0]["s"], "?")] + [names.get(leg["e"], "?") for leg in legs]
    return {"start_ts": legs[0]["start_ts"], "end_ts": legs[-1]["end_ts"], "legs": len(legs), "stops": stops,
            "km": round(sum(leg["length_m"] for leg in legs) / 1000, 1), "trip_ids": [leg["id"] for leg in legs],
            "minutes": round((datetime.fromisoformat(legs[-1]["end_ts"]) - datetime.fromisoformat(legs[0]["start_ts"])).total_seconds() / 60)}
