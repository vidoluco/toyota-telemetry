"""Tank log: fills inferred from the daily fuel-level snapshot, corrected by hand.

Toyota reports the fuel level as a whole percentage in ``/v3/telemetry``; a jump of
``FILL_MIN_PCT`` points or more between two snapshots is a fill. Litres are estimated from
the tank capacity setting and can be overridden per fill together with the price paid.
"""

from __future__ import annotations

import itertools
import sqlite3
from datetime import datetime
from typing import Any

from toyota_telemetry.store import get_settings

FILL_MIN_PCT = 8
SCHEMA = """
CREATE TABLE IF NOT EXISTS fills (
  ts TEXT PRIMARY KEY, prev_ts TEXT, odometer_km INTEGER, pct_before INTEGER, pct_after INTEGER,
  litres_est REAL, litres REAL, price_per_l REAL, note TEXT);
"""


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def detect_fills(conn: sqlite3.Connection) -> int:
    """Scan snapshots in order and record every level jump as a fill (idempotent). Returns fills added."""
    ensure_schema(conn)
    cap = get_settings(conn)["tank_capacity_l"]
    snaps = conn.execute("SELECT ts, odometer_km, fuel_pct FROM snapshots WHERE fuel_pct IS NOT NULL ORDER BY ts").fetchall()
    added = 0
    for a, b in itertools.pairwise(snaps):
        if b["fuel_pct"] - a["fuel_pct"] >= FILL_MIN_PCT:
            est = round((b["fuel_pct"] - a["fuel_pct"]) / 100 * cap, 1)
            cur = conn.execute(
                "INSERT OR IGNORE INTO fills(ts, prev_ts, odometer_km, pct_before, pct_after, litres_est) VALUES (?,?,?,?,?,?)",
                (b["ts"], a["ts"], b["odometer_km"], a["fuel_pct"], b["fuel_pct"], est))
            added += cur.rowcount
    conn.commit()
    return added


def update_fill(conn: sqlite3.Connection, ts: str, litres: float | None = None, price_per_l: float | None = None,
                note: str | None = None) -> dict[str, Any] | None:
    ensure_schema(conn)
    conn.execute("UPDATE fills SET litres = COALESCE(?, litres), price_per_l = COALESCE(?, price_per_l), note = COALESCE(?, note) WHERE ts = ?",
                 (litres, price_per_l, note, ts))
    conn.commit()
    return next((f for f in fills(conn) if f["ts"] == ts), None)


def add_manual_fill(conn: sqlite3.Connection, ts: str, litres: float, price_per_l: float | None, odometer_km: int | None,
                    note: str | None = None) -> dict[str, Any]:
    ensure_schema(conn)
    conn.execute("INSERT OR REPLACE INTO fills(ts, prev_ts, odometer_km, pct_before, pct_after, litres_est, litres, price_per_l, note)"
                 " VALUES (?,?,?,?,?,?,?,?,?)", (ts, None, odometer_km, None, None, litres, litres, price_per_l, note or "manual"))
    conn.commit()
    return next(f for f in fills(conn) if f["ts"] == ts)


def fills(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Fills newest first, each with the real-world consumption since the previous fill."""
    ensure_schema(conn)
    settings = get_settings(conn)
    rows = [dict(r) for r in conn.execute("SELECT * FROM fills ORDER BY ts")]
    out = []
    for i, f in enumerate(rows):
        litres = f["litres"] if f["litres"] is not None else f["litres_est"]
        price = f["price_per_l"] if f["price_per_l"] is not None else settings["fuel_price"]
        prev = rows[i - 1] if i else None
        km = (f["odometer_km"] - prev["odometer_km"]) if prev and f["odometer_km"] and prev["odometer_km"] else None
        toyota_ml = None
        if prev:
            toyota_ml = conn.execute("SELECT COALESCE(SUM(fuel_ml),0) s FROM trips WHERE start_ts >= ? AND start_ts < ?",
                                     (prev["ts"], f["ts"])).fetchone()["s"]
        out.append({
            **f, "litres_used": litres, "price_used": price, "cost": round(litres * price, 2) if litres else None,
            "km_since_prev": km, "l_per_100km_real": round(litres / km * 100, 2) if km and litres and km > 20 else None,
            "l_per_100km_toyota": round(toyota_ml / 1000 / km * 100, 2) if km and toyota_ml and km > 20 else None,
            "estimated": f["litres"] is None,
        })
    out.reverse()
    return out


def summary(conn: sqlite3.Connection) -> dict[str, Any]:
    fs = fills(conn)
    snaps = conn.execute("SELECT * FROM snapshots ORDER BY ts").fetchall()
    last = snaps[-1] if snaps else None
    real = [f["l_per_100km_real"] for f in fs if f["l_per_100km_real"]]
    toy = [f["l_per_100km_toyota"] for f in fs if f["l_per_100km_toyota"]]
    return {
        "fills": len(fs), "litres_total": round(sum(f["litres_used"] or 0 for f in fs), 1),
        "cost_total": round(sum(f["cost"] or 0 for f in fs), 2),
        "l_per_100km_real": round(sum(real) / len(real), 2) if real else None,
        "l_per_100km_toyota": round(sum(toy) / len(toy), 2) if toy else None,
        "snapshots": len(snaps), "first_snapshot": snaps[0]["ts"] if snaps else None,
        "level_now": last["fuel_pct"] if last else None, "range_now": last["range_km"] if last else None,
        "odometer_now": last["odometer_km"] if last else None,
        "levels": [{"ts": s["ts"], "pct": s["fuel_pct"], "odometer_km": s["odometer_km"], "range_km": s["range_km"]} for s in snaps],
        "tank_capacity_l": get_settings(conn)["tank_capacity_l"],
    }


def parse_ts(v: str) -> str:
    return datetime.fromisoformat(v.replace("Z", "+00:00")).isoformat()
