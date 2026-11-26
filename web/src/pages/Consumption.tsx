import { useMemo, useState } from 'react'
import { api } from '../api/client'
import type { ConsumptionBucket, MonthConsumption, SeasonId } from '../api/types'
import { Chart, axisStyle } from '../components/Chart'
import { Panel } from '../components/Panel'
import { MONTHS, fmt } from '../lib/format'
import { useApi } from '../lib/useApi'
import { COLORS } from '../map/terrain'

const SEASON_COLOR: Record<SeasonId | 'warm' | 'cold', string> = {
  summer: '#ffb224',
  autumn: '#c9b48a',
  winter: '#3b82f6',
  spring: '#2ee6b7',
  warm: '#ffb224',
  cold: '#3b82f6',
}

type PeriodOption = {
  key: string
  label: string
  sublabel: string
  bucket: ConsumptionBucket
  color: string
}

function monthLabel(ym: string, year: number, month: number): string {
  return `${MONTHS[month - 1] ?? ym} ${year}`
}

function DeltaCell({ a, b, unit = '', invert = false, decimals = 2 }: {
  a: number | null
  b: number | null
  unit?: string
  invert?: boolean
  decimals?: 1 | 2 | 0
}) {
  if (a == null || b == null) return <span className="small">–</span>
  const diff = b - a
  if (Math.abs(diff) < 0.005) return <span className="small">0</span>
  const good = invert ? diff < 0 : diff > 0
  const color = good ? COLORS.ev : COLORS.brake
  const formatted = decimals === 0 ? fmt.int(Math.abs(diff)) : decimals === 1 ? fmt.n1(Math.abs(diff)) : fmt.n2(Math.abs(diff))
  const pct = a !== 0 ? ((diff / a) * 100) : null
  return (
    <span className="num text-sm" style={{ color }}>
      {diff > 0 ? '+' : '-'}{formatted}{unit ? ` ${unit}` : ''}
      {pct != null && Math.abs(pct) >= 0.5 && <span className="small ml-1">({diff > 0 ? '+' : ''}{pct.toFixed(1)}%)</span>}
    </span>
  )
}

