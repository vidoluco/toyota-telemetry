export type Basemap = 'light' | 'dark'

const KEY = 'toyota_telemetry.basemap'

export function getBasemap(): Basemap {
  try { return (localStorage.getItem(KEY) as Basemap) === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}

export function setBasemap(b: Basemap): void {
  try { localStorage.setItem(KEY, b) } catch { /* private mode */ }
}

export const STYLE_URLS: Record<Basemap, string> = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

/** Colours that read on each basemap. Semantics stay the same: EV teal, engine amber, brake red, accel orange. */
export function palette(b: Basemap) {
  return b === 'light'
    ? { brake: '#e11d48', accel: '#ea8a00', ev: '#0f9f7a', ice: '#7c5c2b', good: '#8a94a3', constant: '#2563eb', selected: '#111827', stroke: '#ffffff',
        speed: ['#2563eb', '#0f9f7a', '#ca8a04', '#ea580c', '#dc2626'] as const }
    : { brake: '#ff5a36', accel: '#ffb224', ev: '#2ee6b7', ice: '#d8c39a', good: '#8b98a8', constant: '#7cc7ff', selected: '#ffffff', stroke: '#07090d',
        speed: ['#3b82f6', '#2ee6b7', '#ffe14d', '#ff8a3d', '#ff5a36'] as const }
}
