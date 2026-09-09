import { useSearchParams } from 'react-router-dom'
import type { DateRange } from '../api/types'

/** Date range lives in the URL so every page shares it and links are stable. */
export function useRange(): [DateRange, (r: DateRange) => void] {
  const [sp, setSp] = useSearchParams()
  const range: DateRange = { from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined }
  const set = (r: DateRange) => {
    const next = new URLSearchParams(sp)
    r.from ? next.set('from', r.from) : next.delete('from')
    r.to ? next.set('to', r.to) : next.delete('to')
    setSp(next, { replace: true })
  }
  return [range, set]
}

export function rangeKey(r: DateRange): string { return `${r.from ?? ''}_${r.to ?? ''}` }
