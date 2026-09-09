// Types mirror docs/api-contract.md exactly.
import type * as GeoJSON from 'geojson'
export type LatLon = { lat: number; lon: number }

export type Vehicle = {
  vin: string
  model: string
  model_year: string
  manufactured: string
  color: string
  odometer_km: number
  fuel_level_pct: number
  range_km: number
  last_location: { lat: number; lon: number; ts: string }
  services: { date: string; mileage_km: number; provider: string }[]
  history_from: string
  trips_total: number
}

export type Scores = {
  global: number
  acceleration: number
  braking: number
  constant_speed?: number | null
  advice?: number | null
}

export type Summary = {
  avg_speed: number | null
  trips: number
  km: number
  hours: number
  fuel_l: number
  l_per_100km: number
  cost: number
  ev_share_km: number
  ev_share_time: number
  scores: Scores
  events: { harsh_brake: number; harsh_accel: number; smooth_brake: number; smooth_accel: number; other: number }
  harsh_per_100km: number
  night_trips: number
  overspeed_km: number
  highway_km: number
  longest_trip: { id: string; km: number } | null
  best_trip: { id: string; score: number } | null
  worst_trip: { id: string; score: number } | null
  climb_m: number
}

export type Trip = {
  id: string
  start_ts: string
  end_ts: string
  start: LatLon
  end: LatLon
  km: number
  duration_s: number
  avg_speed: number
  fuel_l: number
  l_per_100km: number | null
  cost: number
  ev_km: number
  ev_share: number
  night: boolean
  scores: Scores
  events: { harsh_brake: number; harsh_accel: number; good: number }
  overspeed_km: number
  highway_km: number
  mode_share: { eco: number; normal: number; power: number }
  climb_m: number
  descent_m: number
  bbox: [number, number, number, number]
}

export type RouteProps = {
  trip_id: string
  is_ev: boolean
  mode?: number
  overspeed: boolean
  highway?: boolean
  speed_est: number
  start_ts?: string
}

export type EventType = 'A' | 'B' | 'C'
export type EventProps = {
  id: string
  trip_id: string
  ts: string
  type: EventType
  good: boolean
  code: number
  label: string
  severity: number
  slope: number
}

export type LineFeature = GeoJSON.Feature<GeoJSON.LineString, RouteProps>
export type PointFeature = GeoJSON.Feature<GeoJSON.Point, EventProps>
export type RouteCollection = GeoJSON.FeatureCollection<GeoJSON.LineString, RouteProps>
export type EventCollection = GeoJSON.FeatureCollection<GeoJSON.Point, EventProps>

export type ProfilePoint = { t: number; km: number; speed_est: number; elevation_m: number | null; is_ev: boolean }

export type TripDetail = Trip & {
  route: RouteCollection
  events: EventCollection
  profile: ProfilePoint[]
}

export type Hotspot = {
  lat: number
  lon: number
  count: number
  harsh_brake: number
  harsh_accel: number
  good: number
  trips: string[]
  score: number
  label: string
  elevation_m: number | null
  last_ts: string
  slope_avg: number
}

export type Heatmap = {
  weekday_hour: { weekday: number; hour: number; trips: number; km: number; harsh: number }[]
  daily: {
    date: string
    trips: number
    km: number
    fuel_l: number
    l_per_100km: number
    score: number
    harsh: number
    ev_share: number
  }[]
}

export type Monthly = {
  year: number
  month: number
  km: number
  hours: number
  fuel_l: number
  l_per_100km: number
  avg_speed: number
  scores: Scores
  ev_share_km: number
  ev_share_time: number
}

export type Settings = { fuel_price: number; fuel_price_manual: number; fuel_price_source: 'fills' | 'manual'; fuel_price_fills: number; currency: string; tank_capacity_l: number }
export type SyncResult = { fetched_trips: number; new_trips: number; updated_trips: number; snapshot_ts: string }

export type DateRange = { from?: string; to?: string }

// ---- places, journeys, commute coach
export type Place = {
  id: number; lat: number; lon: number; name: string | null; auto_name: string | null; label: string
  visits: number; departures: number; arrivals: number; km_to_here: number; fuel_l_to_here: number; cost_to_here: number
  harsh_to_here: number; dwell_median_min: number | null; first_ts: string | null; last_ts: string | null
  arrival_hours: { hour: number; n: number }[]
}
export type Journey = {
  from: number; to: number; from_label: string | null; to_label: string | null; trips: number; is_commute: boolean; loop: boolean
  duration_median_min: number; duration_min_min: number; duration_max_min: number; km_median: number
  l_per_100km_median: number | null; cost_total: number; harsh_per_trip: number; ev_share: number; last_ts: string; trip_ids: string[]
}
export type CommuteRun = {
  id: string; start_ts: string; weekday: number; hour: number; minute: number; slot: string; duration_min: number; km: number
  l_per_100km: number | null; cost: number; score: number | null; harsh: number; harsh_arrival: number; ev_share: number; night: boolean
}
export type CommuteSlot = { slot: string; runs: number; duration_median_min: number; l_per_100km_median: number | null; harsh_per_run: number; score_avg: number }
export type Commute = { from: number; to: number; runs: CommuteRun[]; slots: CommuteSlot[]; typical_duration_min: number; best_run: string; findings: string[]; harsh_arrival_share: number }
export type Chain = { start_ts: string; end_ts: string; legs: number; stops: string[]; km: number; trip_ids: string[]; minutes: number }

// ---- streets where you speed
export type Street = {
  id: string; lat: number; lon: number; trips: number; segments: number; km_over: number; seconds_over: number
  speed_avg: number; speed_max: number; highway: boolean; last_ts: string; line: [number, number][]; score: number
}
export type StreetCollection = GeoJSON.FeatureCollection<GeoJSON.LineString, Omit<Street, 'line'>>

// ---- tank log
export type Fill = {
  ts: string; prev_ts: string | null; odometer_km: number | null; pct_before: number | null; pct_after: number | null
  litres_est: number | null; litres: number | null; price_per_l: number | null; note: string | null
  litres_used: number | null; price_used: number; cost: number | null; km_since_prev: number | null
  l_per_100km_real: number | null; l_per_100km_toyota: number | null; estimated: boolean
}
export type Tank = {
  fills: number; litres_total: number; cost_total: number; l_per_100km_real: number | null; l_per_100km_toyota: number | null
  snapshots: number; first_snapshot: string | null; level_now: number | null; range_now: number | null; odometer_now: number | null
  levels: { ts: string; pct: number | null; odometer_km: number | null; range_km: number | null }[]; tank_capacity_l: number
  fills_list: Fill[]
}

// ---- insights
export type Week = { start: string; end: string }
export type Digest = {
  empty?: boolean; week: Week; summary: Summary; previous: Summary
  delta: Record<'km' | 'fuel_l' | 'l_per_100km' | 'cost' | 'harsh_per_100km' | 'ev_share_km', number | null>
  score_delta: number | null; headlines: string[]; hotspots: Hotspot[]; streets: Street[]
  journeys: (Journey & { trips_this_week: number })[]; fills: Fill[]; worst_trip: Trip | null; best_trip: Trip | null
  days: Heatmap['daily']
}
