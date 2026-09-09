import { useRange } from '../lib/range'

const presets: { label: string; days?: number }[] = [{ label: 'All' }, { label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }]

export function RangePicker() {
  const [range, setRange] = useRange()
  const today = new Date().toISOString().slice(0, 10)
  const pick = (days?: number) => {
    if (!days) return setRange({})
    const d = new Date(); d.setDate(d.getDate() - days)
    setRange({ from: d.toISOString().slice(0, 10), to: today })
  }
  const active = (days?: number) => {
    if (!days) return !range.from && !range.to
    const d = new Date(); d.setDate(d.getDate() - days)
    return range.from === d.toISOString().slice(0, 10)
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {presets.map((p) => (
        <button key={p.label} className="btn" aria-pressed={active(p.days)} onClick={() => pick(p.days)}>{p.label}</button>
      ))}
      <input type="date" className="field" value={range.from ?? ''} max={today} onChange={(e) => setRange({ ...range, from: e.target.value || undefined })} />
      <span className="small">to</span>
      <input type="date" className="field" value={range.to ?? ''} max={today} onChange={(e) => setRange({ ...range, to: e.target.value || undefined })} />
    </div>
  )
}
