import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { Trip } from '../api/types'
import { Panel } from '../components/Panel'
import { fmt, scoreColor } from '../lib/format'
import { rangeKey, useRange } from '../lib/range'
import { useApi } from '../lib/useApi'

type Col = { key: string; label: string; get: (t: Trip) => number | string | null; render?: (t: Trip) => React.ReactNode; align?: 'right' }

const cols: Col[] = [
  { key: 'date', label: 'Start', get: (t) => t.start_ts, render: (t) => <span>{fmt.dateLong(t.start_ts)} <span className="small">{fmt.time(t.start_ts)}</span>{t.night && <span className="chip ml-2">night</span>}</span> },
  { key: 'km', label: 'km', get: (t) => t.km, render: (t) => <span className="num">{fmt.n1(t.km)}</span>, align: 'right' },
  { key: 'dur', label: 'Time', get: (t) => t.duration_s, render: (t) => <span className="num">{fmt.dur(t.duration_s)}</span>, align: 'right' },
  { key: 'l100', label: 'l/100km', get: (t) => t.l_per_100km, render: (t) => <span className="num">{fmt.n2(t.l_per_100km)}</span>, align: 'right' },
  { key: 'ev', label: 'EV', get: (t) => t.ev_share, render: (t) => <span className="inline-flex items-center gap-2"><span className="num w-9 text-right">{fmt.pct(t.ev_share)}</span><span className="inline-block h-1.5 w-16 rounded bg-white/10 overflow-hidden"><span className="block h-full bg-ev" style={{ width: `${t.ev_share * 100}%` }} /></span></span>, align: 'right' },
  { key: 'avg', label: 'avg km/h', get: (t) => t.avg_speed, render: (t) => <span className="num">{fmt.int(t.avg_speed)}</span>, align: 'right' },
  { key: 'score', label: 'Score', get: (t) => t.scores.global, render: (t) => <span className="num font-semibold" style={{ color: scoreColor(t.scores.global) }}>{t.scores.global ?? '–'}</span>, align: 'right' },
  { key: 'hb', label: 'Harsh brake', get: (t) => t.events.harsh_brake, render: (t) => <Dots n={t.events.harsh_brake} color="#ff5a36" />, align: 'right' },
  { key: 'ha', label: 'Harsh accel', get: (t) => t.events.harsh_accel, render: (t) => <Dots n={t.events.harsh_accel} color="#ffb224" />, align: 'right' },
  { key: 'climb', label: 'Climb', get: (t) => t.climb_m, render: (t) => <span className="num">{fmt.int(t.climb_m)} m</span>, align: 'right' },
  { key: 'cost', label: 'Cost', get: (t) => t.cost, render: (t) => <span className="num">{fmt.n1(t.cost)}</span>, align: 'right' },
]

function Dots({ n, color }: { n: number; color: string }) {
  if (!n) return <span className="text-faint num">0</span>
  return <span className="inline-flex items-center gap-1.5 justify-end"><span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} /><span className="num font-semibold" style={{ color }}>{n}</span></span>
}

export function Trips() {
  const [range] = useRange()
  const { data, loading } = useApi(`trips_${rangeKey(range)}`, () => api.trips(range))
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'date', dir: -1 })
  const nav = useNavigate()
  const rows = useMemo(() => {
    const col = cols.find((c) => c.key === sort.key) ?? cols[0]!
    return [...(data ?? [])].sort((a, b) => { const x = col.get(a), y = col.get(b); if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * sort.dir })
  }, [data, sort])
  return (
    <Panel title={`${rows.length} trips`} className="!p-0">
      <div>
        <table className="trips">
          <thead><tr>{cols.map((c) => (
            <th key={c.key} className={c.align === 'right' ? 'text-right' : ''} onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : -1 }))}>
              {c.label}{sort.key === c.key && <span className="ml-1 text-ev">{sort.dir === 1 ? '↑' : '↓'}</span>}
            </th>))}</tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="row" onClick={() => nav(`/trips/${t.id}`)}>
                {cols.map((c) => <td key={c.key} className={c.align === 'right' ? 'text-right' : ''}>{c.render ? c.render(t) : String(c.get(t) ?? '–')}</td>)}
              </tr>
            ))}
            {!loading && rows.length === 0 && <tr><td colSpan={cols.length} className="small py-8 text-center">No trips in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
