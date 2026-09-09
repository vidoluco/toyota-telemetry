import * as maplibregl from 'maplibre-gl'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { EventProps, Hotspot, Street, Trip } from '../api/types'
import { Estimate } from '../components/Panel'
import { fmt } from '../lib/format'
import { rangeKey, useRange } from '../lib/range'
import { useApi } from '../lib/useApi'
import { getBasemap, setBasemap, type Basemap } from '../map/basemap'
import { COLORS, WORLD, addEventLayers, addRouteLayers, approachBounds, cameraForBbox, createTerrainMap, flyAlong, pitchWhenReady, routeColorEv, routeColorOverspeed, routeColorSpeed, startOrbit } from '../map/terrain'

type ColorMode = 'ev' | 'speed' | 'overspeed'
const spring = { type: 'spring', bounce: 0, duration: 0.35 } as const
const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function MapPage() {
  const [range] = useRange()
  const k = rangeKey(range)
  const { data: routes } = useApi(`routes_${k}`, () => api.routes(range))
  const { data: events } = useApi(`events_${k}`, () => api.events(range))
  const { data: hotspots } = useApi(`hotspots_${k}`, () => api.hotspots(range, 60, 2))
  const { data: trips } = useApi(`trips_${k}`, () => api.trips(range))
  const { data: streets } = useApi(`streets_${k}`, () => api.streets(range, 2))
  const { data: places } = useApi('places', () => api.places())
  const [sp, setSp] = useSearchParams()
  const nav = useNavigate()

  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const [color, setColor] = useState<ColorMode>('ev')
  const [showGood, setShowGood] = useState(false)
  const [showEvents, setShowEvents] = useState(true)
  const [showSpots, setShowSpots] = useState(true)
  const [showStreets, setShowStreets] = useState(() => new URLSearchParams(window.location.search).get('streets') === '1')
  const [panel, setPanel] = useState<'spots' | 'streets'>(() => new URLSearchParams(window.location.search).get('streets') === '1' ? 'streets' : 'spots')
  const [basemap, setBasemapState] = useState<Basemap>(getBasemap)
  const switchBasemap = (b: Basemap) => { setBasemap(b); setBasemapState(b) }
  const [orbit, setOrbit] = useState(false)
  const [flying, setFlying] = useState<{ id: string; frac: number } | null>(null)
  const stopper = useRef<(() => void) | null>(null)
  const didFit = useRef(false)
  const selected = sp.get('trip')

  // Create the map (again when the basemap changes).
  useEffect(() => {
    if (!box.current || mapRef.current) return
    let map: maplibregl.Map | undefined
    const prev = mapRef.current as maplibregl.Map | null
    const cam: maplibregl.CameraOptions = prev ? { center: prev.getCenter(), zoom: prev.getZoom(), pitch: prev.getPitch(), bearing: prev.getBearing() } : home ?? WORLD
    createTerrainMap(box.current, cam, 1.35, basemap).then((m) => {
      map = m
      mapRef.current = m
      m.addSource('routes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addSource('events', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addSource('hotspots', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addSource('selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addSource('streets', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      addRouteLayers(m, 'routes', 'routes', routeColorEv(), 2)
      addRouteLayers(m, 'selected', 'selected', COLORS.selected as unknown as maplibregl.ExpressionSpecification, 3.4)
      m.addLayer({ id: 'streets-line', type: 'line', source: 'streets', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-color': COLORS.accel, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 8], 'line-opacity': 0.9 } })
      m.addLayer({ id: 'hotspot-ring', type: 'circle', source: 'hotspots', paint: { 'circle-color': 'rgba(255,90,54,0.05)', 'circle-stroke-color': COLORS.brake, 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.45, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['+', 4, ['*', 0.8, ['get', 'count']]], 15, ['+', 12, ['*', 2.5, ['get', 'count']]]] } })
      addEventLayers(m, 'events', 'events')
      m.addLayer({ id: 'hotspot-count', type: 'symbol', source: 'hotspots', minzoom: 12, layout: { 'text-field': ['to-string', ['get', 'count']], 'text-size': 11, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true }, paint: { 'text-color': COLORS.selected, 'text-halo-color': COLORS.stroke, 'text-halo-width': 1.2 } })

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 })
      m.on('mousemove', 'events-dot', (e) => {
        const f = e.features?.[0]
        if (!f) return
        const p = f.properties as unknown as EventProps
        m.getCanvas().style.cursor = 'pointer'
        popup.setLngLat(e.lngLat).setHTML(`<div style="font-weight:600;color:${p.good ? '#96a2b1' : p.type === 'B' ? COLORS.brake : COLORS.accel}">${p.label}</div><div>${fmt.dateLong(p.ts)} ${fmt.time(p.ts)}</div>${p.slope ? `<div>slope ${p.slope}%</div>` : ''}`).addTo(m)
      })
      m.on('mouseleave', 'events-dot', () => { m.getCanvas().style.cursor = ''; popup.remove() })
      m.on('click', 'events-dot', (e) => { const p = e.features?.[0]?.properties as unknown as EventProps | undefined; if (p) select(p.trip_id) })
      m.on('click', 'routes-line', (e) => { const p = e.features?.[0]?.properties as { trip_id?: string } | undefined; if (p?.trip_id) select(p.trip_id) })
      m.on('mouseenter', 'routes-line', () => { m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'routes-line', () => { m.getCanvas().style.cursor = '' })
      setReady(true)
    })
    return () => { stopper.current?.(); map?.remove(); mapRef.current = null; setReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap])

  const select = useCallback((id: string | null) => {
    const next = new URLSearchParams(window.location.search)
    id ? next.set('trip', id) : next.delete('trip')
    setSp(next, { replace: true })
  }, [setSp])

  // Push data into sources when it arrives, and frame everything the first time.
  useEffect(() => {
    const m = mapRef.current
    if (!ready || !m || !routes) return
    ;(m.getSource('routes') as maplibregl.GeoJSONSource).setData(routes)
    if (didFit.current || routes.features.length === 0) return
    const b = new maplibregl.LngLatBounds()
    for (const f of routes.features) for (const c of f.geometry.coordinates) b.extend(c as [number, number])
    if (!b.isEmpty()) { m.fitBounds(b, { padding: { top: 90, bottom: 60, left: 60, right: 380 }, duration: 0, maxZoom: 13 }); didFit.current = true }
  }, [ready, routes])
  useEffect(() => {
    const m = mapRef.current; if (!ready || !m || !events) return
    const fc = showGood ? events : { ...events, features: events.features.filter((f) => !f.properties.good) }
    ;(m.getSource('events') as maplibregl.GeoJSONSource).setData(fc)
  }, [ready, events, showGood])
  useEffect(() => {
    const m = mapRef.current; if (!ready || !m || !hotspots) return
    ;(m.getSource('hotspots') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: hotspots.filter((h) => h.count >= 3).map((h) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [h.lon, h.lat] }, properties: { count: h.count, label: h.label } })) })
  }, [ready, hotspots])
  useEffect(() => {
    const m = mapRef.current; if (!ready || !m) return
    for (const id of ['events-halo', 'events-dot']) m.setLayoutProperty(id, 'visibility', showEvents ? 'visible' : 'none')
    for (const id of ['hotspot-ring', 'hotspot-count']) m.setLayoutProperty(id, 'visibility', showSpots ? 'visible' : 'none')
    m.setLayoutProperty('streets-line', 'visibility', showStreets ? 'visible' : 'none')
  }, [ready, showEvents, showSpots, showStreets])
  useEffect(() => {
    const m = mapRef.current; if (!ready || !m || !streets) return
    ;(m.getSource('streets') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: streets.filter((s) => s.line.length >= 2).map((s) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: s.line }, properties: { id: s.id, trips: s.trips, km_over: s.km_over } })) })
  }, [ready, streets])
  useEffect(() => {
    const m = mapRef.current; if (!ready || !m) return
    const expr = color === 'ev' ? routeColorEv() : color === 'speed' ? routeColorSpeed() : routeColorOverspeed()
    m.setPaintProperty('routes-line', 'line-color', expr)
    m.setPaintProperty('routes-glow', 'line-color', expr)
  }, [ready, color])

  // Selected trip: highlight, fit.
  const selectedTrip: Trip | undefined = useMemo(() => trips?.find((t) => t.id === selected), [trips, selected])
  useEffect(() => {
    const m = mapRef.current; if (!ready || !m || !routes) return
    const feats = selected ? routes.features.filter((f) => f.properties.trip_id === selected) : []
    ;(m.getSource('selected') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: feats })
    m.setPaintProperty('routes-line', 'line-opacity', selected ? 0.25 : 0.92)
    m.setPaintProperty('routes-glow', 'line-opacity', selected ? 0.04 : 0.12)
    if (selectedTrip && !flying) {
      const bounds: [[number, number], [number, number]] = [[selectedTrip.bbox[0], selectedTrip.bbox[1]], [selectedTrip.bbox[2], selectedTrip.bbox[3]]]
      const pad = { top: 80, bottom: 80, left: 380, right: 80 }
      approachBounds(m, bounds, { padding: pad, maxZoom: 14.5, pitch: 50, bearing: m.getBearing(), animate: !reduced })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, routes, selected, selectedTrip])

  const stopMotion = () => { stopper.current?.(); stopper.current = null; setOrbit(false); setFlying(null) }
  const toggleOrbit = () => {
    const m = mapRef.current; if (!m) return
    if (orbit) return stopMotion()
    stopMotion()
    if (m.getPitch() < 40) m.easeTo({ pitch: 62, duration: reduced ? 0 : 900 })
    stopper.current = startOrbit(m, 3)
    setOrbit(true)
  }
  const flyTrip = () => {
    const m = mapRef.current; if (!m || !selected || !routes) return
    stopMotion()
    const coords = routes.features.filter((f) => f.properties.trip_id === selected).flatMap((f) => f.geometry.coordinates as [number, number][])
    setFlying({ id: selected, frac: 0 })
    stopper.current = flyAlong(m, coords, { metersPerSec: Math.max(120, (selectedTrip?.km ?? 5) * 12), onProgress: (frac) => setFlying({ id: selected, frac }), onDone: () => setFlying(null) })
  }
  const goto = (cam: maplibregl.CameraOptions) => { stopMotion(); mapRef.current?.flyTo({ ...cam, duration: reduced ? 0 : 2400, essential: true }) }
  const gotoStreet = (s: Street) => { stopMotion(); const m = mapRef.current; if (!m) return; setShowStreets(true); m.flyTo({ center: [s.lon, s.lat], zoom: 15.5, pitch: 0, bearing: 0, duration: reduced ? 0 : 1600, essential: true }) }
  const gotoHotspot = (h: Hotspot) => { stopMotion(); const m = mapRef.current; if (!m) return; m.flyTo({ center: [h.lon, h.lat], zoom: 16, pitch: 0, bearing: -20, duration: reduced ? 0 : 1800, essential: true }); m.once('moveend', () => pitchWhenReady(m, 60, -20, reduced ? 0 : 900)) }

  // Camera presets come from the data: where this car mostly is, and its hilliest trip.
  const home = useMemo<maplibregl.CameraOptions | null>(() => {
    const p = places?.[0]
    return p ? { center: [p.lon, p.lat] as [number, number], zoom: 11, pitch: 0, bearing: 0 } : null
  }, [places])
  const hilly = useMemo(() => {
    const t = [...(trips ?? [])].sort((a, b) => (b.climb_m ?? 0) - (a.climb_m ?? 0))[0]
    return t && (t.climb_m ?? 0) > 250 ? { trip: t, camera: cameraForBbox(t.bbox, 70, -30, 11.2) } : null
  }, [trips])

  const topSpots = useMemo(() => (hotspots ?? []).slice(0, 12), [hotspots])
  const harshCount = useMemo(() => events?.features.filter((f) => !f.properties.good).length ?? 0, [events])

  return (
    <div className="absolute inset-0">
      <div ref={box} className="h-full w-full" />

      {/* Top-left controls */}
      <div className="absolute left-4 top-4 flex flex-col gap-2 z-10">
        <div className="material rounded-xl p-2 flex items-center gap-1.5 flex-wrap">
          <span className="eyebrow px-1">Map</span>
          <button className="btn" aria-pressed={basemap === 'light'} onClick={() => switchBasemap('light')}>Light</button>
          <button className="btn" aria-pressed={basemap === 'dark'} onClick={() => switchBasemap('dark')}>Dark</button>
          <span className="w-px h-5 bg-white/10 mx-1" />
          <span className="eyebrow px-1">Colour</span>
          {(['ev', 'speed', 'overspeed'] as ColorMode[]).map((c) => <button key={c} className="btn" aria-pressed={color === c} onClick={() => setColor(c)} title={c === 'speed' ? 'Relative pace along the route, reconstructed: fast against slow, not calibrated km/h' : undefined}>{c === 'ev' ? 'EV / engine' : c === 'speed' ? 'Pace' : 'Over limit'}</button>)}
          <span className="w-px h-5 bg-white/10 mx-1" />
          <button className="btn" aria-pressed={showEvents} onClick={() => setShowEvents((s) => !s)}>Events</button>
          <button className="btn" aria-pressed={showSpots} onClick={() => setShowSpots((s) => !s)}>Hotspots</button>
          <button className="btn" aria-pressed={showStreets} onClick={() => { setShowStreets((s) => !s); setPanel('streets') }}>Speeding</button>
          <button className="btn" aria-pressed={showGood} disabled={!showEvents} onClick={() => setShowGood((s) => !s)}>Smooth too</button>
        </div>
        <div className="material rounded-xl p-2 flex items-center gap-1.5 flex-wrap">
          <span className="eyebrow px-1">Camera</span>
          <button className="btn" aria-pressed={orbit} onClick={toggleOrbit}>{orbit ? 'Stop orbit' : 'Orbit'}</button>
          {hilly && <button className="btn" onClick={() => goto(hilly.camera)} title={`Your hilliest trip: ${Math.round(hilly.trip.climb_m ?? 0)} m of climb`}>Hills</button>}
          {home && <button className="btn" onClick={() => goto(home)}>Home area</button>}
          <button className="btn" disabled={!selected} onClick={flyTrip} aria-pressed={!!flying}>{flying ? `Flying ${Math.round(flying.frac * 100)}%` : 'Fly the trip'}</button>
        </div>
        <Legend color={color} />
      </div>

      {/* Right: hotspots or selected trip */}
      <aside className="absolute right-4 top-4 bottom-4 w-[340px] z-10 flex flex-col gap-2 pointer-events-none">
        <AnimatePresence mode="popLayout">
          {selectedTrip ? (
            <motion.div key="trip" className="material rounded-2xl p-4 pointer-events-auto" initial={reduced ? false : { opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={reduced ? undefined : { opacity: 0, x: 16 }} transition={spring}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="eyebrow">Trip</div>
                  <div className="title mt-0.5">{fmt.dateLong(selectedTrip.start_ts)} <span className="small">{fmt.time(selectedTrip.start_ts)}</span></div>
                </div>
                <button className="btn" onClick={() => { stopMotion(); select(null) }}>✕</button>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <Stat l="km" v={fmt.n1(selectedTrip.km)} />
                <Stat l="l/100km" v={fmt.n2(selectedTrip.l_per_100km)} />
                <Stat l="score" v={String(selectedTrip.scores.global ?? '–')} />
                <Stat l="EV share" v={fmt.pct(selectedTrip.ev_share)} c={COLORS.ev} />
                <Stat l="harsh brake" v={String(selectedTrip.events.harsh_brake)} c={COLORS.brake} />
                <Stat l="harsh accel" v={String(selectedTrip.events.harsh_accel)} c={COLORS.accel} />
                <Stat l="climb" v={`${fmt.int(selectedTrip.climb_m)} m`} />
                <Stat l="avg speed" v={`${fmt.int(selectedTrip.avg_speed)} km/h`} />
                <Stat l="cost" v={fmt.n1(selectedTrip.cost)} />
              </div>
              <div className="flex gap-2 mt-3">
                <button className="btn on flex-1 justify-center" onClick={() => nav(`/trips/${selectedTrip.id}`)}>Open trip</button>
                <button className="btn flex-1 justify-center" onClick={flyTrip}>Fly it</button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="spots" className="material rounded-2xl p-4 pointer-events-auto flex flex-col min-h-0" initial={reduced ? false : { opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={reduced ? undefined : { opacity: 0, x: 16 }} transition={spring}>
              <div className="flex gap-1 mb-2">
                <button className="btn" aria-pressed={panel === 'spots'} onClick={() => setPanel('spots')}>Harsh spots</button>
                <button className="btn danger" aria-pressed={panel === 'streets'} onClick={() => { setPanel('streets'); setShowStreets(true) }}>Speeding streets</button>
              </div>
              {panel === 'streets' ? (<>
              <div className="eyebrow">Streets where you speed</div>
              <div className="small mt-0.5">{streets?.length ?? 0} stretches flagged over the limit on 2+ trips · ranked by trips × km over</div>
              <ol className="mt-3 grid gap-1 overflow-auto scroll-fade min-h-0 pr-1">
                {(streets ?? []).slice(0, 15).map((st, i) => (
                  <motion.li key={st.id} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: reduced ? 0 : i * 0.03 }}>
                    <button className="w-full text-left rounded-xl px-3 py-2 hover:bg-white/5 active:scale-[0.99] transition-transform" onClick={() => gotoStreet(st)}>
                      <div className="flex items-center gap-3">
                        <span className="num-lg !text-xl w-12 text-right" style={{ color: COLORS.accel }}>{fmt.n1(st.km_over)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold truncate">km over · {st.trips} trips{st.highway ? ' · highway' : ''}</div>
                          <div className="small truncate">about {fmt.int(st.speed_avg)} km/h, up to {fmt.int(st.speed_max)} · {fmt.int(st.seconds_over / 60)} min total</div>
                        </div>
                        <span className="small">{fmt.date(st.last_ts)}</span>
                      </div>
                    </button>
                  </motion.li>
                ))}
                {streets && streets.length === 0 && <li className="small py-4">Nothing flagged in this range.</li>}
              </ol>
              <div className="small mt-3">Over the limit as flagged by the car itself. Speeds are estimates.</div>
              </>) : (<>
              <div className="eyebrow">Where it keeps happening</div>
              <div className="small mt-0.5">{harshCount} harsh events · {hotspots?.length ?? 0} places with repeats</div>
              <ol className="mt-3 grid gap-1 overflow-auto scroll-fade min-h-0 pr-1">
                {topSpots.map((h, i) => (
                  <motion.li key={`${h.lat}-${h.lon}`} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ ...spring, delay: reduced ? 0 : i * 0.03 }}>
                    <button className="w-full text-left rounded-xl px-3 py-2 hover:bg-white/5 active:scale-[0.99] transition-transform" onClick={() => gotoHotspot(h)}>
                      <div className="flex items-center gap-3">
                        <span className="num-lg !text-xl w-8 text-right" style={{ color: h.harsh_brake >= h.harsh_accel ? COLORS.brake : COLORS.accel }}>{h.count}</span>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold truncate capitalize">{h.label}</div>
                          <div className="small truncate">{h.harsh_brake} brake · {h.harsh_accel} accel · {h.trips.length} trips{h.elevation_m != null ? ` · ${fmt.int(h.elevation_m)} m` : ''}</div>
                        </div>
                        <span className="small">{fmt.date(h.last_ts)}</span>
                      </div>
                    </button>
                  </motion.li>
                ))}
                {hotspots && hotspots.length === 0 && <li className="small py-4">No repeated spots in this range.</li>}
              </ol>
              <div className="small mt-3">Hotspot = harsh events within 60 m of each other. <Estimate>clustered here</Estimate></div>
              </>)}
            </motion.div>
          )}
        </AnimatePresence>
      </aside>

      {!ready && <div className="absolute inset-0 grid place-items-center pointer-events-none"><div className="material rounded-xl px-4 py-2 small">Loading terrain…</div></div>}
      <div className="absolute left-4 bottom-4 z-10 small material rounded-lg px-2 py-1">3D terrain · drag with right mouse or ⌘ to tilt · <Link to="/trips" className="underline">all trips</Link></div>
    </div>
  )
}

