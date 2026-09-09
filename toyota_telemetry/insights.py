"""Insights: a weekly digest computed from the local data, no model, no cloud.

Weeks run Monday to Sunday in the machine's local time zone. Each digest compares the week
with the previous one and pulls the notable items from places, streets, hotspots and tank.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta
from typing import Any

from toyota_telemetry import analytics, places, streets, tank
from toyota_telemetry.store import get_settings


def week_bounds(day: date) -> tuple[date, date]:
    start = day - timedelta(days=day.weekday())
    return start, start + timedelta(days=6)


def weeks_available(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    row = conn.execute("SELECT MIN(start_ts) a, MAX(start_ts) b FROM trips").fetchone()
    if not row["a"]:
        return []
    first = week_bounds(datetime.fromisoformat(row["a"]).astimezone().date())[0]
    last = week_bounds(datetime.fromisoformat(row["b"]).astimezone().date())[0]
    out = []
    cur = last
    while cur >= first:
        out.append({"start": cur.isoformat(), "end": (cur + timedelta(days=6)).isoformat()})
        cur -= timedelta(days=7)
    return out


def _delta(cur: float | None, prev: float | None) -> float | None:
    if cur is None or prev is None:
        return None
    return round(cur - prev, 2)


def digest(conn: sqlite3.Connection, week_start: date | None = None) -> dict[str, Any]:
    """The digest for the week containing ``week_start`` (default: the latest week with trips)."""
    weeks = weeks_available(conn)
    if not weeks:
        return {"empty": True}
    if week_start is None:
        week_start = date.fromisoformat(weeks[0]["start"])
    ws, we = week_bounds(week_start)
    pws, pwe = ws - timedelta(days=7), ws - timedelta(days=1)
    cur = analytics.summary(conn, ws.isoformat(), we.isoformat())
    prev = analytics.summary(conn, pws.isoformat(), pwe.isoformat())
    trips = analytics.trips(conn, ws.isoformat(), we.isoformat())
    hot = analytics.hotspots(conn, ws.isoformat(), we.isoformat(), 60, 2)
    all_hot = analytics.hotspots(conn, None, None, 60, 3)
    street = streets.clusters(conn, ws.isoformat(), we.isoformat(), min_trips=1)[:3]
    journeys = places.journeys(conn, 2)
    week_ids = {t["id"] for t in trips}
    week_journeys = [{**j, "trips_this_week": len([i for i in j["trip_ids"] if i in week_ids])} for j in journeys]
    week_journeys = [j for j in week_journeys if j["trips_this_week"]]
    week_journeys.sort(key=lambda j: -j["trips_this_week"])
    fills = [f for f in tank.fills(conn) if ws.isoformat() <= f["ts"][:10] <= we.isoformat()]
    worst = min(trips, key=lambda t: (t["scores"]["global"] or 100, -t["km"]), default=None) if trips else None
    best = max((t for t in trips if t["km"] > 2), key=lambda t: (t["scores"]["global"] or 0, t["km"]), default=None)
    headlines = _headlines(cur, prev, hot, all_hot, street, week_journeys, fills, worst, get_settings(conn)["currency"])
    return {
        "week": {"start": ws.isoformat(), "end": we.isoformat()},
        "summary": cur, "previous": prev,
        "delta": {k: _delta(cur.get(k), prev.get(k)) for k in ("km", "fuel_l", "l_per_100km", "cost", "harsh_per_100km", "ev_share_km")},
        "score_delta": _delta(cur["scores"]["global"], prev["scores"]["global"]),
        "headlines": headlines,
        "hotspots": hot[:5], "streets": street, "journeys": week_journeys[:5], "fills": fills,
        "worst_trip": worst, "best_trip": best,
        "days": analytics.heatmap(conn, ws.isoformat(), we.isoformat())["daily"],
    }


def _headlines(cur, prev, hot, all_hot, street, journeys, fills, worst, cur_sym: str) -> list[str]:
    h: list[str] = []
    if cur["trips"] == 0:
        return ["No trips this week."]
    if prev["trips"]:
        d = cur["km"] - prev["km"]
        h.append(f"{cur['km']:.0f} km in {cur['trips']} trip{'s' if cur['trips'] != 1 else ''}, {abs(d):.0f} km {'more' if d >= 0 else 'less'} than last week, {cur['cost']:.0f} {cur_sym} on fuel.")
    else:
        h.append(f"{cur['km']:.0f} km in {cur['trips']} trip{'s' if cur['trips'] != 1 else ''}, {cur['cost']:.0f} {cur_sym} on fuel.")
    if cur["scores"]["global"] is not None and prev["scores"]["global"] is not None:
        sd = cur["scores"]["global"] - prev["scores"]["global"]
        if abs(sd) >= 2:
            h.append(f"Driver score {'up' if sd > 0 else 'down'} {abs(sd)} points to {cur['scores']['global']}.")
    if cur["l_per_100km"] and prev["l_per_100km"]:
        cd = cur["l_per_100km"] - prev["l_per_100km"]
        if abs(cd) >= 0.3:
            h.append(f"Consumption {cur['l_per_100km']:.2f} l/100km, {'up' if cd > 0 else 'down'} {abs(cd):.2f} on last week; electric share {cur['ev_share_km'] * 100:.0f}%.")
    if hot:
        top = hot[0]
        known = any(abs(a["lat"] - top["lat"]) < 0.001 and abs(a["lon"] - top["lon"]) < 0.001 for a in all_hot)
        n = len(top['trips'])
        h.append(f"{'Again' if known else 'New this week'}: {top['count']} harsh events at the same spot ({top['label']}), {n} trip{'s' if n != 1 else ''}.")
    if street:
        s = street[0]
        h.append(f"Most over the limit on one stretch: {s['km_over']:.1f} km across {s['trips']} trip{'s' if s['trips'] != 1 else ''} at about {s['speed_avg']:.0f} km/h.")
    if journeys:
        j = journeys[0]
        h.append(f"Most driven route: {j['from_label']} to {j['to_label']}, {j['trips_this_week']} times, typically {j['duration_median_min']} min.")
    if fills:
        h.append(f"{len(fills)} fill{'s' if len(fills) > 1 else ''}, {sum(f['litres_used'] or 0 for f in fills):.0f} litres.")
    if worst and worst["scores"]["global"] is not None and worst["scores"]["global"] < 70:
        h.append(f"Roughest trip: {worst['start_ts'][:10]} with score {worst['scores']['global']}, {worst['events']['harsh_brake'] + worst['events']['harsh_accel']} harsh events over {worst['km']:.1f} km.")
    return h
