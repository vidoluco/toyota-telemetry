import * as maplibregl from 'maplibre-gl'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Place } from '../api/types'
import { Kpi } from '../components/Kpi'
import { Panel } from '../components/Panel'
import { fmt } from '../lib/format'
import { rangeKey, useRange } from '../lib/range'
import { clearApiCache, useApi } from '../lib/useApi'
import { STYLE_URLS, getBasemap } from '../map/basemap'
import { COLORS } from '../map/terrain'

const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const spring = { type: 'spring', bounce: 0, duration: 0.35 } as const

export function Places() {
  const [range] = useRange()
  const k = rangeKey(range)
  const { data: places, reload } = useApi(`places_${k}`, () => api.places(range))
  const { data: journeys } = useApi(`journeys_${k}`, () => api.journeys(2, range))
  const { data: chains } = useApi(`chains_${k}`, () => api.chains(range))
  const { data: settings } = useApi('settings', () => api.settings())
  const cur = settings?.currency ?? ''
  const [editing, setEditing] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markers = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    if (!box.current || mapRef.current) return
    const m = new maplibregl.Map({ container: box.current, style: STYLE_URLS[getBasemap()], center: [26.08, 44.44], zoom: 10.5, attributionControl: { compact: true } })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = m
    return () => { m.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const m = mapRef.current; if (!m || !places) return
    for (const mk of markers.current) mk.remove()
    markers.current = []
    const max = Math.max(1, ...places.map((p) => p.visits))
    const b = new maplibregl.LngLatBounds()
    for (const p of places) {
      const size = 10 + 26 * Math.sqrt(p.visits / max)
      const el = document.createElement('button')
      el.title = p.label
      el.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;border:2px solid ${COLORS.stroke};background:${p.id === selected ? COLORS.brake : COLORS.ev};opacity:.9;cursor:pointer;box-shadow:0 0 0 ${p.id === selected ? 6 : 0}px rgba(255,90,54,.25);transition:transform 90ms`
      el.onmousedown = () => { el.style.transform = 'scale(.92)' }
      el.onmouseup = () => { el.style.transform = '' }
      el.onclick = () => setSelected(p.id)
      const mk = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(m)
      markers.current.push(mk)
      if (p.visits >= 2) b.extend([p.lon, p.lat])
    }
    if (!b.isEmpty() && selected == null) m.fitBounds(b, { padding: 60, duration: 0, maxZoom: 12 })
  }, [places, selected])

  const sel = useMemo(() => places?.find((p) => p.id === selected) ?? null, [places, selected])
  useEffect(() => { if (sel) mapRef.current?.flyTo({ center: [sel.lon, sel.lat], zoom: 14, duration: reduced ? 0 : 900 }) }, [sel])

  const save = async (p: Place, name: string) => {
    await api.renamePlace(p.id, name.trim() || null)
    clearApiCache(); reload(); setEditing(null)
  }
  const commutes = journeys?.filter((j) => j.is_commute) ?? []
  const named = places?.filter((p) => p.name).length ?? 0

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="display">Places and journeys</h1>
        <p className="small mt-1">Every trip starts and ends somewhere. Places are 250 m clusters of those points; click a pin or a row to name it. Commutes are routes driven five times or more{range.from || range.to ? ' in the selected window' : ''}.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Places" value={places?.length} format={(x) => fmt.int(x)} hint={`${named} named`} />
        <Kpi label="Commutes" value={commutes.length} format={(x) => fmt.int(x)} hint={journeys ? `${journeys.length} routes driven twice or more` : undefined} />
        <Kpi label="Errand chains" value={chains?.length} format={(x) => fmt.int(x)} hint="trips less than 30 min apart" />
        <Kpi label="Time parked at home" value={places?.[0]?.dwell_median_min != null ? places[0].dwell_median_min / 60 : undefined} unit="h median" format={(x) => fmt.n1(x)} hint={places?.[0]?.label} />
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        <Panel className="lg:col-span-3 !p-0 overflow-hidden h-[460px] relative">
          <div ref={box} className="h-full w-full" />
          <AnimatePresence>
            {sel && (
              <motion.div key={sel.id} className="material absolute left-3 bottom-3 rounded-xl p-3 w-[300px]" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: 8 }} transition={spring}>
                <div className="flex items-center justify-between gap-2">
                  <div className="title truncate">{sel.label}</div>
                  <button className="btn" onClick={() => setSelected(null)}>✕</button>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 small">
                  <div>Visits <span className="num text-ink">{sel.visits}</span></div>
                  <div>Cost here <span className="num text-ink">{fmt.int(sel.cost_to_here)} {cur}</span></div>
                  <div>Dwell <span className="num text-ink">{sel.dwell_median_min != null ? fmt.dur(sel.dwell_median_min * 60) : '–'}</span></div>
                </div>
                <NameEditor place={sel} editing={editing === sel.id} onEdit={() => setEditing(sel.id)} onSave={(n) => save(sel, n)} onCancel={() => setEditing(null)} />
              </motion.div>
            )}
          </AnimatePresence>
        </Panel>
        <Panel title="Places by visits" className="lg:col-span-2 !p-0 overflow-hidden">
          <div className="max-h-[420px] overflow-auto scroll-fade">
            {(places ?? []).map((p) => (
              <div key={p.id} className={`flex items-center gap-3 px-4 py-2 border-b border-white/5 cursor-pointer hover:bg-white/5 ${p.id === selected ? 'bg-white/5' : ''}`} onClick={() => setSelected(p.id)}>
                <span className="num-lg !text-xl w-10 text-right" style={{ color: p.id === selected ? COLORS.brake : COLORS.ev }}>{p.visits}</span>
                <div className="min-w-0 flex-1">
                  {editing === p.id ? (
                    <NameEditor place={p} editing onEdit={() => {}} onSave={(n) => save(p, n)} onCancel={() => setEditing(null)} compact />
                  ) : (
                    <div className="truncate font-medium">{p.label}{!p.name && <span className="chip ml-2">auto</span>}</div>
                  )}
                  <div className="small truncate">{p.arrivals} arrivals · {fmt.int(p.km_to_here)} km driven here · {fmt.int(p.cost_to_here)} {cur}{p.dwell_median_min != null ? ` · stays ${fmt.dur(p.dwell_median_min * 60)}` : ''}</div>
                </div>
                <button className="btn" onClick={(e) => { e.stopPropagation(); setEditing(p.id); setSelected(p.id) }}>Name</button>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Routes, most driven first" right={<span className="small">click a commute for the coach</span>}>
        <div className="overflow-x-auto">
          <table className="trips">
            <thead><tr><th>Route</th><th className="text-right">Trips</th><th className="text-right">Typical</th><th className="text-right">Range</th><th className="text-right">km</th><th className="text-right">l/100km</th><th className="text-right">EV</th><th className="text-right">Harsh / trip</th><th className="text-right">Fuel spent</th><th></th></tr></thead>
            <tbody>
              {(journeys ?? []).map((j) => (
                <tr key={`${j.from}-${j.to}`} className="row">
                  <td>{j.from_label} <span className="text-dim">→</span> {j.to_label}{j.loop && <span className="chip ml-2">loop</span>}{j.is_commute && <span className="chip ml-2" style={{ color: COLORS.ev }}>commute</span>}</td>
                  <td className="text-right num">{j.trips}</td>
                  <td className="text-right num">{j.duration_median_min} min</td>
                  <td className="text-right num small">{j.duration_min_min}–{j.duration_max_min}</td>
                  <td className="text-right num">{fmt.n1(j.km_median)}</td>
                  <td className="text-right num">{fmt.n2(j.l_per_100km_median)}</td>
                  <td className="text-right num">{fmt.pct(j.ev_share)}</td>
                  <td className="text-right num" style={{ color: j.harsh_per_trip >= 2 ? COLORS.brake : undefined }}>{fmt.n1(j.harsh_per_trip)}</td>
                  <td className="text-right num">{fmt.int(j.cost_total)} {cur}</td>
                  <td className="text-right">{j.is_commute ? <Link className="btn on" to={`/commute/${j.from}/${j.to}`}>Coach</Link> : <span className="small">{j.trips < 5 ? `${5 - j.trips} more to coach` : ''}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {chains && chains.length > 0 && (
        <Panel title="Errand chains (stops less than 30 min apart)">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">
            {chains.slice(0, 12).map((c) => (
              <div key={c.start_ts} className="rounded-xl bg-white/5 px-3 py-2">
                <div className="flex justify-between gap-2"><span className="font-medium">{fmt.dateLong(c.start_ts)}</span><span className="small">{c.legs} legs · {fmt.n1(c.km)} km · {fmt.dur(c.minutes * 60)}</span></div>
                <div className="small mt-1 truncate">{c.stops.join(' → ')}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

function NameEditor({ place, editing, onEdit, onSave, onCancel, compact }: { place: Place; editing: boolean; onEdit: () => void; onSave: (n: string) => void; onCancel: () => void; compact?: boolean }) {
  const [v, setV] = useState(place.name ?? '')
  useEffect(() => setV(place.name ?? ''), [place])
  if (!editing) return <div className={compact ? '' : 'mt-2'}><button className="btn" onClick={onEdit}>{place.name ? 'Rename' : `Name this place (auto: ${place.auto_name})`}</button></div>
  return (
    <form className={`flex gap-2 ${compact ? '' : 'mt-2'}`} onSubmit={(e) => { e.preventDefault(); onSave(v) }} onClick={(e) => e.stopPropagation()}>
      <input className="field flex-1 !font-sans" autoFocus placeholder={place.auto_name ?? 'Name'} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }} />
      <button className="btn on" type="submit">Save</button>
      <button className="btn" type="button" onClick={onCancel}>✕</button>
    </form>
  )
}
