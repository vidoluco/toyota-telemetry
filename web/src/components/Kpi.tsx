import { animate, motion, useMotionValue, useTransform } from 'motion/react'
import { useEffect } from 'react'

const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** A stat tile whose number springs from its previous value to the new one. */
export function Kpi({ label, value, unit, hint, tone, format }: {
  label: string; value: number | null | undefined; unit?: string; hint?: string; tone?: string
  format?: (v: number) => string
}) {
  const mv = useMotionValue(0)
  const text = useTransform(mv, (v) => (format ? format(v) : Math.round(v).toLocaleString('en-GB')))
  useEffect(() => {
    if (value == null) return
    if (reduced) { mv.set(value); return }
    const c = animate(mv, value, { type: 'spring', bounce: 0, duration: 0.9 })
    return () => c.stop()
  }, [value, mv])
  return (
    <div className="panel px-4 py-3 min-w-0">
      <div className="eyebrow truncate">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        {value == null ? <span className="num-lg text-faint">–</span> : <motion.span className="num-lg" style={{ color: tone }}>{text}</motion.span>}
        {unit && <span className="small">{unit}</span>}
      </div>
      {hint && <div className="small mt-0.5 truncate">{hint}</div>}
    </div>
  )
}
