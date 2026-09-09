import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Chart, axisStyle } from '../components/Chart'
import { Kpi } from '../components/Kpi'
import { Panel } from '../components/Panel'
import { MONTHS, fmt, isoWeek, scoreColor } from '../lib/format'
import { rangeKey, useRange } from '../lib/range'
import { useApi } from '../lib/useApi'
import { COLORS } from '../map/terrain'

export function Driver() {
  const [range] = useRange()
  const k = rangeKey(range)
  const { data: s } = useApi(`summary_${k}`, () => api.summary(range))
  const { data: hm } = useApi(`heatmap_${k}`, () => api.heatmap(range))
  const { data: monthly } = useApi('monthly', () => api.monthly())
  const { data: trips } = useApi(`trips_${k}`, () => api.trips(range))

  const weekly = useMemo(() => {
    const w = new Map<string, { km: number; harsh: number; trips: number }>()
    for (const d of hm?.daily ?? []) { const key = isoWeek(d.date); const c = w.get(key) ?? { km: 0, harsh: 0, trips: 0 }; w.set(key, { km: c.km + d.km, harsh: c.harsh + d.harsh, trips: c.trips + d.trips }) }
    return [...w.entries()].sort().map(([wk, x]) => ({ wk, per100: x.km > 5 ? (x.harsh / x.km) * 100 : null, km: x.km }))
  }, [hm])

  const last = monthly?.[monthly.length - 1], prev = monthly?.[monthly.length - 2]
  const radar = (m: typeof last) => (m ? [m.scores.global ?? 0, m.scores.braking ?? 0, m.scores.acceleration ?? 0, m.scores.constant_speed ?? 0, Math.round(m.ev_share_km * 100)] : [])
  const bad = (s?.events.harsh_brake ?? 0) + (s?.events.harsh_accel ?? 0)
  const good = (s?.events.smooth_brake ?? 0) + (s?.events.smooth_accel ?? 0)
  const ranked = useMemo(() => [...(trips ?? [])].filter((t) => t.km > 2).sort((a, b) => (b.scores.global ?? 0) - (a.scores.global ?? 0)), [trips])
  const byHour = useMemo(() => {
    const buckets = [{ l: 'Night 22–06', h: 0, km: 0 }, { l: 'Morning 06–10', h: 0, km: 0 }, { l: 'Day 10–16', h: 0, km: 0 }, { l: 'Evening 16–22', h: 0, km: 0 }]
    for (const c of hm?.weekday_hour ?? []) { const i = c.hour >= 22 || c.hour < 6 ? 0 : c.hour < 10 ? 1 : c.hour < 16 ? 2 : 3; buckets[i]!.h += c.harsh; buckets[i]!.km += c.km }
    return buckets.map((b) => ({ ...b, per100: b.km > 5 ? (b.h / b.km) * 100 : 0 }))
  }, [hm])

  return (
    <div className="grid gap-4">
      <div><h1 className="display">Driver profile</h1><p className="small mt-1">Scores are Toyota's own coaching scores, 0 to 100. Harsh events are the coaching events the car flagged as not good.</p></div>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Score" value={s?.scores.global} format={(x) => fmt.int(x)} tone={scoreColor(s?.scores.global)} />
        <Kpi label="Braking" value={s?.scores.braking} format={(x) => fmt.int(x)} tone={scoreColor(s?.scores.braking)} />
        <Kpi label="Acceleration" value={s?.scores.acceleration} format={(x) => fmt.int(x)} tone={scoreColor(s?.scores.acceleration)} />
        <Kpi label="Harsh per 100 km" value={s?.harsh_per_100km} format={(x) => fmt.n1(x)} tone={COLORS.brake} hint={s ? `${bad} harsh vs ${good} smooth` : undefined} />
        <Kpi label="Night trips" value={s?.night_trips} format={(x) => fmt.int(x)} hint={s ? `of ${s.trips}` : undefined} />
        <Kpi label="Over the limit" value={s && s.km ? (s.overspeed_km / s.km) * 100 : undefined} unit="% of km" format={(x) => fmt.int(x)} hint={s ? `${fmt.int(s.overspeed_km)} km flagged` : undefined} tone={COLORS.accel} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title={last ? `This month vs ${prev ? MONTHS[prev.month - 1] : 'before'}` : 'Month vs month'}>
          <Chart className="h-64 w-full" option={{
            legend: { bottom: 0, textStyle: { color: '#96a2b1' }, itemWidth: 10, itemHeight: 10 },
            radar: { indicator: [{ name: 'Global', max: 100 }, { name: 'Braking', max: 100 }, { name: 'Acceleration', max: 100 }, { name: 'Constant speed', max: 100 }, { name: 'EV share', max: 100 }], radius: '62%', axisName: { color: '#96a2b1', fontSize: 11 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } }, splitArea: { show: false }, axisLine: { lineStyle: { color: 'rgba(255,255,255,0.1)' } } },
            series: [{ type: 'radar', data: [
              ...(prev ? [{ name: MONTHS[prev.month - 1], value: radar(prev), lineStyle: { color: '#56626f', width: 1.5, type: 'dashed' }, itemStyle: { color: '#56626f' }, areaStyle: { color: 'rgba(86,98,111,0.1)' } }] : []),
              ...(last ? [{ name: MONTHS[last.month - 1], value: radar(last), lineStyle: { color: COLORS.ev, width: 2 }, itemStyle: { color: COLORS.ev }, areaStyle: { color: 'rgba(46,230,183,0.18)' } }] : []),
            ] }],
          }} />
        </Panel>
        <Panel title="Harsh events per 100 km, per week" className="lg:col-span-2">
          <Chart className="h-64 w-full" option={{
            grid: { left: 36, right: 12, top: 16, bottom: 28 },
            xAxis: { type: 'category', data: weekly.map((w) => fmt.date(w.wk)), ...axisStyle, splitLine: { show: false } },
            yAxis: { type: 'value', ...axisStyle },
            tooltip: { trigger: 'axis', formatter: (ps: unknown) => { const a = (ps as { name: string; value: number; dataIndex: number }[])[0]; const w = weekly[a?.dataIndex ?? 0]; return `week of ${a?.name}<br>${fmt.n1(w?.per100)} harsh / 100 km<br>${fmt.int(w?.km)} km` } },
            series: [{ type: 'bar', data: weekly.map((w) => w.per100 == null ? null : +w.per100.toFixed(1)), barMaxWidth: 28, itemStyle: { borderRadius: [5, 5, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: COLORS.brake }, { offset: 1, color: 'rgba(255,90,54,0.35)' }] } }, markLine: { silent: true, symbol: 'none', lineStyle: { color: 'rgba(255,255,255,0.2)', type: 'dashed' }, label: { color: '#96a2b1', formatter: 'avg {c}' }, data: [{ type: 'average' }] } }],
          }} />
        </Panel>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Smooth vs harsh">
          <Chart className="h-56 w-full" option={{
            tooltip: {},
            series: [{ type: 'pie', radius: ['58%', '80%'], padAngle: 2, itemStyle: { borderRadius: 6 }, label: { show: false }, data: [
              { name: 'Smooth stops', value: s?.events.smooth_brake ?? 0, itemStyle: { color: '#6f7d8e' } },
              { name: 'Smooth starts', value: s?.events.smooth_accel ?? 0, itemStyle: { color: '#8a97a6' } },
              { name: 'Harsh brakes', value: s?.events.harsh_brake ?? 0, itemStyle: { color: COLORS.brake } },
              { name: 'Harsh accelerations', value: s?.events.harsh_accel ?? 0, itemStyle: { color: COLORS.accel } },
            ] }],
            graphic: [{ type: 'text', left: 'center', top: 'center', style: { text: `${good + bad ? Math.round((good / (good + bad)) * 100) : 0}%\nsmooth`, fill: '#eef2f6', fontSize: 20, fontWeight: 600, textAlign: 'center', fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' } }],
          }} />
        </Panel>
        <Panel title="Harsh per 100 km, by time of day">
          <Chart className="h-56 w-full" option={{
            grid: { left: 110, right: 24, top: 8, bottom: 24 },
            xAxis: { type: 'value', ...axisStyle },
            yAxis: { type: 'category', data: byHour.map((b) => b.l), ...axisStyle, splitLine: { show: false } },
            tooltip: { formatter: (p: unknown) => { const a = p as { name: string; value: number; dataIndex: number }; return `${a.name}<br>${fmt.n1(a.value)} harsh / 100 km · ${fmt.int(byHour[a.dataIndex]?.km)} km` } },
            series: [{ type: 'bar', data: byHour.map((b) => +b.per100.toFixed(1)), barMaxWidth: 18, itemStyle: { borderRadius: [0, 5, 5, 0], color: COLORS.accel } }],
          }} />
        </Panel>
        <Panel title="Best and worst trips (over 2 km)">
          <div className="grid gap-1.5">
            {[...ranked.slice(0, 3), ...ranked.slice(-3).reverse()].map((t, i) => (
              <Link key={t.id + i} to={`/trips/${t.id}`} className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/5">
                <span className="num-lg !text-xl w-9 text-right" style={{ color: scoreColor(t.scores.global) }}>{t.scores.global}</span>
                <div className="min-w-0 flex-1"><div className="truncate">{fmt.dateLong(t.start_ts)} <span className="small">{fmt.time(t.start_ts)}</span></div><div className="small">{fmt.n1(t.km)} km · {t.events.harsh_brake + t.events.harsh_accel} harsh · {fmt.pct(t.ev_share)} EV</div></div>
                <span className="small">{i < 3 ? 'best' : 'worst'}</span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}
