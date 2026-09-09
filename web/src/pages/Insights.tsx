import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { Chart, axisStyle } from '../components/Chart'
import { Panel } from '../components/Panel'
import { fmt, scoreColor } from '../lib/format'
import { useApi } from '../lib/useApi'
import { COLORS } from '../map/terrain'

export function Insights() {
  const { data: weeks } = useApi('weeks', () => api.weeks())
  const [week, setWeek] = useState<string | undefined>(undefined)
  const { data: d } = useApi(`insights_${week ?? 'latest'}`, () => api.insights(week))
  const { data: settings } = useApi('settings', () => api.settings())
  const cur = settings?.currency ?? ''
  if (!d || d.empty) return <div className="small p-6">{d?.empty ? 'No trips yet.' : 'Loading…'}</div>
  const s = d.summary
  const Delta = ({ v, unit, invert }: { v: number | null; unit?: string; invert?: boolean }) => {
    if (v == null || v === 0) return <span className="small">no change</span>
    const good = invert ? v < 0 : v > 0
    return <span className="num text-sm" style={{ color: good ? COLORS.ev : COLORS.brake }}>{v > 0 ? '+' : ''}{fmt.n1(v)}{unit ? ` ${unit}` : ''}</span>
  }
  return (
    <div className="grid gap-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="display">Week of {fmt.dateLong(d.week.start)}</h1>
          <p className="small mt-1">Built from your own data after every sync. Compared with the week before.</p>
        </div>
        <select className="field !w-56 !font-sans" value={week ?? weeks?.[0]?.start ?? ''} onChange={(e) => setWeek(e.target.value)}>
          {(weeks ?? []).map((w) => <option key={w.start} value={w.start}>{fmt.date(w.start)} – {fmt.date(w.end)}</option>)}
        </select>
      </div>

      <Panel title="Headlines">
        <ol className="grid gap-2">
          {d.headlines.map((h, i) => <li key={i} className="flex gap-3 items-start"><span className="num-lg !text-base w-5 text-right text-dim">{i + 1}</span><span>{h}</span></li>)}
        </ol>
      </Panel>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { l: 'Distance', v: `${fmt.int(s.km)} km`, d: <Delta v={d.delta.km} unit="km" /> },
          { l: 'Fuel', v: `${fmt.n1(s.fuel_l)} l`, d: <Delta v={d.delta.fuel_l} unit="l" invert /> },
          { l: 'Consumption', v: `${fmt.n2(s.l_per_100km)} l/100km`, d: <Delta v={d.delta.l_per_100km} invert /> },
          { l: 'Cost', v: `${fmt.int(s.cost)} ${cur}`, d: <Delta v={d.delta.cost} invert /> },
          { l: 'Score', v: <span style={{ color: scoreColor(s.scores.global) }}>{s.scores.global ?? '–'}</span>, d: <Delta v={d.score_delta} /> },
          { l: 'Harsh / 100 km', v: fmt.n1(s.harsh_per_100km), d: <Delta v={d.delta.harsh_per_100km} invert /> },
        ].map((k) => (
          <div key={k.l} className="panel px-4 py-3"><div className="eyebrow">{k.l}</div><div className="num-lg mt-1">{k.v}</div><div className="mt-0.5">{k.d}</div></div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Kilometres and harsh events by day" className="lg:col-span-2">
          <Chart className="h-56 w-full" option={{
            grid: { left: 40, right: 40, top: 18, bottom: 28 },
            xAxis: { type: 'category', data: d.days.map((x) => fmt.dateLong(x.date).slice(0, 3)), ...axisStyle, splitLine: { show: false } },
            yAxis: [{ type: 'value', name: 'km', ...axisStyle }, { type: 'value', name: 'harsh', ...axisStyle, splitLine: { show: false } }],
            tooltip: { trigger: 'axis' },
            series: [
              { name: 'km', type: 'bar', data: d.days.map((x) => x.km), barMaxWidth: 34, itemStyle: { color: '#3b82f6', borderRadius: [5, 5, 0, 0] } },
              { name: 'harsh', type: 'line', yAxisIndex: 1, data: d.days.map((x) => x.harsh), symbol: 'circle', lineStyle: { color: COLORS.brake, width: 2 }, itemStyle: { color: COLORS.brake } },
            ],
          }} />
        </Panel>
        <Panel title="Best and roughest trip">
          {[{ t: d.best_trip, l: 'best' }, { t: d.worst_trip, l: 'roughest' }].map(({ t, l }) => t ? (
            <Link key={l} to={`/trips/${t.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/5">
              <span className="num-lg !text-xl w-9 text-right" style={{ color: scoreColor(t.scores.global) }}>{t.scores.global}</span>
              <div className="min-w-0 flex-1"><div className="truncate">{fmt.dateLong(t.start_ts)} <span className="small">{fmt.time(t.start_ts)}</span></div><div className="small">{fmt.n1(t.km)} km · {t.events.harsh_brake + t.events.harsh_accel} harsh · {fmt.n2(t.l_per_100km)} l/100km</div></div>
              <span className="small">{l}</span>
            </Link>
          ) : null)}
        </Panel>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Panel title="Routes this week">
          <div className="grid gap-1.5">
            {d.journeys.map((j) => (
              <div key={`${j.from}-${j.to}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                <span className="num-lg !text-xl w-8 text-right">{j.trips_this_week}</span>
                <div className="min-w-0 flex-1"><div className="truncate">{j.from_label} → {j.to_label}</div><div className="small">{j.duration_median_min} min typical · {fmt.n2(j.l_per_100km_median)} l/100km</div></div>
                {j.is_commute && <Link className="btn" to={`/commute/${j.from}/${j.to}`}>Coach</Link>}
              </div>
            ))}
            {d.journeys.length === 0 && <div className="small">No repeated routes this week.</div>}
          </div>
        </Panel>
        <Panel title="Hotspots this week">
          <div className="grid gap-1.5">
            {d.hotspots.map((h) => (
              <Link key={`${h.lat}${h.lon}`} to={`/map?from=${d.week.start}&to=${d.week.end}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-white/5">
                <span className="num-lg !text-xl w-8 text-right" style={{ color: h.harsh_brake >= h.harsh_accel ? COLORS.brake : COLORS.accel }}>{h.count}</span>
                <div className="min-w-0 flex-1"><div className="capitalize truncate">{h.label}</div><div className="small">{h.harsh_brake} brake · {h.harsh_accel} accel · {h.trips.length} trips</div></div>
              </Link>
            ))}
            {d.hotspots.length === 0 && <div className="small">No repeated harsh spots this week.</div>}
          </div>
        </Panel>
        <Panel title="Over the limit this week">
          <div className="grid gap-1.5">
            {d.streets.map((s) => (
              <Link key={s.id} to={`/map?from=${d.week.start}&to=${d.week.end}&streets=1`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-white/5">
                <span className="num-lg !text-xl w-12 text-right" style={{ color: COLORS.accel }}>{fmt.n1(s.km_over)}</span>
                <div className="min-w-0 flex-1"><div className="truncate">km over, {s.trips} trip{s.trips > 1 ? 's' : ''}</div><div className="small">about {fmt.int(s.speed_avg)} km/h, up to {fmt.int(s.speed_max)}{s.highway ? ' · highway' : ''}</div></div>
              </Link>
            ))}
            {d.streets.length === 0 && <div className="small">Nothing flagged this week.</div>}
          </div>
        </Panel>
      </div>
    </div>
  )
}
