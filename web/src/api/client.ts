import type {
  Chain, Commute, DateRange, Digest, EventCollection, Fill, Heatmap, Hotspot, Journey, Monthly, Place, RouteCollection,
  Settings, Street, StreetCollection, Summary, SyncResult, Tank, Trip, TripDetail, Vehicle, Week,
} from './types'

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { 'content-type': 'application/json' }, ...init })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}`)
  return (await res.json()) as T
}

type Api = {
  vehicle(): Promise<Vehicle>
  summary(r: DateRange): Promise<Summary>
  trips(r: DateRange): Promise<Trip[]>
  trip(id: string): Promise<TripDetail>
  routes(r: DateRange, tolerance?: number): Promise<RouteCollection>
  events(r: DateRange, type?: string, good?: boolean): Promise<EventCollection>
  hotspots(r: DateRange, radiusM?: number, minCount?: number): Promise<Hotspot[]>
  heatmap(r: DateRange): Promise<Heatmap>
  monthly(): Promise<Monthly[]>
  settings(): Promise<Settings>
  saveSettings(s: Partial<Settings>): Promise<Settings>
  sync(days?: number): Promise<SyncResult>
  places(r?: DateRange): Promise<Place[]>
  renamePlace(id: number, name: string | null): Promise<Place>
  journeys(minTrips?: number, r?: DateRange): Promise<Journey[]>
  commute(from: number, to: number): Promise<Commute>
  chains(r?: DateRange): Promise<Chain[]>
  isDemo(): Promise<{ demo: boolean }>
  streets(r: DateRange, minTrips?: number): Promise<Street[]>
  streetsGeojson(r: DateRange, minTrips?: number): Promise<StreetCollection>
  tank(): Promise<Tank>
  editFill(ts: string, patch: { litres?: number; price_per_l?: number; note?: string }): Promise<Fill>
  addFill(body: { ts: string; litres: number; price_per_l?: number; odometer_km?: number; note?: string }): Promise<Fill>
  weeks(): Promise<Week[]>
  insights(week?: string): Promise<Digest>
}

const live: Api = {
  vehicle: () => http('/vehicle'),
  summary: (r) => http(`/summary${qs(r)}`),
  trips: (r) => http(`/trips${qs(r)}`),
  trip: (id) => http(`/trips/${encodeURIComponent(id)}`),
  routes: (r, tolerance) => http(`/routes.geojson${qs({ ...r, tolerance })}`),
  events: (r, type, good) => http(`/events.geojson${qs({ ...r, type, good })}`),
  hotspots: (r, radius_m, min_count) => http(`/hotspots${qs({ ...r, radius_m, min_count })}`),
  heatmap: (r) => http(`/heatmap${qs(r)}`),
  monthly: () => http('/monthly'),
  settings: () => http('/settings'),
  saveSettings: (s) => http('/settings', { method: 'PUT', body: JSON.stringify(s) }),
  sync: (days = 14) => http(`/sync${qs({ days })}`, { method: 'POST' }),
  places: (r = {}) => http(`/places${qs(r)}`),
  renamePlace: (id, name) => http(`/places/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  journeys: (min_trips = 2, r = {}) => http(`/journeys${qs({ ...r, min_trips })}`),
  commute: (from, to) => http(`/commute/${from}/${to}`),
  chains: (r = {}) => http(`/chains${qs(r)}`),
  isDemo: () => http('/demo'),
  streets: (r, min_trips = 2) => http(`/streets${qs({ ...r, min_trips })}`),
  streetsGeojson: (r, min_trips = 2) => http(`/streets.geojson${qs({ ...r, min_trips })}`),
  tank: () => http('/tank'),
  editFill: (ts, patch) => http(`/tank/fills/${encodeURIComponent(ts)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  addFill: (body) => http('/tank/fills', { method: 'POST', body: JSON.stringify(body) }),
  weeks: () => http('/insights/weeks'),
  insights: (week) => http(`/insights${qs({ week })}`),
}

export const api: Api = live
