"""Synthetic dataset for screenshots, demos and tests.

Trips in the shape the Toyota API returns, for a fictional driver near Grenoble: a weekday
commute, weekend errands and Sunday runs up to Chamrousse. The paths follow real roads
(geometry fetched once from the public OSRM demo server and cached in ``demo_routes.json``),
then get per-trip noise, so the map looks like driving rather than ruler lines. No real GPS
trace and no account: deterministic from a seed, so ``toyota demo`` works offline.
"""

from __future__ import annotations

import itertools
import json
import math
import random
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

ROUTES: dict[str, dict[str, Any]] = json.loads((Path(__file__).parent / "demo_routes.json").read_text())

HOME = (45.1885, 5.7245)
WORK = (45.2560, 5.8320)
SHOP = (45.1742, 5.7118)
GYM = (45.1965, 5.7502)
MOUNTAIN = (45.2960, 5.8760)  # Chamrousse road, for the 3D terrain screenshots

PLACES = {"home": HOME, "work": WORK, "shop": SHOP, "gym": GYM, "mountain": MOUNTAIN}


ROUTE_FOR = {("home", "work"): ("home_office", False), ("work", "home"): ("home_office", True),
             ("home", "shop"): ("home_shop", False), ("shop", "home"): ("home_shop", True),
             ("home", "gym"): ("home_gym", False), ("gym", "home"): ("home_gym", True),
             ("home", "mountain"): ("home_mountain", False), ("mountain", "home"): ("home_mountain", True)}


def _road(from_key: str, to_key: str, n: int, rng: random.Random) -> list[tuple[float, float]]:
    """Resample the cached road geometry to n points and add a few metres of GPS noise."""
    name, reverse = ROUTE_FOR[(from_key, to_key)]
    coords = [tuple(c) for c in ROUTES[name]["coords"]]
    if reverse:
        coords = coords[::-1]
    out: list[tuple[float, float]] = []
    span = len(coords) - 1
    for i in range(n):
        pos = i / (n - 1) * span
        lo = min(int(pos), span - 1)
        t = pos - lo
        lat = coords[lo][0] + (coords[lo + 1][0] - coords[lo][0]) * t + rng.gauss(0, 0.000035)
        lon = coords[lo][1] + (coords[lo + 1][1] - coords[lo][1]) * t + rng.gauss(0, 0.000045)
        out.append((lat, lon))
    return out


def _trip(rng: random.Random, idx: int, start: datetime, from_key: str, to_key: str,
          minutes: float, l100: float, ev_share: float, harsh: int, smooth: int, mountain: bool = False) -> dict[str, Any]:
    a, b = PLACES[from_key], PLACES[to_key]
    n_points = max(40, int(minutes * 14))
    route = _road(from_key, to_key, n_points, rng)
    km = sum(math.hypot((q[0] - p[0]) * 111.195, (q[1] - p[1]) * 111.195 * math.cos(math.radians(p[0])))
             for p, q in itertools.pairwise(route))
    a, b = route[0], route[-1]
    duration = int(minutes * 60)
    end = start + timedelta(seconds=duration)
    over_from = rng.randrange(0, max(1, len(route) - 30))
    events = []
    for _i in range(harsh):
        pos = rng.uniform(0.5, 0.98) if rng.random() < 0.5 else rng.uniform(0.1, 0.9)
        p = route[int(pos * (len(route) - 1))]
        typ, code = ("B", rng.choice([5, 13, 2])) if rng.random() < 0.6 else ("A", 25)
        events.append({"lat": round(p[0], 5), "lon": round(p[1], 5), "ts": (start + timedelta(seconds=int(pos * duration))).isoformat(),
                       "type": typ, "good": False, "coachingMsg": code, "diagnosticMsg": code, "context": {"slope": 0.0}, "priority": True, "severity": 10000.0})
    for _i in range(smooth):
        pos = rng.uniform(0.05, 0.95)
        p = route[int(pos * (len(route) - 1))]
        events.append({"lat": round(p[0], 5), "lon": round(p[1], 5), "ts": (start + timedelta(seconds=int(pos * duration))).isoformat(),
                       "type": rng.choice(["B", "A"]), "good": True, "coachingMsg": 1, "diagnosticMsg": 33, "context": {"slope": 0.0}, "priority": False, "severity": 0.0})
    events.sort(key=lambda e: e["ts"])
    return {
        "id": f"demo-{idx:04d}-0000-0000-000000000000", "category": 0, "processedIn": 7,
        "summary": {"length": int(km * 1000), "duration": duration, "averageSpeed": round(km / (duration / 3600), 2),
                    "fuelConsumption": round(km * l100 * 10, 1), "startLat": round(a[0], 5), "startLon": round(a[1], 5),
                    "startTs": start.isoformat(), "endLat": round(b[0], 5), "endLon": round(b[1], 5),
                    "endTs": end.isoformat(), "nightTrip": start.hour < 6 or start.hour >= 20},
        "scores": {"global": max(60, 96 - harsh * 6 - rng.randrange(0, 5)), "acceleration": max(60, 94 - harsh * 5),
                   "braking": max(60, 95 - harsh * 7), "advice": rng.choice([1, 5, 10, 16])},
        "hdc": {"evTime": int(duration * min(0.95, ev_share + 0.1)), "evDistance": int(km * 1000 * ev_share),
                "chargeTime": int(duration * 0.2), "chargeDist": int(km * 400), "ecoTime": int(duration * 0.6),
                "ecoDist": int(km * 600), "powerTime": int(duration * 0.05), "powerDist": int(km * 60)},
        "route": [{"lat": round(p[0], 6), "lon": round(p[1], 6), "overspeed": over_from <= i < over_from + 22,
                   "highway": mountain and 0.15 < i / len(route) < 0.35, "indexInPoints": i,
                   "mode": 0 if i % 3 else 1, "isEv": rng.random() < ev_share} for i, p in enumerate(route)],
        "behaviours": events,
    }


