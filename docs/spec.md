# Yaris Telemetry: design spec (2026-09-09)

## Goal
Pull every trip the Toyota Connected Europe cloud holds for a connected Toyota (developed
against a 2022 Yaris Hybrid, 4th generation), store it locally, and show a
dashboard centred on *where* driving behaviour goes wrong: harsh braking and acceleration
events on a 3D terrain map, hotspot ranking, trip explorer with elevation and estimated
speed profiles, and driver-score trends. No live telemetry, no OBD. Sync once a day.

## Data source (verified 2026-09-09 with the probe)
- Auth: MyToyota credentials, pytoyoda 5.2 controller. pytoyoda's typed vehicle model
  rejects this car (`remoteDisplay` missing), so all reads go through the raw controller
  (`toyota_telemetry/toyota.py`).
- `/v1/trips?route=true`: per trip `summary` (start/end ts and lat/lon, length m, duration s,
  averageSpeed, fuelConsumption ml, nightTrip), `scores` (global, acceleration, braking,
  advice), `hdc` (ev/charge/eco/power time and distance), `route` points (lat, lon, isEv,
  mode 0/1/2, overspeed, highway, indexInPoints; no timestamps, ~0.3 to 0.7 points per second),
  `behaviours` events (ts, lat, lon, type A accel / B brake / C, good flag, coachingMsg code,
  severity, context.slope). Monthly `summary` with daily histograms when `summary=true`.
- `/v3/telemetry` (odometer, fuel level, range), `/v1/location` (last parked),
  `/v1/servicehistory/vehicle/summary`, `/v2/notification/history`, `/v1/vehiclehealth/status`.
- History starts July 2026 (subscription start). Raw responses cached in `data/raw/` per month.

## Derived data (computed here, labelled as estimates in the UI)
- Point timestamps: piecewise linear interpolation over route index, anchored on trip start,
  each behaviour event (matched to its nearest route point) and trip end.
- Speed profile: segment distance / estimated dt, median-smoothed. Gives per-trip max speed
  estimate and a speed-coloured route.
- Elevation profile: AWS Terrarium DEM tiles (zoom 12) decoded with Pillow, cached in
  `data/dem/`. Climb and descent per trip.
- Hotspots: greedy clustering of bad events within a radius (default 60 m), ranked by count.
- Event labels: coaching codes mapped to readable labels in `toyota_telemetry/labels.py`. The official
  meanings are not published; labels are inferred from type and good flag and marked so.
- Cost: fuel litres times a configurable price (set in the interface; the average of logged fills wins when there are any).

## Architecture
- `toyota_telemetry/` Python 3.12 package (uv): `toyota.py` raw client, `store.py` SQLite schema and
  loaders, `derive.py` timestamps/speed/elevation, `analytics.py` aggregations and hotspots,
  `labels.py`, `api.py` FastAPI app, `cli.py` (`toyota sync [--full]`, `toyota serve`).
- `web/` Vite + React + TypeScript, Tailwind, MapLibre GL (3D terrain, hillshade, sky, orbit and
  fly-through camera), ECharts. Built assets served by FastAPI under `/`.
- SQLite file `data/telemetry.db`. Tables: vehicle, trips, route_points, events, daily_stats,
  monthly_stats, snapshots (telemetry over time), settings.
- API contract in `docs/api-contract.md`.

## Screens
1. Overview: KPI tiles, score trend, weekly km and fuel, weekday x hour heatmap, calendar.
2. Map (3D): all routes draped on terrain, coloured by EV/ICE or estimated speed, event
   markers by type, hotspot ranking panel, date and type filters, orbit and fly-through.
3. Trips: sortable table; detail with route, events pinned, speed and elevation profile,
   score radar, EV share, fuel, cost.
4. Driver profile: scores radar and trend, good vs bad event ratio, harsh events per 100 km,
   night and overspeed shares, best and worst trips.

## Out of scope
Live OBD data, mobile app, cloud hosting, Home Assistant, remote commands.

## Testing
pytest on derive (timestamps, speed, elevation decode), analytics (hotspots, aggregations),
store loading from the cached raw fixtures. vitest smoke on the frontend. Manual check of
the 3D map in the browser.
