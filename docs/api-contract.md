# API contract (FastAPI, base `/api`)

All dates ISO 8601 UTC. `from`/`to` query params are `YYYY-MM-DD`, optional, inclusive.
Distances km, durations seconds, fuel litres, cost in the configured currency.

GET /vehicle
{ vin, model, model_year, manufactured, color, odometer_km, fuel_level_pct, range_km,
  last_location: {lat, lon, ts}, services: [{date, mileage_km, provider}],
  history_from: "2026-07-28", trips_total }

GET /summary?from&to
{ trips, km, hours, fuel_l, l_per_100km, cost, ev_share_km, ev_share_time,
  scores: {global, acceleration, braking, constant_speed|null},
  events: {harsh_brake, harsh_accel, smooth_brake, smooth_accel, other},
  harsh_per_100km, night_trips, overspeed_km, highway_km,
  longest_trip: {id, km}, best_trip: {id, score}, worst_trip: {id, score},
  climb_m, fast_stretch_kmh }

GET /trips?from&to
[ { id, start_ts, end_ts, start: {lat, lon}, end: {lat, lon}, km, duration_s, avg_speed,
    fast_stretch_kmh, fuel_l, l_per_100km, cost, ev_km, ev_share, night,
    scores: {global, acceleration, braking, advice},
    events: {harsh_brake, harsh_accel, good}, overspeed_km, highway_km,
    mode_share: {eco, normal, power}, climb_m, descent_m, bbox: [minLon, minLat, maxLon, maxLat] } ]

GET /trips/{id}
{ ...trip as above,
  route: GeoJSON FeatureCollection of LineString features, split where is_ev or overspeed
         changes, properties {trip_id, is_ev, mode, overspeed, highway, speed_est},
  events: GeoJSON FeatureCollection of Points, properties {id, trip_id, ts, type, good,
          code, label, severity, slope},
  profile: [ {t (s from start), km, speed_est, elevation_m, is_ev} ]  (one per route point) }

GET /routes.geojson?from&to&tolerance=0.00005
FeatureCollection of LineStrings, properties {trip_id, is_ev, overspeed, speed_est, start_ts}

GET /events.geojson?from&to&type=A|B|C&good=true|false
FeatureCollection of Points, properties as in /trips/{id}.events

GET /hotspots?from&to&radius_m=60&min_count=2
[ {lat, lon, count, harsh_brake, harsh_accel, good, trips: [trip_id], score, label,
   elevation_m, slope_avg} ]  sorted by count desc

GET /heatmap?from&to
{ weekday_hour: [ {weekday 0..6, hour 0..23, trips, km, harsh} ],
  daily: [ {date, trips, km, fuel_l, l_per_100km, score, harsh, ev_share} ] }

GET /monthly
[ {year, month, km, hours, fuel_l, l_per_100km, avg_speed,
   scores: {global, acceleration, braking, constant_speed, advice},
   ev_share_km, ev_share_time} ]

GET /settings            -> {fuel_price, currency}
PUT /settings            <- {fuel_price?, currency?}  -> same

POST /sync?days=14       -> {fetched_trips, new_trips, updated_trips, snapshot_ts}

Event labels (toyota_telemetry/labels.py), inferred, official meanings unpublished:
  B/1 smooth stop, B/2 abrupt stop, B/5 hard brake, B/10 emergency brake, B/13 late brake,
  A/1 smooth start, A/20 aggressive acceleration, A/25 hard acceleration,
  C/31 constant speed kept. harsh_* counts = events with good == false of that type.
Route mode (inferred): 0 eco, 1 normal, 2 power. EV state is `is_ev`.
