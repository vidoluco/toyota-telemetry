import { useState } from 'react'
import { api } from '../api/client'
import type { Fill } from '../api/types'
import { Chart, axisStyle } from '../components/Chart'
import { Kpi } from '../components/Kpi'
import { Estimate, Panel } from '../components/Panel'
import { fmt } from '../lib/format'
import { clearApiCache, useApi } from '../lib/useApi'
import { COLORS } from '../map/terrain'

export function Tank() {
  const { data: t, reload } = useApi('tank', () => api.tank())
  const { data: settings } = useApi('settings', () => api.settings())
  const cur = settings?.currency ?? ''
  const [adding, setAdding] = useState(false)
  const refresh = () => { clearApiCache(); reload() }

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="display">Tank log</h1>
        <p className="small mt-1">Toyota reports the fuel level once a day as a whole percent. A jump of 8 points or more between two syncs is a fill. The gauge is not linear (it sits at 100% for a long time, then drops fast below half), so the litre estimate from the percentage is only a placeholder: type the litres from the receipt and the log switches to that. Real consumption uses receipt litres and odometer kilometres only.</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Level now" value={t?.level_now} unit="%" format={(x) => fmt.int(x)} hint={t?.range_now != null ? `${fmt.int(t.range_now)} km range` : undefined} tone={COLORS.ev} />
        <Kpi label="Fills logged" value={t?.fills} format={(x) => fmt.int(x)} hint={t ? `${t.snapshots} daily readings since ${t.first_snapshot ? fmt.date(t.first_snapshot) : '–'}` : undefined} />
        <Kpi label="Litres" value={t?.litres_total} unit="l" format={(x) => fmt.n1(x)} />
        <Kpi label="Spent" value={t?.cost_total} unit={cur} format={(x) => fmt.int(x)} hint={settings?.fuel_price_source === 'fills' ? `avg ${settings.fuel_price.toFixed(2)} ${cur}/l from your fills` : 'at the price set by hand'} />
        <Kpi label="Real l/100km" value={t?.l_per_100km_real} format={(x) => fmt.n2(x)} hint="litres filled ÷ km on the odometer" tone={COLORS.accel} />
        <Kpi label="Toyota's l/100km" value={t?.l_per_100km_toyota} format={(x) => fmt.n2(x)} hint="sum of trip figures, same window" />
      </div>

      {t && t.snapshots < 3 && (
        <div className="panel p-4 small">Only {t.snapshots} reading{t.snapshots === 1 ? '' : 's'} so far. The car reports its level once a day, so fills start appearing after a few syncs. Run <code>uv run toyota schedule install</code> once and the sync happens every morning by itself.</div>
      )}

      <Panel title="Fuel level over time" right={<Estimate>1 point ≈ {((t?.tank_capacity_l ?? 36) / 100).toFixed(2)} l</Estimate>}>
        <Chart className="h-56 w-full" option={{
          grid: { left: 40, right: 40, top: 18, bottom: 28 },
          xAxis: { type: 'time', ...axisStyle, splitLine: { show: false } },
          yAxis: [{ type: 'value', min: 0, max: 100, name: '%', ...axisStyle }, { type: 'value', name: 'km', ...axisStyle, splitLine: { show: false } }],
          tooltip: { trigger: 'axis' },
          series: [
            { name: 'level %', type: 'line', step: 'end', data: (t?.levels ?? []).map((l) => [l.ts, l.pct]), areaStyle: { color: 'rgba(46,230,183,0.12)' }, lineStyle: { color: COLORS.ev, width: 2 }, itemStyle: { color: COLORS.ev }, symbolSize: 6 },
            { name: 'range km', type: 'line', yAxisIndex: 1, data: (t?.levels ?? []).map((l) => [l.ts, l.range_km]), lineStyle: { color: '#7b8aa0', width: 1, type: 'dashed' }, itemStyle: { color: '#7b8aa0' }, symbol: 'none' },
          ],
        }} />
      </Panel>

      <Panel title="Fills" right={<button className="btn" onClick={() => setAdding((a) => !a)}>{adding ? 'Cancel' : 'Add a fill by hand'}</button>}>
        {adding && <AddFill onDone={() => { setAdding(false); refresh() }} />}
        {t && t.fills_list.length === 0 && !adding && <div className="small py-4">No fills detected yet.</div>}
        <div className="grid gap-2 mt-2">
          {(t?.fills_list ?? []).map((f) => <FillRow key={f.ts} f={f} cur={cur} onSaved={refresh} />)}
        </div>
      </Panel>
    </div>
  )
}

