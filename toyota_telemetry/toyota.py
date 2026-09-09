"""Thin raw client over pytoyoda's authenticated controller.

pytoyoda's typed vehicle model rejects this car (missing ``remoteDisplay``), so
every call here reads the raw JSON straight from the controller.
"""

from __future__ import annotations

import json
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from loguru import logger
from pytoyoda import MyT
from pytoyoda.const import (
    VEHICLE_GUID_ENDPOINT,
    VEHICLE_HEALTH_STATUS_ENDPOINT,
    VEHICLE_LOCATION_ENDPOINT,
    VEHICLE_NOTIFICATION_HISTORY_ENDPOINT,
    VEHICLE_SERVICE_HISTORY_ENDPONT,
    VEHICLE_TELEMETRY_ENDPOINT,
    VEHICLE_TRIPS_ENDPOINT,
)

logger.disable("pytoyoda")

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"


def load_env(root: Path = ROOT) -> tuple[str, str]:
    env = root / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    user = os.environ.get("MYTOYOTA_USERNAME")
    pwd = os.environ.get("MYTOYOTA_PASSWORD")
    if not user or not pwd:
        raise SystemExit("MYTOYOTA_USERNAME / MYTOYOTA_PASSWORD missing: copy .env.example to .env")
    return user, pwd


class ToyotaRaw:
    """Async context manager returning raw JSON from the Toyota EU API."""

    def __init__(self, username: str, password: str) -> None:
        self._client = MyT(username=username, password=password)

    async def __aenter__(self) -> ToyotaRaw:
        await self._client.login()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self._client.aclose()

    async def get(self, endpoint: str, vin: str | None = None) -> dict[str, Any]:
        return await self._client._api.controller.request_json("GET", endpoint, vin=vin)

    async def vehicles(self) -> list[dict[str, Any]]:
        return (await self.get(VEHICLE_GUID_ENDPOINT)).get("payload") or []

    async def telemetry(self, vin: str) -> dict[str, Any]:
        return (await self.get(VEHICLE_TELEMETRY_ENDPOINT, vin)).get("payload") or {}

    async def location(self, vin: str) -> dict[str, Any]:
        return (await self.get(VEHICLE_LOCATION_ENDPOINT, vin)).get("payload") or {}

    async def health(self, vin: str) -> dict[str, Any]:
        return (await self.get(VEHICLE_HEALTH_STATUS_ENDPOINT, vin)).get("payload") or {}

    async def notifications(self, vin: str) -> Any:
        return (await self.get(VEHICLE_NOTIFICATION_HISTORY_ENDPOINT, vin)).get("payload")

    async def service_history(self, vin: str) -> Any:
        return (await self.get(VEHICLE_SERVICE_HISTORY_ENDPONT, vin)).get("payload")

    async def trips(self, vin: str, from_date: date, to_date: date, *, summary: bool = False) -> dict[str, Any]:
        """All trips in [from_date, to_date] with full routes, paginated. Returns the merged payload."""
        merged: dict[str, Any] = {"trips": []}
        offset = 0
        while True:
            endpoint = VEHICLE_TRIPS_ENDPOINT.format(
                from_date=from_date, to_date=to_date, route=True,
                summary=summary and offset == 0, limit=50, offset=offset,
            )
            payload = (await self.get(endpoint, vin)).get("payload") or {}
            merged["trips"].extend(payload.get("trips") or [])
            if "summary" in payload and "summary" not in merged:
                merged["summary"] = payload["summary"]
            offset = ((payload.get("_metadata") or {}).get("pagination") or {}).get("nextOffset")
            if offset is None:
                return merged


def month_windows(start: date, end: date) -> list[tuple[date, date]]:
    """Calendar-month windows covering [start, end], clipped to both ends."""
    out: list[tuple[date, date]] = []
    cur = start
    while cur <= end:
        nxt = (cur.replace(day=1) + timedelta(days=32)).replace(day=1)
        out.append((cur, min(nxt - timedelta(days=1), end)))
        cur = nxt
    return out


async def pull_all(vin: str, start: date, end: date, *, refresh_from: date | None = None) -> list[Path]:
    """Download every month window into data/raw/trips/YYYY-MM.json (cached).

    Months before ``refresh_from`` that already exist on disk are skipped.
    """
    user, pwd = load_env()
    written: list[Path] = []
    trips_dir = RAW_DIR / "trips"
    trips_dir.mkdir(parents=True, exist_ok=True)
    async with ToyotaRaw(user, pwd) as api:
        for name, coro in (
            ("vehicles", api.vehicles()), ("telemetry", api.telemetry(vin)), ("location", api.location(vin)),
            ("health", api.health(vin)), ("notifications", api.notifications(vin)),
            ("service_history", api.service_history(vin)),
        ):
            try:
                data = await coro
            except Exception as e:
                data = {"error": f"{type(e).__name__}: {e}"[:300]}
            p = RAW_DIR / f"{name}.json"
            p.write_text(json.dumps(data, indent=1, default=str))
            written.append(p)
        for a, b in month_windows(start, end):
            p = trips_dir / f"{a:%Y-%m}.json"
            if p.exists() and (refresh_from is None or b < refresh_from):
                continue
            payload = await api.trips(vin, a, b, summary=True)
            p.write_text(json.dumps(payload, indent=1, default=str))
            written.append(p)
            print(f"{a:%Y-%m}: {len(payload['trips'])} trips")
    return written
