import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { Chart, axisStyle } from '../components/Chart'
import { Kpi } from '../components/Kpi'
import { Panel } from '../components/Panel'
import { WEEKDAYS, fmt, scoreColor } from '../lib/format'
import { useApi } from '../lib/useApi'
import { COLORS } from '../map/terrain'

export function Commute() {
  const { from = '0', to = '0' } = useParams()
  const { data: c, error } = useApi(`commute_${from}_${to}`, () => api.commute(Number(from), Number(to)))
  const { data: places } = useApi('places', () => api.places())
  const { data: settings } = useApi('settings', () => api.settings())
  const cur = settings?.currency ?? ''
  const label = (id: number) => places?.find((p) => p.id === id)?.label ?? `Place ${id}`
  const best = useMemo(() => c?.runs.find((r) => r.id === c.best_run), [c])
  const byWeekday = useMemo(() => {
    const w = Array.from({ length: 7 }, () => ({ n: 0, dur: [] as number[], harsh: 0 }))
    for (const r of c?.runs ?? []) { const x = w[r.weekday]!; x.n++; x.dur.push(r.duration_min); x.harsh += r.harsh }
    return w.map((x) => ({ n: x.n, dur: x.dur.length ? x.dur.sort((a, b) => a - b)[Math.floor(x.dur.length / 2)]! : null, harsh: x.n ? x.harsh / x.n : 0 }))
  }, [c])

  if (error) return <div className="panel p-6">No trips between these places. <Link className="underline" to="/places">Back</Link></div>
  if (!c) return <div className="small p-6">Loading…</div>
  const busySlots = c.slots.filter((s) => s.runs >= 2)

  return (
    <div className="grid gap-4">
      <div>
        <div className="small"><Link to="/places" className="underline">Places</Link> / commute coach</div>
        <h1 className="display">{label(c.from)} <span className="text-dim">→</span> {label(c.to)}</h1>
        <p className="small mt-1">{c.runs.length} runs · typically {fmt.int(c.typical_duration_min)} min · every run compared by the 15-minute slot you left in</p>
      </div>

      <Panel title="What the data says">
        <ul className="grid gap-2">
          {c.findings.map((f, i) => <li key={i} className="flex gap-3 items-start"><span className="mt-1 inline-block w-2 h-2 rounded-full shrink-0" style={{ background: COLORS.ev }} /><span>{f}</span></li>)}
        </ul>
      </Panel>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        <Kpi label="Runs" value={c.runs.length} format={(x) => fmt.int(x)} />
        <Kpi label="Typical duration" value={c.typical_duration_min} unit="min" format={(x) => fmt.int(x)} hint={best ? `best ${fmt.int(best.duration_min)} min` : undefined} />
        <Kpi label="Best run" value={best?.l_per_100km ?? undefined} unit="l/100km" format={(x) => fmt.n2(x)} hint={best ? `${fmt.dateLong(best.start_ts)} ${fmt.time(best.start_ts)}` : undefined} tone={COLORS.ev} />
        <Kpi label="Harsh per run" value={c.runs.reduce((a, r) => a + r.harsh, 0) / c.runs.length} format={(x) => fmt.n1(x)} tone={COLORS.brake} />
        <Kpi label="Harsh at arrival" value={c.harsh_arrival_share * 100} unit="%" format={(x) => fmt.int(x)} hint="of harsh events in the last tenth" tone={COLORS.accel} />
        <Kpi label="Fuel spent" value={c.runs.reduce((a, r) => a + r.cost, 0)} unit={cur} format={(x) => fmt.int(x)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Panel title="Duration by departure slot (median, slots with 2+ runs)">
          <Chart className="h-64 w-full" option={{
            grid: { left: 40, right: 44, top: 20, bottom: 30 },
            xAxis: { type: 'category', data: busySlots.map((s) => s.slot), ...axisStyle, splitLine: { show: false } },
            yAxis: [{ type: 'value', name: 'min', ...axisStyle }, { type: 'value', name: 'harsh', ...axisStyle, splitLine: { show: false } }],
            tooltip: { trigger: 'axis', formatter: (ps: unknown) => { const a = (ps as { dataIndex: number }[])[0]; const s = busySlots[a?.dataIndex ?? 0]; return s ? `${s.slot} · ${s.runs} runs<br>${fmt.n1(s.duration_median_min)} min · ${fmt.n2(s.l_per_100km_median)} l/100km<br>${fmt.n1(s.harsh_per_run)} harsh / run · score ${s.score_avg}` : '' } },
            series: [
              { type: 'bar', data: busySlots.map((s) => s.duration_median_min), barMaxWidth: 34, itemStyle: { borderRadius: [5, 5, 0, 0], color: '#3b82f6' } },
              { type: 'line', yAxisIndex: 1, data: busySlots.map((s) => s.harsh_per_run), symbol: 'circle', symbolSize: 6, lineStyle: { color: COLORS.brake, width: 2 }, itemStyle: { color: COLORS.brake } },
            ],
          }} />
        </Panel>
        <Panel title="Every run: when you left vs how long it took">
          <Chart className="h-64 w-full" option={{
            grid: { left: 40, right: 16, top: 20, bottom: 30 },
            xAxis: { type: 'value', name: 'departure (h)', min: 0, max: 24, ...axisStyle, splitLine: { show: false } },
            yAxis: { type: 'value', name: 'min', ...axisStyle },
            tooltip: { formatter: (p: unknown) => { const r = c.runs[(p as { dataIndex: number }).dataIndex]; return r ? `${fmt.dateLong(r.start_ts)} ${fmt.time(r.start_ts)}<br>${fmt.n1(r.duration_min)} min · ${fmt.n2(r.l_per_100km)} l/100km · ${r.harsh} harsh · score ${r.score}` : '' } },
            series: [{ type: 'scatter', data: c.runs.map((r) => [r.hour + r.minute / 60, r.duration_min]), symbolSize: (_: unknown, p: { dataIndex: number }) => 6 + 4 * (c.runs[p.dataIndex]?.harsh ?? 0),
              itemStyle: { color: (p: { dataIndex: number }) => c.runs[p.dataIndex]?.id === c.best_run ? COLORS.ev : scoreColor(c.runs[p.dataIndex]?.score), opacity: 0.85 } }],
          }} />
        </Panel>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="By weekday">
          <Chart className="h-52 w-full" option={{
            grid: { left: 40, right: 12, top: 12, bottom: 28 },
            xAxis: { type: 'category', data: WEEKDAYS, ...axisStyle, splitLine: { show: false } },
            yAxis: { type: 'value', name: 'min', ...axisStyle },
            tooltip: { trigger: 'axis', formatter: (ps: unknown) => { const a = (ps as { dataIndex: number }[])[0]; const w = byWeekday[a?.dataIndex ?? 0]; return w ? `${WEEKDAYS[a?.dataIndex ?? 0]}: ${w.n} runs · ${fmt.n1(w.dur)} min · ${fmt.n1(w.harsh)} harsh / run` : '' } },
            series: [{ type: 'bar', data: byWeekday.map((w) => w.dur), barMaxWidth: 26, itemStyle: { borderRadius: [5, 5, 0, 0], color: '#3b82f6' } }],
          }} />
        </Panel>
        <Panel title="All runs" className="lg:col-span-2 !p-0 overflow-hidden">
          <div className="max-h-[320px] overflow-auto">
            <table className="trips">
              <thead><tr><th>Left</th><th className="text-right">min</th><th className="text-right">km</th><th className="text-right">l/100km</th><th className="text-right">EV</th><th className="text-right">Harsh</th><th className="text-right">Score</th><th></th></tr></thead>
              <tbody>
                {[...c.runs].reverse().map((r) => (
                  <tr key={r.id} className="row">
                    <td>{fmt.dateLong(r.start_ts)} <span className="small">{fmt.time(r.start_ts)}</span>{r.id === c.best_run && <span className="chip ml-2" style={{ color: COLORS.ev }}>best</span>}</td>
                    <td className="text-right num">{fmt.n1(r.duration_min)}</td>
                    <td className="text-right num">{fmt.n1(r.km)}</td>
                    <td className="text-right num">{fmt.n2(r.l_per_100km)}</td>
                    <td className="text-right num">{fmt.pct(r.ev_share)}</td>
                    <td className="text-right num" style={{ color: r.harsh ? COLORS.brake : undefined }}>{r.harsh}{r.harsh_arrival ? <span className="small"> ({r.harsh_arrival} at arrival)</span> : ''}</td>
                    <td className="text-right num font-semibold" style={{ color: scoreColor(r.score) }}>{r.score ?? '–'}</td>
                    <td className="text-right"><Link className="small underline" to={`/trips/${r.id}`}>open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  )
}