function FillRow({ f, cur, onSaved }: { f: Fill; cur: string; onSaved: () => void }) {
  const [litres, setLitres] = useState(f.litres ?? '')
  const [price, setPrice] = useState(f.price_per_l ?? '')
  const [dirty, setDirty] = useState(false)
  const save = async () => { await api.editFill(f.ts, { litres: litres === '' ? undefined : Number(litres), price_per_l: price === '' ? undefined : Number(price) }); setDirty(false); onSaved() }
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2 grid md:grid-cols-[1fr_auto] gap-3 items-center">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{fmt.dateLong(f.ts)}</span>
          {f.estimated ? <span className="chip">estimated</span> : <span className="chip" style={{ color: COLORS.ev }}>from receipt</span>}
          {f.note && <span className="small">{f.note}</span>}
        </div>
        <div className="small mt-0.5">
          {f.pct_before != null ? `${f.pct_before}% → ${f.pct_after}%` : 'manual'} · <span className="num text-ink">{fmt.n1(f.litres_used)} l</span> · <span className="num text-ink">{fmt.n1(f.cost)} {cur}</span>
          {f.km_since_prev != null && <> · {fmt.int(f.km_since_prev)} km since previous · real <span className="num text-ink">{fmt.n2(f.l_per_100km_real)}</span> vs Toyota <span className="num text-ink">{fmt.n2(f.l_per_100km_toyota)}</span> l/100km</>}
        </div>
      </div>
      <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); save() }}>
        <input className="field !w-20" type="number" step="0.01" placeholder="litres" value={litres} onChange={(e) => { setLitres(e.target.value); setDirty(true) }} />
        <input className="field !w-20" type="number" step="0.01" placeholder={`${cur}/l`} value={price} onChange={(e) => { setPrice(e.target.value); setDirty(true) }} />
        <button className={`btn ${dirty ? 'on' : ''}`} type="submit" disabled={!dirty}>Save</button>
      </form>
    </div>
  )
}

function AddFill({ onDone }: { onDone: () => void }) {
  const [ts, setTs] = useState(new Date().toISOString().slice(0, 16))
  const [litres, setLitres] = useState('')
  const [price, setPrice] = useState('')
  const [odo, setOdo] = useState('')
  return (
    <form className="flex flex-wrap items-end gap-2 rounded-xl bg-white/5 p-3" onSubmit={async (e) => { e.preventDefault(); await api.addFill({ ts: new Date(ts).toISOString(), litres: Number(litres), price_per_l: price ? Number(price) : undefined, odometer_km: odo ? Number(odo) : undefined }); onDone() }}>
      <label className="small grid gap-1">When<input className="field !w-52 !font-sans" type="datetime-local" value={ts} onChange={(e) => setTs(e.target.value)} required /></label>
      <label className="small grid gap-1">Litres<input className="field !w-24" type="number" step="0.01" value={litres} onChange={(e) => setLitres(e.target.value)} required /></label>
      <label className="small grid gap-1">Price / l<input className="field !w-24" type="number" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <label className="small grid gap-1">Odometer km<input className="field !w-28" type="number" value={odo} onChange={(e) => setOdo(e.target.value)} /></label>
      <button className="btn on" type="submit">Add</button>
    </form>
  )
}
