import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'

vi.mock('../api/client', () => ({
  api: {
    vehicle: () => Promise.resolve({ vin: 'X', model: 'Yaris', model_year: '2020', manufactured: '2022-02-01', color: 'Silver', odometer_km: 1, fuel_level_pct: 50, range_km: 300, last_location: null, services: [], history_from: '2026-07-28', trips_total: 0 }),
    settings: () => Promise.resolve({ fuel_price: 1.75, fuel_price_manual: 1.75, fuel_price_source: 'manual', fuel_price_fills: 0, currency: 'EUR', tank_capacity_l: 36 }),
    isDemo: () => Promise.resolve({ demo: false }),
    trips: () => Promise.resolve([]),
    summary: () => new Promise(() => {}),
    heatmap: () => new Promise(() => {}),
    places: () => Promise.resolve([{ id: 1, lat: 44.4, lon: 26.0, name: null, auto_name: 'Home', label: 'Home', visits: 12, departures: 6, arrivals: 6, km_to_here: 60, fuel_l_to_here: 2.4, cost_to_here: 23, harsh_to_here: 3, dwell_median_min: 600, first_ts: '2026-08-01T05:00:00Z', last_ts: '2026-09-01T05:00:00Z', arrival_hours: [] }]),
    journeys: () => Promise.resolve([{ from: 1, to: 1, from_label: 'Home', to_label: 'Home', trips: 6, is_commute: true, loop: true, duration_median_min: 28, duration_min_min: 20, duration_max_min: 40, km_median: 10.8, l_per_100km_median: 4.0, cost_total: 30, harsh_per_trip: 1.5, ev_share: 0.7, last_ts: '2026-09-01T05:00:00Z', trip_ids: [] }]),
    chains: () => Promise.resolve([]),
    weeks: () => Promise.resolve([{ start: '2026-09-07', end: '2026-09-13' }]),
    insights: () => Promise.resolve({ week: { start: '2026-09-07', end: '2026-09-13' }, headlines: ['35 km in 6 trips.'], summary: { trips: 6, km: 35, hours: 2, fuel_l: 1.3, l_per_100km: 3.8, cost: 13, ev_share_km: 0.67, ev_share_time: 0.7, scores: { global: 75, acceleration: 80, braking: 70, constant_speed: null }, events: { harsh_brake: 3, harsh_accel: 2, smooth_brake: 5, smooth_accel: 1, other: 0 }, harsh_per_100km: 14, night_trips: 1, overspeed_km: 2, highway_km: 0, longest_trip: null, best_trip: null, worst_trip: null, climb_m: 0, avg_speed: 24 }, previous: { trips: 0 }, delta: { km: -275, fuel_l: null, l_per_100km: null, cost: null, harsh_per_100km: null, ev_share_km: null }, score_delta: -5, hotspots: [], streets: [], journeys: [], fills: [], worst_trip: null, best_trip: null, days: [] }),
    consumption: () => Promise.resolve({
      seasons: [
        { id: 'summer', label: 'Summer', months_label: 'Jun–Aug', trips: 10, km: 500, hours: 12, fuel_l: 21, l_per_100km: 4.2, cost: 160, cost_per_100km: 32, ev_share_km: 0.56, avg_speed: 41.7, highway_share: 0.2, short_trips_share: 0.3 },
        { id: 'autumn', label: 'Autumn', months_label: 'Sep–Nov', trips: 8, km: 300, hours: 8, fuel_l: 14.4, l_per_100km: 4.8, cost: 110, cost_per_100km: 36.7, ev_share_km: 0.5, avg_speed: 37.5, highway_share: 0.1, short_trips_share: 0.4 },
        { id: 'winter', label: 'Winter', months_label: 'Dec–Feb', trips: 0, km: 0, hours: 0, fuel_l: 0, l_per_100km: null, cost: 0, cost_per_100km: null, ev_share_km: null, avg_speed: null, highway_share: null, short_trips_share: null },
        { id: 'spring', label: 'Spring', months_label: 'Mar–May', trips: 0, km: 0, hours: 0, fuel_l: 0, l_per_100km: null, cost: 0, cost_per_100km: null, ev_share_km: null, avg_speed: null, highway_share: null, short_trips_share: null },
      ],
      halves: {
        warm: { id: 'warm', label: 'Warm half', months_label: 'Apr–Sep', trips: 10, km: 500, hours: 12, fuel_l: 21, l_per_100km: 4.2, cost: 160, cost_per_100km: 32, ev_share_km: 0.56, avg_speed: 41.7, highway_share: 0.2, short_trips_share: 0.3 },
        cold: { id: 'cold', label: 'Cold half', months_label: 'Oct–Mar', trips: 8, km: 300, hours: 8, fuel_l: 14.4, l_per_100km: 4.8, cost: 110, cost_per_100km: 36.7, ev_share_km: 0.5, avg_speed: 37.5, highway_share: 0.1, short_trips_share: 0.4 },
      },
      monthly: [
        { ym: '2026-08', year: 2026, month: 8, season: 'summer', trips: 10, km: 500, hours: 12, fuel_l: 21, l_per_100km: 4.2, cost: 160, cost_per_100km: 32, ev_share_km: 0.56, avg_speed: 41.7, highway_share: 0.2, short_trips_share: 0.3 },
      ],
      overall: { trips: 18, km: 800, hours: 20, fuel_l: 35.4, l_per_100km: 4.43, cost: 270, cost_per_100km: 33.8, ev_share_km: 0.54, avg_speed: 40, highway_share: 0.16, short_trips_share: 0.34 },
    }),
  },
}))

describe('places and insights', () => {
  it('lists places and commutes', async () => {
    render(<MemoryRouter initialEntries={['/places']}><App /></MemoryRouter>)
    expect((await screen.findAllByText('Home')).length).toBeGreaterThan(0)
    expect(await screen.findByText('Coach')).toBeInTheDocument()
  })
  it('shows the weekly headlines', async () => {
    render(<MemoryRouter initialEntries={['/insights']}><App /></MemoryRouter>)
    expect(await screen.findByText('35 km in 6 trips.')).toBeInTheDocument()
  })
})

describe('app shell', () => {
  it('renders the navigation and the trips page', async () => {
    render(<MemoryRouter initialEntries={['/trips']}><App /></MemoryRouter>)
    expect(screen.getByText('Overview')).toBeInTheDocument()
    expect(screen.getByText('Map')).toBeInTheDocument()
    expect(screen.getByText('Consumption')).toBeInTheDocument()
    expect(await screen.findByText('No trips in this range.')).toBeInTheDocument()
  })
  it('renders seasonal consumption comparison', async () => {
    render(<MemoryRouter initialEntries={['/consumption']}><App /></MemoryRouter>)
    expect(await screen.findByText('Seasonal consumption')).toBeInTheDocument()
    expect(await screen.findByText('Summer vs Winter')).toBeInTheDocument()
    expect(await screen.findByText('+0.60 vs Summer')).toBeInTheDocument()
  })
  it('renders the 3D Toyota model automatically on overview', async () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    expect(await screen.findByTitle('3D model of Toyota Yaris')).toBeInTheDocument()
    expect(screen.getByText('Toyota Yaris')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Corolla' })).not.toBeInTheDocument()
  })
})
