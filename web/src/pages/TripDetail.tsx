import * as maplibregl from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { EventProps } from '../api/types'
import { Chart, axisStyle } from '../components/Chart'
import { Kpi } from '../components/Kpi'
import { Estimate, Panel } from '../components/Panel'
import { fmt, scoreColor } from '../lib/format'
import { useApi } from '../lib/useApi'
import { COLORS, addEventLayers, addRouteLayers, approachBounds, createTerrainMap, flyAlong, pitchWhenReady, routeColorEv, routeColorSpeed, startOrbit } from '../map/terrain'

const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function TripDetail() {
  const { id = '' } = useParams()
  const { data: t, error } = useApi(`trip_${id}`, () => api.trip(id))
  const { data: settings } = useApi('settings', () => api.settings())
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const stopper = useRef<(() => void) | null>(null)
  const [speedColor, setSpeedColor] = useState(false)
  const [motion, setMotion] = useState<'idle' | 'orbit' | 'fly'>('idle')

  useEffect(() => {
    if (!box.current || !t || mapRef.current) return
    let map: maplibregl.Map | undefined
    const center: [number, number] = [(t.bbox[0] + t.bbox[2]) / 2, (t.bbox[1] + t.bbox[3]) / 2]
    createTerrainMap(box.current, { center, zoom: 12, pitch: 0, bearing: 0 }, 1.15).then((m) => {
      map = m; mapRef.current = m
      m.addSource('route', { type: 'geojson', data: t.route })
      m.addSource('events', { type: 'geojson', data: t.events })
      addRouteLayers(m, 'route', 'route', routeColorEv(), 3)
      addEventLayers(m, 'events', 'events')
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 })
      m.on('mousemove', 'events-dot', (e) => { const p = e.features?.[0]?.properties as unknown as EventProps | undefined; if (!p) return; popup.setLngLat(e.lngLat).setHTML(`<b>${p.label}</b><br>${fmt.time(p.ts)}${p.slope ? ` · slope ${p.slope}%` : ''}`).addTo(m) })
      m.on('mouseleave', 'events-dot', () => popup.remove())
      // Start high (camera above any mountain), then, once terrain is known, settle close and pitched.
      const bounds: [[number, number], [number, number]] = [[t.bbox[0], t.bbox[1]], [t.bbox[2], t.bbox[3]]]
      approachBounds(m, bounds, { padding: 60, maxZoom: 14.5, pitch: 50, bearing: -15, animate: !reduced })
    })
    return () => { stopper.current?.(); map?.remove(); mapRef.current = null }
  }, [t])
  useEffect(() => { const m = mapRef.current; if (!m?.getLayer('route-line')) return; const e = speedColor ? routeColorSpeed() : routeColorEv(); m.setPaintProperty('route-line', 'line-color', e); m.setPaintProperty('route-glow', 'line-color', e) }, [speedColor])

  const stop = () => { stopper.current?.(); stopper.current = null; setMotion('idle') }
  const orbit = () => { const m = mapRef.current; if (!m) return; if (motion === 'orbit') return stop(); stop(); stopper.current = startOrbit(m, 3); setMotion('orbit') }
  const fly = () => { const m = mapRef.current; if (!m || !t) return; stop(); const coords = t.route.features.flatMap((f) => f.geometry.coordinates as [number, number][]); stopper.current = flyAlong(m, coords, { metersPerSec: Math.max(100, t.km * 10), onDone: () => setMotion('idle') }); setMotion('fly') }

  // Events positioned on the profile by time.
  const eventMarks = useMemo(() => {
    if (!t) return []
    const t0 = new Date(t.start_ts).getTime()
    return t.events.features.filter((f) => !f.properties.good).map((f) => {
      const sec = (new Date(f.properties.ts).getTime() - t0) / 1000
      let best = t.profile[0], bd = Infinity
      for (const p of t.profile) { const d = Math.abs(p.t - sec); if (d < bd) { bd = d; best = p } }
      return { km: best?.km ?? 0, speed: best?.speed_est ?? 0, label: f.properties.label, type: f.properties.type }
    })
  }, [t])

  const profileOption = useMemo(() => {
    if (!t) return {}
    const km = t.profile.map((p) => p.km)
    const hasElev = t.profile.some((p) => p.elevation_m != null)
    return {
      grid: { left: 44, right: 48, top: 24, bottom: 34 },
      legend: { top: 0, right: 0, textStyle: { color: '#96a2b1' }, itemWidth: 10, itemHeight: 10 },
      tooltip: { trigger: 'axis', formatter: (ps: unknown) => { const arr = ps as { axisValue: string; seriesName: string; value: number; color: string }[]; return `<b>${fmt.n1(Number(arr[0]?.axisValue))} km</b><br>` + arr.map((a) => `<span style="color:${a.color}">●</span> ${a.seriesName}: ${fmt.int(a.value)}`).join('<br>') } },
      xAxis: { type: 'category', data: km, ...axisStyle, splitLine: { show: false }, axisLabel: { ...axisStyle.axisLabel, formatter: (v: string) => fmt.n1(Number(v)) } },
      yAxis: [{ type: 'value', name: 'km/h', ...axisStyle, max: (v: { max: number }) => Math.ceil(v.max / 10) * 10 + 10 }, { type: 'value', name: 'm', ...axisStyle, splitLine: { show: false }, show: hasElev, min: (v: { min: number }) => Math.floor(v.min / 50) * 50 - 20 }],
      dataZoom: [{ type: 'inside' }],
      series: [
        { name: 'elevation', type: 'line', yAxisIndex: 1, data: t.profile.map((p) => p.elevation_m), symbol: 'none', smooth: 0.2, lineStyle: { width: 1, color: '#7b8aa0' }, areaStyle: { color: 'rgba(123,138,160,0.14)' }, z: 1 },
        { name: 'speed', type: 'line', data: t.profile.map((p) => p.speed_est), symbol: 'none', smooth: 0.15, sampling: 'lttb', lineStyle: { width: 2, color: '#3b82f6' }, z: 3,
          markPoint: { symbol: 'pin', symbolSize: 34, data: eventMarks.map((e) => ({ coord: [km.indexOf(e.km), e.speed], value: e.type, itemStyle: { color: e.type === 'B' ? COLORS.brake : COLORS.accel }, label: { color: '#07090d', fontWeight: 700, fontSize: 10 }, tooltip: { formatter: e.label } })) } },
        { name: 'electric', type: 'line', data: t.profile.map((p) => (p.is_ev ? p.speed_est : null)), symbol: 'none', lineStyle: { width: 2.2, color: COLORS.ev }, z: 4 },
      ],
    }
  }, [t, eventMarks])

  const counts = useMemo(() => { const f = t?.events.features ?? []; return { harsh_brake: f.filter((x) => !x.properties.good && x.properties.type === 'B').length, harsh_accel: f.filter((x) => !x.properties.good && x.properties.type === 'A').length, good: f.filter((x) => x.properties.good).length } }, [t])
  if (error) return <div className="panel p-6">Trip not found. <Link className="underline" to="/trips">Back to trips</Link></div>
  if (!t) return <div className="small p-6">Loading trip…</div>
  const cur = settings?.currency ?? ''

  return (
    <div className="grid gap-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="small"><Link to="/trips" className="underline">Trips</Link> / {t.night && <span className="chip mr-1">night</span>}</div>
          <h1 className="display">{fmt.dateLong(t.start_ts)} <span className="text-dim">{fmt.time(t.start_ts)} – {fmt.time(t.end_ts)}</span></h1>
        </div>
        <Link to={`/map?trip=${t.id}`} className="btn">Show on the big map</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi label="Distance" value={t.km} unit="km" format={(x) => fmt.n1(x)} hint={fmt.dur(t.duration_s)} />
        <Kpi label="Consumption" value={t.l_per_100km} unit="l/100km" format={(x) => fmt.n2(x)} hint={`${fmt.n2(t.fuel_l)} l · ${fmt.n1(t.cost)} ${cur}`} />
        <Kpi label="Score" value={t.scores.global} format={(x) => fmt.int(x)} tone={scoreColor(t.scores.global)} hint={`brake ${t.scores.braking} · accel ${t.scores.acceleration}`} />
        <Kpi label="EV share" value={t.ev_share * 100} unit="%" format={(x) => fmt.int(x)} tone={COLORS.ev} hint={`${fmt.n1(t.ev_km)} km electric`} />
        <Kpi label="Harsh brakes" value={counts.harsh_brake} format={(x) => fmt.int(x)} tone={COLORS.brake} />
        <Kpi label="Harsh accel" value={counts.harsh_accel} format={(x) => fmt.int(x)} tone={COLORS.accel} hint={`${counts.good} smooth`} />
        <Kpi label="Climb" value={t.climb_m} unit="m" format={(x) => fmt.int(x)} hint={`${fmt.int(t.descent_m)} m down`} />
        <Kpi label="Average speed" value={t.avg_speed} unit="km/h" format={(x) => fmt.int(x)} hint={`${fmt.n1(t.highway_km)} km motorway · Toyota reports no top speed`} />
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <Panel className="lg:col-span-3 !p-0 overflow-hidden relative h-[480px]">
          <div ref={box} className="h-full w-full" />
          <div className="absolute left-3 top-3 material rounded-xl p-1.5 flex gap-1">
            <button className="btn" aria-pressed={!speedColor} onClick={() => setSpeedColor(false)}>EV / engine</button>
            <button className="btn" aria-pressed={speedColor} onClick={() => setSpeedColor(true)}>Speed</button>
            <span className="w-px h-5 bg-white/10 mx-1 self-center" />
            <button className="btn" aria-pressed={motion === 'orbit'} onClick={orbit}>Orbit</button>
            <button className="btn" aria-pressed={motion === 'fly'} onClick={fly}>{motion === 'fly' ? 'Flying…' : 'Fly'}</button>
          </div>
        </Panel>
        <div className="lg:col-span-2 grid gap-4 content-start">
          <Panel title="Drive style">
            <Chart className="h-52 w-full" option={{
              radar: { indicator: [{ name: 'Global', max: 100 }, { name: 'Braking', max: 100 }, { name: 'Acceleration', max: 100 }, { name: 'EV share', max: 100 }, { name: 'Eco mode', max: 100 }], radius: '68%', axisName: { color: '#96a2b1', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } }, splitArea: { show: false }, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } } },
              series: [{ type: 'radar', data: [{ value: [t.scores.global ?? 0, t.scores.braking ?? 0, t.scores.acceleration ?? 0, Math.round(t.ev_share * 100), Math.round(t.mode_share.eco * 100)], areaStyle: { color: 'rgba(46,230,183,0.18)' }, lineStyle: { color: COLORS.ev, width: 2 }, itemStyle: { color: COLORS.ev }, symbolSize: 5 }] }],
            }} />
          </Panel>
          <Panel title="Where the kilometres went">
            <Bar parts={[[t.mode_share.eco, 'eco', '#2ee6b7'], [t.mode_share.normal, 'normal', '#3b82f6'], [t.mode_share.power, 'power', '#ff8a3d']]} />
            <div className="grid grid-cols-3 gap-2 mt-3 small">
              <div>Over limit <span className="num text-ink">{fmt.n1(t.overspeed_km)} km</span></div>
              <div>Highway <span className="num text-ink">{fmt.n1(t.highway_km)} km</span></div>
              <div>Electric <span className="num text-ink">{fmt.n1(t.ev_km)} km</span></div>
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Pace and elevation along the route" right={<Estimate>pace reconstructed from GPS: shape, not calibrated km/h</Estimate>}>
        <Chart className="h-72 w-full" option={profileOption} />
      </Panel>

      {t.events.features.length > 0 && (
        <Panel title="Events">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {t.events.features.map((f) => (
              <div key={f.properties.id} className="rounded-xl bg-white/5 px-3 py-2 flex items-center gap-3">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: f.properties.good ? COLORS.good : f.properties.type === 'B' ? COLORS.brake : COLORS.accel }} />
                <div className="min-w-0 flex-1"><div className="capitalize font-medium truncate">{f.properties.label}</div><div className="small">{fmt.time(f.properties.ts)}{f.properties.slope ? ` · slope ${f.properties.slope}%` : ''}</div></div>
                <button className="btn" onClick={() => { stop(); const m = mapRef.current; if (!m) return; m.flyTo({ center: f.geometry.coordinates as [number, number], zoom: 16, pitch: 0, duration: reduced ? 0 : 1200, essential: true }); m.once('moveend', () => pitchWhenReady(m, 60, m.getBearing(), reduced ? 0 : 800)) }}>Go</button>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

function Bar({ parts }: { parts: [number, string, string][] }) {
  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-white/5">{parts.map(([v, l, c]) => <div key={l} style={{ width: `${v * 100}%`, background: c }} title={`${l} ${Math.round(v * 100)}%`} />)}</div>
      <div className="flex gap-4 mt-2 small">{parts.map(([v, l, c]) => <span key={l} className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: c }} />{l} <span className="num text-ink">{Math.round(v * 100)}%</span></span>)}</div>
    </div>
  )
}
