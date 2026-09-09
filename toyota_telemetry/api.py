"""FastAPI app: JSON API under /api plus the built frontend under /."""

from __future__ import annotations

import asyncio
import sqlite3
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from toyota_telemetry import analytics, insights, places, store, streets, tank

ROOT = Path(__file__).resolve().parent.parent
WEB_DIST = ROOT / "web" / "dist"

app = FastAPI(title="Yaris telemetry", version="0.1.0")


def db() -> sqlite3.Connection:
    return store.connect(store.DB_PATH)


class Settings(BaseModel):
    fuel_price: float | None = None
    currency: str | None = None
    tank_capacity_l: float | None = None


class PlaceName(BaseModel):
    name: str | None = None


class FillEdit(BaseModel):
    litres: float | None = None
    price_per_l: float | None = None
    note: str | None = None


class ManualFill(BaseModel):
    ts: str
    litres: float
    price_per_l: float | None = None
    odometer_km: int | None = None
    note: str | None = None


@app.get("/api/demo")
def is_demo() -> Any:
    return {"demo": store.DB_PATH.name == "demo.db"}


@app.get("/api/vehicle")
def vehicle() -> Any:
    v = analytics.vehicle(db())
    if v is None:
        raise HTTPException(404, "no vehicle loaded, run `toyota sync --full`")
    return v


@app.get("/api/summary")
def summary(from_: str | None = Query(None, alias="from"), to: str | None = None) -> Any:
    return analytics.summary(db(), from_, to)


@app.get("/api/trips")
def trips(from_: str | None = Query(None, alias="from"), to: str | None = None) -> Any:
    return analytics.trips(db(), from_, to)


@app.get("/api/trips/{trip_id}")
def trip(trip_id: str) -> Any:
    d = analytics.trip_detail(db(), trip_id)
    if d is None:
        raise HTTPException(404, "unknown trip")
    d["events"] = d.pop("events_geojson")  # contract: events is the GeoJSON in the detail view
    return d


@app.get("/api/routes.geojson")
def routes(from_: str | None = Query(None, alias="from"), to: str | None = None,
           tolerance: float = 0.00005) -> Any:
    return JSONResponse(analytics.routes_geojson(db(), from_, to, tolerance))


@app.get("/api/events.geojson")
def events(from_: str | None = Query(None, alias="from"), to: str | None = None,
           type: str | None = None, good: bool | None = None) -> Any:
    return JSONResponse(analytics.events_geojson(db(), from_, to, type, good))


@app.get("/api/hotspots")
def hotspots(from_: str | None = Query(None, alias="from"), to: str | None = None,
             radius_m: float = 60.0, min_count: int = 2) -> Any:
    return analytics.hotspots(db(), from_, to, radius_m, min_count)


@app.get("/api/heatmap")
def heatmap(from_: str | None = Query(None, alias="from"), to: str | None = None) -> Any:
    return analytics.heatmap(db(), from_, to)


@app.get("/api/monthly")
def monthly() -> Any:
    return analytics.monthly(db())


@app.get("/api/settings")
def get_settings() -> Any:
    return store.get_settings(db())


@app.put("/api/settings")
def put_settings(body: Settings) -> Any:
    return store.set_settings(db(), fuel_price=body.fuel_price, currency=body.currency, tank_capacity_l=body.tank_capacity_l)


# ---- places, journeys, commute coach

@app.get("/api/places")
def get_places(from_: str | None = Query(None, alias="from"), to: str | None = None) -> Any:
    return places.places(db(), from_, to)


@app.put("/api/places/{place_id}")
def put_place(place_id: int, body: PlaceName) -> Any:
    p = places.rename_place(db(), place_id, body.name)
    if p is None:
        raise HTTPException(404, "unknown place")
    return p


@app.get("/api/journeys")
def get_journeys(min_trips: int = 2, from_: str | None = Query(None, alias="from"), to: str | None = None) -> Any:
    return places.journeys(db(), min_trips, from_, to)


@app.get("/api/commute/{from_place}/{to_place}")
def get_commute(from_place: int, to_place: int) -> Any:
    c = places.commute(db(), from_place, to_place)
    if c is None:
        raise HTTPException(404, "no trips between these places")
    return c


@app.get("/api/chains")
def get_chains(from_: str | None = Query(None, alias="from"), to: str | None = None) -> Any:
    return places.chains(db(), from_date=from_, to_date=to)


# ---- streets where you speed

@app.get("/api/streets")
def get_streets(from_: str | None = Query(None, alias="from"), to: str | None = None, min_trips: int = 2) -> Any:
    return streets.clusters(db(), from_, to, min_trips=min_trips)


@app.get("/api/streets.geojson")
def get_streets_geojson(from_: str | None = Query(None, alias="from"), to: str | None = None, min_trips: int = 2) -> Any:
    return JSONResponse(streets.clusters_geojson(streets.clusters(db(), from_, to, min_trips=min_trips)))


# ---- tank log

@app.get("/api/tank")
def get_tank() -> Any:
    c = db()
    tank.detect_fills(c)
    return {**tank.summary(c), "fills_list": tank.fills(c)}


@app.put("/api/tank/fills/{ts}")
def put_fill(ts: str, body: FillEdit) -> Any:
    f = tank.update_fill(db(), ts, body.litres, body.price_per_l, body.note)
    if f is None:
        raise HTTPException(404, "unknown fill")
    return f


@app.post("/api/tank/fills")
def post_fill(body: ManualFill) -> Any:
    return tank.add_manual_fill(db(), tank.parse_ts(body.ts), body.litres, body.price_per_l, body.odometer_km, body.note)


# ---- insights

@app.get("/api/insights/weeks")
def get_weeks() -> Any:
    return insights.weeks_available(db())


@app.get("/api/insights")
def get_insights(week: str | None = None) -> Any:
    return insights.digest(db(), date.fromisoformat(week) if week else None)


@app.post("/api/sync")
async def sync(days: int = 14) -> Any:
    if store.DB_PATH.name == "demo.db":
        raise HTTPException(409, "this is the demo database: syncing would mix real data into it")
    from toyota_telemetry.cli import run_sync  # local import: pulls network deps only when used

    before = {r["id"] for r in db().execute("SELECT id FROM trips")}
    result = await asyncio.to_thread(run_sync, date.today() - timedelta(days=days), False)
    after = {r["id"] for r in db().execute("SELECT id FROM trips")}
    return {"fetched_trips": result["loaded"], "new_trips": len(after - before),
            "updated_trips": result["loaded"] - len(after - before), "snapshot_ts": result["snapshot_ts"]}


if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> Any:
        target = WEB_DIST / path
        if path and target.is_file():
            return FileResponse(target)
        return FileResponse(WEB_DIST / "index.html", headers={"Cache-Control": "no-cache"})
