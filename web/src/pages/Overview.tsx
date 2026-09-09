import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Chart, axisStyle } from '../components/Chart'
import { Kpi } from '../components/Kpi'
import { Panel } from '../components/Panel'
import { WEEKDAYS, fmt, isoWeek, scoreColor } from '../lib/format'
import { rangeKey, useRange } from '../lib/range'
import { useApi } from '../lib/useApi'
import { MiniMap } from './MiniMap'

export function Overview() {
  const [range] = useRange()
  const k = rangeKey(range)
  const { data: s } = useApi(`summary_${k}`, () => api.summary(range))
  const { data: hm } = useApi(`heatmap_${k}`, () => api.heatmap(range))
  const { data: v } = useApi('vehicle', () => api.vehicle())
  const { data: settings } = useApi('settings', () => api.settings())
  const cur = settings?.currency ?? ''

  const weekly = useMemo(() => {
    const w = new Map<string, { km: number; fuel: number; harsh: number }>()
    for (const d of hm?.daily ?? []) {
      const key = isoWeek(d.date)
      const cur = w.get(key) ?? { km: 0, fuel: 0, harsh: 0 }
      w.set(key, { km: cur.km + d.km, fuel: cur.fuel + d.fuel_l, harsh: cur.harsh + d.harsh })
    }
    return [...w.entries()].sort()
  }, [hm])

  const scoreTrend = useMemo(() => (hm?.daily ?? []).filter((d) => d.score != null).map((d) => [d.date, d.score] as [string, number]), [hm])
  const harshHeat = useMemo(() => (hm?.weekday_hour ?? []).map((c) => [c.hour, c.weekday, c.harsh, c.trips, c.km]), [hm])
  const calendar = useMemo(() => (hm?.daily ?? []).map((d) => [d.date, d.km]), [hm])
  const calRange = useMemo(() => {
    const ds = (hm?.daily ?? []).map((d) => d.date).sort()
    return ds.length ? [ds[0], ds[ds.length - 1]] : undefined
  }, [hm])

  return (
    <div className="grid gap-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="display">Every kilometre, every hard stop.</h1>
          <p className="small mt-1">{v ? `${v.trips_total} trips since ${fmt.dateLong(v.history_from)} · odometer ${fmt.int(v.odometer_km)} km` : 'Loading vehicle…'}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi label="Distance" value={s?.km} unit="km" format={(x) => fmt.int(x)} hint={s ? `${s.trips} trips · ${fmt.n1(s.hours)} h` : undefined} />
        <Kpi label="Consumption" value={s?.l_per_100km} unit="l/100km" format={(x) => fmt.n2(x)} hint={s ? `${fmt.n1(s.fuel_l)} l total` : undefined} />
        <Kpi label="Fuel cost" value={s?.cost} unit={cur} format={(x) => fmt.int(x)} hint={settings ? `${settings.fuel_price.toFixed(2)} ${cur}/l` : undefined} />
        <Kpi label="EV share" value={s ? s.ev_share_km * 100 : undefined} unit="% of km" format={(x) => fmt.int(x)} hint={s ? `${fmt.pct(s.ev_share_time)} of time` : undefined} tone="#2ee6b7" />
        <Kpi label="Driver score" value={s?.scores.global} format={(x) => fmt.int(x)} hint={s ? `brake ${s.scores.braking} · accel ${s.scores.acceleration}` : undefined} tone={scoreColor(s?.scores.global)} />
        <Kpi label="Harsh brakes" value={s?.events.harsh_brake} format={(x) => fmt.int(x)} hint={s ? `${s.events.smooth_brake} smooth stops` : undefined} tone="#ff5a36" />
        <Kpi label="Harsh accelerations" value={s?.events.harsh_accel} format={(x) => fmt.int(x)} hint={s ? `${fmt.n1(s.harsh_per_100km)} harsh per 100 km` : undefined} tone="#ffb224" />
        <Kpi label="Climb" value={s?.climb_m} unit="m" format={(x) => fmt.int(x)} hint={s?.avg_speed ? `${fmt.int(s.avg_speed)} km/h average overall` : undefined} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Driver score, per day" className="lg:col-span-2">
          <Chart className="h-56 w-full" option={{
            grid: { left: 36, right: 12, top: 18, bottom: 28 },
            xAxis: { type: 'time', ...axisStyle, splitLine: { show: false } },
            yAxis: { type: 'value', min: 50, max: 100, ...axisStyle },
            tooltip: { trigger: 'axis', valueFormatter: (x: unknown) => `${x}` },
            visualMap: { show: false, dimension: 1, pieces: [{ lt: 65, color: '#ff5a36' }, { gte: 65, lt: 75, color: '#ffb224' }, { gte: 75, lt: 85, color: '#9be15d' }, { gte: 85, color: '#2ee6b7' }] },
            series: [{ type: 'line', data: scoreTrend, smooth: 0.35, symbol: 'circle', symbolSize: 5, lineStyle: { width: 2 }, areaStyle: { opacity: 0.08 }, markLine: { silent: true, symbol: 'none', lineStyle: { color: 'rgba(255,255,255,0.18)', type: 'dashed' }, label: { color: '#96a2b1', formatter: 'avg {c}' }, data: [{ type: 'average' }] } }],
          }} />
        </Panel>
        <Panel title="The car" right={<Link to="/map" className="small underline">open map</Link>}>
          <div className="flex gap-4">
            <div className="flex-1 grid gap-2">
              <Row k="Model" v={v ? `${v.model?.replace(/^\d{4} Toyota /, '') ?? ''}` : '…'} />
              <Row k="Built" v={v?.manufactured ? fmt.dateLong(v.manufactured) : '…'} />
              <Row k="Fuel" v={v ? `${v.fuel_level_pct}% · ${fmt.int(v.range_km)} km range` : '…'} />
              <Row k="Odometer" v={v ? `${fmt.int(v.odometer_km)} km` : '…'} />
              <Row k="Last service" v={v?.services?.[0] ? `${fmt.date(v.services[0].date)} · ${fmt.int(v.services[0].mileage_km)} km` : '–'} />
              <Row k="Parked" v={v?.last_location ? `${fmt.dateLong(v.last_location.ts)} ${fmt.time(v.last_location.ts)}` : '–'} />
            </div>
            <div className="w-40 h-40 rounded-xl overflow-hidden border border-line shrink-0">
              {v?.last_location && <MiniMap lat={v.last_location.lat} lon={v.last_location.lon} />}
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Kilometres and fuel, per week" className="lg:col-span-2">
          <Chart className="h-56 w-full" option={{
            grid: { left: 40, right: 40, top: 18, bottom: 28 },
            legend: { top: 0, right: 0, textStyle: { color: '#96a2b1' }, itemWidth: 10, itemHeight: 10 },
            xAxis: { type: 'category', data: weekly.map(([w]) => fmt.date(w)), ...axisStyle, splitLine: { show: false } },
            yAxis: [{ type: 'value', name: 'km', ...axisStyle }, { type: 'value', name: 'l', ...axisStyle, splitLine: { show: false } }],
            tooltip: { trigger: 'axis' },
            series: [
              { name: 'km', type: 'bar', data: weekly.map(([, x]) => Math.round(x.km)), itemStyle: { color: '#3b82f6', borderRadius: [4, 4, 0, 0] }, barMaxWidth: 26 },
              { name: 'litres', type: 'line', yAxisIndex: 1, data: weekly.map(([, x]) => +x.fuel.toFixed(1)), smooth: 0.3, symbol: 'circle', symbolSize: 5, lineStyle: { color: '#c9b48a', width: 2 }, itemStyle: { color: '#c9b48a' } },
              { name: 'harsh events', type: 'line', yAxisIndex: 1, data: weekly.map(([, x]) => x.harsh), smooth: 0.3, symbol: 'none', lineStyle: { color: '#ff5a36', width: 1.5, type: 'dashed' }, itemStyle: { color: '#ff5a36' } },
            ],
          }} />
        </Panel>
        <Panel title="When you drive hard (harsh events)">
          <Chart className="h-56 w-full" option={{
            grid: { left: 34, right: 10, top: 8, bottom: 40 },
            xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => h), ...axisStyle, splitLine: { show: false }, axisLabel: { ...axisStyle.axisLabel, interval: 2 } },
            yAxis: { type: 'category', data: WEEKDAYS, ...axisStyle, splitLine: { show: false } },
            tooltip: { formatter: (p: unknown) => { const d = (p as { data: number[] }).data; return `${WEEKDAYS[d[1] ?? 0]} ${d[0]}:00 · ${d[2]} harsh · ${d[3]} trips · ${fmt.n1(d[4])} km` } },
            visualMap: { min: 0, max: Math.max(1, ...harshHeat.map((c) => c[2] ?? 0)), show: false, inRange: { color: ['rgba(255,90,54,0.08)', '#ff5a36'] } },
            series: [{ type: 'heatmap', data: harshHeat, itemStyle: { borderRadius: 3, borderColor: '#07090d', borderWidth: 1.5 } }],
          }} />
        </Panel>
      </div>

      {calRange && (
        <Panel title="Kilometres per day">
          <Chart className="h-44 w-full" option={{
            tooltip: { formatter: (p: unknown) => { const d = (p as { data: [string, number] }).data; return `${fmt.dateLong(d[0])} · ${fmt.n1(d[1])} km` } },
            visualMap: { min: 0, max: Math.max(10, ...calendar.map((c) => Number(c[1]))), show: false, inRange: { color: ['rgba(59,130,246,0.12)', '#3b82f6', '#2ee6b7'] } },
            calendar: { range: calRange, left: 40, right: 10, top: 24, cellSize: ['auto', 18], splitLine: { show: false }, itemStyle: { color: 'rgba(255,255,255,0.03)', borderColor: '#07090d', borderWidth: 2 }, dayLabel: { color: '#7f8b99', firstDay: 1, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] }, monthLabel: { color: '#96a2b1' }, yearLabel: { show: false } },
            series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: calendar }],
          }} />
        </Panel>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3 text-sm"><span className="small">{k}</span><span className="num truncate">{v}</span></div>
}