def generate(seed: int = 7, weeks: int = 14, end: datetime | None = None) -> dict[str, Any]:
    """A full demo payload: ``{"trips": [...], "telemetry": [...], "vehicle": {...}}``."""
    rng = random.Random(seed)
    # Local wall-clock times: a demo commute should read 07:15 for whoever runs it.
    end = end or datetime.now().astimezone().replace(hour=20, minute=0, second=0, microsecond=0)
    start_day = (end - timedelta(weeks=weeks)).date()
    trips: list[dict[str, Any]] = []
    idx = 0
    day = start_day
    while day <= end.date():
        wd = day.weekday()
        base = datetime(day.year, day.month, day.day).astimezone()

        def add(start_at: datetime, a: str, b: str, **kw: Any) -> None:
            nonlocal idx
            trips.append(_trip(rng, idx, start_at, a, b, **kw))
            idx += 1

        if wd < 5:  # commute, sometimes the gym on the way home
            hour, minute = (7, rng.choice([5, 10, 15, 20])) if rng.random() < 0.75 else (8, rng.choice([0, 15, 30]))
            slow = hour == 8
            add(base + timedelta(hours=hour, minutes=minute), "home", "work",
                minutes=(31 if slow else 22) + rng.uniform(-3, 6), l100=(5.1 if slow else 4.0) + rng.uniform(-0.3, 0.5),
                ev_share=rng.uniform(0.45, 0.75), harsh=rng.randrange(2, 5) if slow else rng.randrange(0, 3),
                smooth=rng.randrange(1, 4))
            add(base + timedelta(hours=17, minutes=rng.choice([0, 15, 30, 45])), "work", "home",
                minutes=27 + rng.uniform(-4, 12), l100=4.4 + rng.uniform(-0.4, 0.8), ev_share=rng.uniform(0.4, 0.7),
                harsh=rng.randrange(0, 4), smooth=rng.randrange(1, 3))
            if rng.random() < 0.3:
                t0 = base + timedelta(hours=19, minutes=rng.randrange(0, 40))
                add(t0, "home", "gym", minutes=11 + rng.uniform(-2, 3), l100=4.9, ev_share=0.6,
                    harsh=rng.randrange(0, 2), smooth=1)
                add(t0 + timedelta(minutes=75), "gym", "home", minutes=10 + rng.uniform(-2, 3), l100=4.6,
                    ev_share=0.65, harsh=rng.randrange(0, 2), smooth=1)
        else:  # weekend: the supermarket, and on some Sundays the mountain road
            if rng.random() < 0.8:
                t0 = base + timedelta(hours=10, minutes=rng.randrange(0, 50))
                add(t0, "home", "shop", minutes=13 + rng.uniform(-3, 4), l100=5.3 + rng.uniform(-0.5, 0.9),
                    ev_share=rng.uniform(0.5, 0.8), harsh=rng.randrange(0, 3), smooth=2)
                add(t0 + timedelta(minutes=int(rng.uniform(18, 28))), "shop", "home", minutes=12 + rng.uniform(-2, 4),
                    l100=5.0, ev_share=0.6, harsh=rng.randrange(0, 2), smooth=2)
            if wd == 6 and rng.random() < 0.45:
                t0 = base + timedelta(hours=8, minutes=rng.randrange(0, 30))
                add(t0, "home", "mountain", minutes=62 + rng.uniform(-6, 12), l100=6.2 + rng.uniform(-0.6, 1.0),
                    ev_share=rng.uniform(0.15, 0.3), harsh=rng.randrange(1, 4), smooth=3, mountain=True)
                add(t0 + timedelta(hours=5), "mountain", "home", minutes=55 + rng.uniform(-5, 10),
                    l100=3.4 + rng.uniform(-0.3, 0.4), ev_share=rng.uniform(0.4, 0.6), harsh=rng.randrange(0, 3),
                    smooth=4, mountain=True)
        day += timedelta(days=1)
    trips = [t for t in trips if datetime.fromisoformat(t["summary"]["startTs"].replace("Z", "+00:00")) <= end]
    # daily fuel level: falls with use, jumps on a fill roughly every 500 km, non-linear gauge
    telemetry = []
    odo, pct = 54_800, 96
    d = start_day
    per_day = {}
    for t in trips:
        key = t["summary"]["startTs"][:10]
        per_day[key] = per_day.get(key, 0) + t["summary"]["length"] / 1000
    while d <= end.date():
        km = per_day.get(d.isoformat(), 0.0)
        odo += int(km)
        used = km * 4.6 / 100
        pct_drop = used / 36 * 100
        pct = max(6, pct - (pct_drop * 0.55 if pct > 60 else pct_drop * 1.6))  # the gauge sits high, then drops fast
        if pct <= 20:
            pct = 97  # a fill: the level jumps back up between two daily readings
        telemetry.append({"ts": datetime(d.year, d.month, d.day, 5, 30).astimezone().isoformat(),
                          "odometer_km": odo, "fuel_pct": round(pct), "range_km": int(pct / 100 * 36 / 4.6 * 100),
                          "lat": HOME[0], "lon": HOME[1]})
        d += timedelta(days=1)
    vehicle = {"vin": "DEMOVIN0000000001", "displayModelDescription": "Toyota Yaris Hybrid (demo)", "modelName": "Yaris",
               "modelYear": "2022", "manufacturedDate": "2022-02-01", "color": "Silver Metallic", "fuelType": "B"}
    return {"trips": trips, "telemetry": telemetry, "vehicle": vehicle}


