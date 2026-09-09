export const fmt = {
  int: (v: number | null | undefined) => (v == null ? '–' : Math.round(v).toLocaleString('en-GB')),
  n1: (v: number | null | undefined) => (v == null ? '–' : v.toLocaleString('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 })),
  n2: (v: number | null | undefined) => (v == null ? '–' : v.toLocaleString('en-GB', { maximumFractionDigits: 2, minimumFractionDigits: 2 })),
  pct: (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`),
  dur: (s: number | null | undefined) => {
    if (s == null) return '–'
    const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60)
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`
  },
  date: (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
  dateLong: (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
  time: (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  money: (v: number | null | undefined, cur = '') => (v == null ? '–' : `${v.toLocaleString('en-GB', { maximumFractionDigits: 0 })} ${cur}`),
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return '#56626f'
  if (score >= 85) return '#2ee6b7'
  if (score >= 75) return '#9be15d'
  if (score >= 65) return '#ffb224'
  return '#ff5a36'
}

export function isoWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}
