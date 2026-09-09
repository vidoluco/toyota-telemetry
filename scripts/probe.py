"""Print what the Toyota cloud returns for the car on this account.

Run it once before the first sync: it shows the endpoints that answer, the shape of a
trip, and how many trips exist, without writing anything to the database.

    uv run python scripts/probe.py [days]
"""

from __future__ import annotations

import asyncio
import json
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

from toyota_telemetry.toyota import RAW_DIR, ToyotaRaw, load_env

ENDPOINTS = (("telemetry", "/v3/telemetry"), ("location", "/v1/location"), ("health", "/v1/vehiclehealth/status"),
             ("service history", "/v1/servicehistory/vehicle/summary"))


def keys_of(items: list[dict]) -> list[str]:
    c: Counter = Counter()
    for it in items:
        c.update(it.keys())
    return sorted(c)


async def main(days: int) -> None:
    user, pwd = load_env()
    async with ToyotaRaw(user, pwd) as api:
        cars = await api.vehicles()
        if not cars:
            sys.exit("Login worked but no vehicle is linked to this account.")
        for car in cars:
            vin = car["vin"]
            print(f"\n== {car.get('displayModelDescription')}  fuel {car.get('fuelType')}  "
                  f"driving analytics: {'yes' if car.get('features', {}).get('drivingAnalytics') else 'no'}")
            for name, ep in ENDPOINTS:
                try:
                    payload = (await api.get(ep, vin)).get("payload")
                    print(f"   {name}: {json.dumps(payload)[:160]}")
                except Exception as e:
                    print(f"   {name}: {type(e).__name__} {str(e)[:100]}")
            today = date.today()
            trips = (await api.trips(vin, today - timedelta(days=days), today))["trips"]
            RAW_DIR.mkdir(parents=True, exist_ok=True)
            out = RAW_DIR / "probe.json"
            out.write_text(json.dumps(trips, indent=1, default=str))
            print(f"   trips in the last {days} days: {len(trips)}  ->  {out.relative_to(Path.cwd()) if out.is_relative_to(Path.cwd()) else out}")
            if trips:
                print(f"   trip keys: {keys_of(trips)}")
                print(f"   summary keys: {keys_of([t.get('summary') or {} for t in trips])}")
                routes = [p for t in trips for p in (t.get("route") or [])]
                events = [b for t in trips for b in (t.get("behaviours") or [])]
                print(f"   route points: {len(routes)}  keys: {keys_of(routes)}")
                print(f"   behaviour events: {len(events)}  types: {Counter(b.get('type') for b in events)}")


if __name__ == "__main__":
    asyncio.run(main(int(sys.argv[1]) if len(sys.argv) > 1 else 30))