export function Consumption() {
  const { data: c } = useApi('consumption', () => api.consumption())
  const { data: settings } = useApi('settings', () => api.settings())
  const cur = settings?.currency ?? ''

  const options = useMemo<PeriodOption[]>(() => {
    if (!c) return []
    const out: PeriodOption[] = [
      ...c.seasons.map((s) => ({
        key: `season:${s.id}`,
        label: s.label,
        sublabel: s.months_label,
        bucket: s,
        color: SEASON_COLOR[s.id],
      })),
      {
        key: 'half:warm',
        label: c.halves.warm.label,
        sublabel: c.halves.warm.months_label,
        bucket: c.halves.warm,
        color: SEASON_COLOR.warm,
      },
      {
        key: 'half:cold',
        label: c.halves.cold.label,
        sublabel: c.halves.cold.months_label,
        bucket: c.halves.cold,
        color: SEASON_COLOR.cold,
      },
      ...c.monthly.map((m: MonthConsumption) => ({
        key: `month:${m.ym}`,
        label: monthLabel(m.ym, m.year, m.month),
        sublabel: m.season,
        bucket: m,
        color: SEASON_COLOR[m.season],
      })),
    ]
    return out
  }, [c])

  const winterHasTrips = (c?.seasons.find((s) => s.id === 'winter')?.trips ?? 0) > 0
  const hasHalves = (c?.halves.warm.trips ?? 0) > 0 && (c?.halves.cold.trips ?? 0) > 0
  const [pickedLeft, setPickedLeft] = useState<string | null>(null)
  const [pickedRight, setPickedRight] = useState<string | null>(null)

  const leftKey = pickedLeft ?? (winterHasTrips ? 'season:summer' : hasHalves ? 'half:warm' : 'season:summer')
  const rightKey = pickedRight ?? (winterHasTrips ? 'season:winter' : hasHalves ? 'half:cold' : 'season:winter')

  const left = options.find((o) => o.key === leftKey) ?? options[0]
  const right = options.find((o) => o.key === rightKey) ?? options[1] ?? options[0]
  const summer = c?.seasons.find((s) => s.id === 'summer')

  if (!c) return <div className="small p-6">Loading…</div>

  const applyPreset = (a: string, b: string) => {
    setPickedLeft(a)
    setPickedRight(b)
  }

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="display">Seasonal consumption</h1>
        <p className="small mt-1">
          Fuel economy and EV share across summer, winter, and every month from your trip telemetry.
        </p>
      </div>

      {/* Four meteorological seasons */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {c.seasons.map((s) => {
          const color = SEASON_COLOR[s.id]
          const vsSummer = s.id !== 'summer' && summer?.l_per_100km != null && s.l_per_100km != null
            ? s.l_per_100km - summer.l_per_100km
            : null
          return (
            <div key={s.id} className="panel px-4 py-3 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="eyebrow" style={{ color }}>{s.label}</span>
                <span className="chip">{s.months_label}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                {s.l_per_100km == null
                  ? <span className="num-lg text-faint">–</span>
                  : <span className="num-lg">{fmt.n2(s.l_per_100km)}</span>}
                <span className="small">l/100km</span>
              </div>
              <div className="small mt-1">
                {s.trips > 0
                  ? `${fmt.int(s.km)} km · ${s.trips} trips · ${fmt.pct(s.ev_share_km)} EV`
                  : 'No trips recorded yet'}
              </div>
              {vsSummer != null && (
                <div className="small mt-1" style={{ color: vsSummer <= 0 ? COLORS.ev : COLORS.brake }}>
                  {vsSummer > 0 ? '+' : ''}{fmt.n2(vsSummer)} vs Summer
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Head-to-head comparison */}
      <Panel
        title="Compare periods"
        right={
          <div className="flex flex-wrap gap-1.5">
            <button
              className={`btn ${leftKey === 'season:summer' && rightKey === 'season:winter' ? 'on' : ''}`}
              onClick={() => applyPreset('season:summer', 'season:winter')}
            >
              Summer vs Winter
            </button>
            <button
              className={`btn ${leftKey === 'half:warm' && rightKey === 'half:cold' ? 'on' : ''}`}
              onClick={() => applyPreset('half:warm', 'half:cold')}
            >
              Warm vs Cold
            </button>
            <button
              className={`btn ${leftKey === 'season:summer' && rightKey === 'season:autumn' ? 'on' : ''}`}
              onClick={() => applyPreset('season:summer', 'season:autumn')}
            >
              Summer vs Autumn
            </button>
          </div>
        }
      >
        <div className="grid md:grid-cols-[1fr_auto_1fr] gap-3 items-center mb-4">
          <select
            aria-label="First period"
            className="field !w-full !font-sans"
            value={leftKey}
            onChange={(e) => setPickedLeft(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>{o.label} ({o.sublabel}) · {o.bucket.trips} trips</option>
            ))}
          </select>
          <span className="eyebrow text-center">vs</span>
          <select
            aria-label="Second period"
            className="field !w-full !font-sans"
            value={rightKey}
            onChange={(e) => setPickedRight(e.target.value)}
          >
            {options.map((o) => (
              <option key={o.key} value={o.key}>{o.label} ({o.sublabel}) · {o.bucket.trips} trips</option>
            ))}
          </select>
        </div>

        {left && right && (
          <div className="overflow-x-auto">
            <table className="trips">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th style={{ color: left.color }}>{left.label}</th>
                  <th style={{ color: right.color }}>{right.label}</th>
                  <th>Difference ({right.label} vs {left.label})</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="small">Consumption</td>
                  <td className="num">{left.bucket.l_per_100km != null ? `${fmt.n2(left.bucket.l_per_100km)} l/100km` : '–'}</td>
                  <td className="num">{right.bucket.l_per_100km != null ? `${fmt.n2(right.bucket.l_per_100km)} l/100km` : '–'}</td>
                  <td><DeltaCell a={left.bucket.l_per_100km} b={right.bucket.l_per_100km} unit="l/100km" invert /></td>
                </tr>
                <tr>
                  <td className="small">Cost per 100 km</td>
                  <td className="num">{left.bucket.cost_per_100km != null ? `${fmt.n1(left.bucket.cost_per_100km)} ${cur}` : '–'}</td>
                  <td className="num">{right.bucket.cost_per_100km != null ? `${fmt.n1(right.bucket.cost_per_100km)} ${cur}` : '–'}</td>
                  <td><DeltaCell a={left.bucket.cost_per_100km} b={right.bucket.cost_per_100km} unit={cur} invert decimals={1} /></td>
                </tr>
                <tr>
                  <td className="small">EV share (% of km)</td>
                  <td className="num">{fmt.pct(left.bucket.ev_share_km)}</td>
                  <td className="num">{fmt.pct(right.bucket.ev_share_km)}</td>
                  <td>
                    <DeltaCell
                      a={left.bucket.ev_share_km != null ? left.bucket.ev_share_km * 100 : null}
                      b={right.bucket.ev_share_km != null ? right.bucket.ev_share_km * 100 : null}
                      unit="pp"
                      decimals={1}
                    />
                  </td>
                </tr>
                <tr>
                  <td className="small">Distance / trips</td>
                  <td className="num">{fmt.int(left.bucket.km)} km · {left.bucket.trips} trips</td>
                  <td className="num">{fmt.int(right.bucket.km)} km · {right.bucket.trips} trips</td>
                  <td className="num small">{fmt.n1(left.bucket.fuel_l)} l vs {fmt.n1(right.bucket.fuel_l)} l</td>
                </tr>
                <tr>
                  <td className="small">Average speed</td>
                  <td className="num">{left.bucket.avg_speed != null ? `${fmt.n1(left.bucket.avg_speed)} km/h` : '–'}</td>
                  <td className="num">{right.bucket.avg_speed != null ? `${fmt.n1(right.bucket.avg_speed)} km/h` : '–'}</td>
                  <td><DeltaCell a={left.bucket.avg_speed} b={right.bucket.avg_speed} unit="km/h" decimals={1} /></td>
                </tr>
                <tr>
                  <td className="small">Short trips (&lt; 5 km)</td>
                  <td className="num">{fmt.pct(left.bucket.short_trips_share)}</td>
                  <td className="num">{fmt.pct(right.bucket.short_trips_share)}</td>
                  <td className="small">cold-start share</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Monthly chart */}
      <Panel title="Monthly consumption and EV share">
        <Chart
          className="h-64 w-full"
          option={{
            grid: { left: 42, right: 42, top: 24, bottom: 28 },
            legend: { top: 0, right: 0, textStyle: { color: '#96a2b1' }, itemWidth: 10, itemHeight: 10 },
            xAxis: {
              type: 'category',
              data: c.monthly.map((m) => monthLabel(m.ym, m.year, m.month)),
              ...axisStyle,
              splitLine: { show: false },
            },
            yAxis: [
              { type: 'value', name: 'l/100km', ...axisStyle },
              { type: 'value', name: 'EV %', min: 0, max: 100, ...axisStyle, splitLine: { show: false } },
            ],
            tooltip: {
              trigger: 'axis',
              formatter: (ps: unknown) => {
                const arr = ps as { dataIndex: number }[]
                const m = c.monthly[arr[0]?.dataIndex ?? 0]
                if (!m) return ''
                return [
                  `<b>${monthLabel(m.ym, m.year, m.month)}</b> (${m.season})`,
                  `${fmt.n2(m.l_per_100km)} l/100km · ${fmt.n1(m.fuel_l)} l`,
                  `${fmt.int(m.km)} km · ${m.trips} trips`,
                  `EV share: ${fmt.pct(m.ev_share_km)}`,
                ].join('<br>')
              },
            },
            series: [
              {
                name: 'l/100km',
                type: 'bar',
                barMaxWidth: 36,
                data: c.monthly.map((m) => ({
                  value: m.l_per_100km,
                  itemStyle: { color: SEASON_COLOR[m.season], borderRadius: [5, 5, 0, 0] },
                })),
                markLine: c.overall.l_per_100km != null ? {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: 'rgba(255,255,255,0.22)', type: 'dashed' },
                  label: { color: '#96a2b1', formatter: `avg ${c.overall.l_per_100km.toFixed(2)}` },
                  data: [{ yAxis: c.overall.l_per_100km }],
                } : undefined,
              },
              {
                name: 'EV %',
                type: 'line',
                yAxisIndex: 1,
                smooth: 0.3,
                symbol: 'circle',
                symbolSize: 6,
                data: c.monthly.map((m) => m.ev_share_km != null ? Math.round(m.ev_share_km * 1000) / 10 : null),
                lineStyle: { color: COLORS.ev, width: 2 },
                itemStyle: { color: COLORS.ev },
              },
            ],
          }}
        />
      </Panel>

      {/* Monthly breakdown table */}
      <Panel title="Month by month">
        <div className="overflow-x-auto">
          <table className="trips">
            <thead>
              <tr>
                <th>Month</th>
                <th>Season</th>
                <th>Trips</th>
                <th>Distance</th>
                <th>Fuel</th>
                <th>l/100km</th>
                <th>Cost / 100 km</th>
                <th>EV share</th>
                <th>Avg speed</th>
                <th>Short &lt;5 km</th>
              </tr>
            </thead>
            <tbody>
              {[...c.monthly].reverse().map((m) => (
                <tr key={m.ym}>
                  <td className="font-medium">{monthLabel(m.ym, m.year, m.month)}</td>
                  <td><span className="chip capitalize" style={{ color: SEASON_COLOR[m.season] }}>{m.season}</span></td>
                  <td className="num">{m.trips}</td>
                  <td className="num">{fmt.n1(m.km)} km</td>
                  <td className="num">{fmt.n1(m.fuel_l)} l</td>
                  <td className="num font-medium">{fmt.n2(m.l_per_100km)}</td>
                  <td className="num">{m.cost_per_100km != null ? `${fmt.n1(m.cost_per_100km)} ${cur}` : '–'}</td>
                  <td className="num" style={{ color: COLORS.ev }}>{fmt.pct(m.ev_share_km)}</td>
                  <td className="num">{m.avg_speed != null ? `${fmt.n1(m.avg_speed)} km/h` : '–'}</td>
                  <td className="num">{fmt.pct(m.short_trips_share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