function Stat({ l, v, c }: { l: string; v: string; c?: string }) {
  return <div className="rounded-lg bg-white/5 px-2.5 py-1.5"><div className="eyebrow !text-[0.6rem]">{l}</div><div className="num font-semibold" style={{ color: c }}>{v}</div></div>
}

function Legend({ color }: { color: ColorMode }) {
  const items = color === 'ev' ? [[COLORS.ev, 'electric'], [COLORS.ice, 'engine']] : color === 'speed' ? [[COLORS.speed[0], '0'], [COLORS.speed[1], '40'], [COLORS.speed[2], '70'], [COLORS.speed[3], '100'], [COLORS.speed[4], '130 km/h']] : [[COLORS.brake, 'over the limit'], ['rgba(120,135,150,0.6)', 'within']]
  return (
    <div className="material rounded-xl px-3 py-2 flex items-center gap-3 flex-wrap">
      {items.map(([c, l]) => <span key={l} className="small inline-flex items-center gap-1.5"><span className="inline-block w-3 h-1.5 rounded" style={{ background: c }} />{l}</span>)}
      <span className="w-px h-4 bg-white/10" />
      <span className="small inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLORS.brake }} />harsh brake</span>
      <span className="small inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: COLORS.accel }} />harsh accel</span>
    </div>
  )
}