def load_into(conn, payload: dict[str, Any] | None = None, *, elevation: bool = True) -> int:
    """Write a demo payload into an open database. Returns the number of trips.

    ``elevation`` fetches the same public terrain tiles the dashboard uses, so the demo
    shows real climb figures for the mountain trips; set it to False to stay offline.
    """
    from toyota_telemetry import derive, places, store, tank

    payload = payload or generate()
    dem = derive.Elevation(store.DEM_DIR, online=True) if elevation else None
    conn.execute("INSERT OR REPLACE INTO vehicle VALUES (?,?,?,?,?,?)",
                 (payload["vehicle"]["vin"], payload["vehicle"]["displayModelDescription"], payload["vehicle"]["modelYear"],
                  payload["vehicle"]["manufacturedDate"], payload["vehicle"]["color"], "{}"))
    for s in payload["telemetry"]:
        conn.execute("INSERT OR REPLACE INTO snapshots VALUES (?,?,?,?,?,?)",
                     (s["ts"], s["odometer_km"], s["fuel_pct"], s["range_km"], s["lat"], s["lon"]))
    for t in payload["trips"]:
        store.load_trip(conn, t, elevation=dem)
    conn.commit()
    places.cluster_places(conn)
    tank.detect_fills(conn)
    # Two receipts already typed in, the newest fill still an estimate: the tank log shows both states.
    priced = tank.fills(conn)[1:]
    rng = random.Random(11)
    for f in priced:
        tank.update_fill(conn, f["ts"], litres=round((f["litres_est"] or 30) * rng.uniform(0.92, 1.08), 1),
                         price_per_l=round(rng.uniform(1.72, 1.84), 2), note="receipt")
    # name the two obvious places so the demo reads well
    for pid, name in _match_names(conn):
        places.rename_place(conn, pid, name)
    return len(payload["trips"])


def _match_names(conn) -> list[tuple[int, str]]:
    from toyota_telemetry import derive

    out = []
    for r in conn.execute("SELECT id, lat, lon FROM places"):
        for name, (lat, lon) in (("Home", HOME), ("Office", WORK), ("Supermarket", SHOP), ("Gym", GYM), ("Chamrousse", MOUNTAIN)):
            if derive.haversine_m(r["lat"], r["lon"], lat, lon) < 400:
                out.append((r["id"], name))
                break
    return out
