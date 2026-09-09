import * as maplibregl from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

// MapLibre 6 resolves its worker relative to the bundle; Vite does not emit that file, so hand it the asset URL.
maplibregl.setWorkerUrl(workerUrl)

import { STYLE_URLS, getBasemap, palette, type Basemap } from './basemap'

export const STYLE_URL = STYLE_URLS.dark
export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
/** Fallback camera until the data says where this car actually drives. */
export const WORLD: maplibregl.CameraOptions = { center: [8, 47], zoom: 3.2, pitch: 0, bearing: 0 }

export function cameraForBbox(bbox: [number, number, number, number], pitch = 0, bearing = 0, zoom = 11): maplibregl.CameraOptions {
  return { center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2], zoom, pitch, bearing }
}

export let COLORS = palette(getBasemap())

/** Create a map with 3D terrain, hillshade and atmosphere. Resolves when the style is loaded. */
export function createTerrainMap(container: HTMLElement, camera: maplibregl.CameraOptions, exaggeration = 1.35, basemap: Basemap = getBasemap()): Promise<maplibregl.Map> {
  COLORS = palette(basemap)
  const light = basemap === 'light'
  const map = new maplibregl.Map({
    container, style: STYLE_URLS[basemap], ...camera, maxPitch: 85, attributionControl: { compact: true },
    hash: false, fadeDuration: 150, maxCanvasSize: [8192, 8192],
  })
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right')
  map.on('error', (e) => console.error('maplibre', e.error?.message ?? e))
  ;(window as unknown as { __telemetryMap?: maplibregl.Map }).__telemetryMap = map
  return new Promise((resolve) => {
    map.once('style.load', () => {
      map.addSource('dem', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Terrain: Mapzen / AWS Terrain Tiles' })
      map.addSource('dem-hs', { type: 'raster-dem', tiles: [DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 14 })
      // hillshade sits under labels: find the first symbol layer
      const firstSymbol = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id
      if (light) {
        map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem-hs', paint: { 'hillshade-exaggeration': 0.38, 'hillshade-shadow-color': '#2a3442', 'hillshade-highlight-color': '#e9edf1', 'hillshade-accent-color': '#5f7188' } }, firstSymbol)
        map.setSky({ 'sky-color': '#bcd7f5', 'horizon-color': '#e6eef7', 'fog-color': '#eef2f6', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.85, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0] })
      } else {
        // lift the dark style a notch: it was too dark to read under hillshade
        for (const l of map.getStyle().layers ?? []) {
          if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#161d27')
          if (l.type === 'fill' && /water/.test(l.id)) map.setPaintProperty(l.id, 'fill-color', '#1d2b3d')
          if (l.type === 'line' && /road|street|highway|motorway|primary|secondary|tertiary|minor|path/.test(l.id)) map.setPaintProperty(l.id, 'line-color', '#3a4657')
        }
        map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem-hs', paint: { 'hillshade-exaggeration': 0.3, 'hillshade-shadow-color': '#05080c', 'hillshade-highlight-color': '#55697f', 'hillshade-accent-color': '#1a2734' } }, firstSymbol)
        map.setSky({ 'sky-color': '#0b1220', 'horizon-color': '#1c2a3d', 'fog-color': '#0a0f18', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.85, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0] })
      }
      map.setTerrain({ source: 'dem', exaggeration })
      resolve(map)
    })
  })
}

export const routeColorEv = (): maplibregl.ExpressionSpecification => ['case', ['get', 'is_ev'], COLORS.ev, COLORS.ice]
export const routeColorSpeed = (): maplibregl.ExpressionSpecification => ['interpolate', ['linear'], ['coalesce', ['get', 'speed_est'], 0], 0, COLORS.speed[0], 40, COLORS.speed[1], 70, COLORS.speed[2], 100, COLORS.speed[3], 130, COLORS.speed[4]]
export const routeColorOverspeed = (): maplibregl.ExpressionSpecification => ['case', ['get', 'overspeed'], COLORS.brake, 'rgba(120,135,150,0.6)']

export function addRouteLayers(map: maplibregl.Map, sourceId: string, idPrefix: string, color: maplibregl.ExpressionSpecification, width = 2.2): void {
  map.addLayer({ id: `${idPrefix}-glow`, type: 'line', source: sourceId, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': width * 3, 'line-opacity': 0.12, 'line-blur': 3 } })
  map.addLayer({ id: `${idPrefix}-line`, type: 'line', source: sourceId, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, width * 0.7, 14, width, 17, width * 2.2], 'line-opacity': 0.92 } })
}

export const eventColor = (): maplibregl.ExpressionSpecification => ['match', ['get', 'type'], 'B', COLORS.brake, 'A', COLORS.accel, COLORS.constant]

export function addEventLayers(map: maplibregl.Map, sourceId: string, idPrefix: string): void {
  // Quiet by default: small dots, halo only once you are down at street level.
  map.addLayer({ id: `${idPrefix}-halo`, type: 'circle', source: sourceId, minzoom: 14.5, filter: ['!', ['get', 'good']], paint: { 'circle-color': eventColor(), 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14.5, 8, 17, 16], 'circle-opacity': 0.12, 'circle-blur': 0.9 } })
  map.addLayer({ id: `${idPrefix}-dot`, type: 'circle', source: sourceId, paint: {
    'circle-color': ['case', ['get', 'good'], COLORS.good, eventColor()],
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['case', ['get', 'good'], 1, 1.8], 13, ['case', ['get', 'good'], 2, 3.2], 17, ['case', ['get', 'good'], 3.5, 6]],
    'circle-opacity': ['interpolate', ['linear'], ['zoom'], 9, ['case', ['get', 'good'], 0.3, 0.55], 13, ['case', ['get', 'good'], 0.45, 0.85]],
    'circle-stroke-color': COLORS.stroke, 'circle-stroke-width': ['case', ['get', 'good'], 0, 0.8],
  } })
}

/** Approach a bounding box in stages so the camera never sits below terrain whose height is not loaded yet:
 *  wide and flat, then close and flat (camera still high), then pitch once the close tiles are in. */
export function approachBounds(map: maplibregl.Map, bounds: [[number, number], [number, number]], opts: { padding: number | maplibregl.PaddingOptions; maxZoom: number; pitch: number; bearing: number; animate: boolean }): void {
  map.fitBounds(bounds, { padding: opts.padding, duration: 0, maxZoom: Math.min(12.5, opts.maxZoom), pitch: 0 })
  onceIdleOrTimeout(map, 1500, () => {
    map.fitBounds(bounds, { padding: opts.padding, duration: 0, maxZoom: opts.maxZoom, pitch: 0 })
    // A jump, not an ease: when the camera got stuck under unloaded terrain, MapLibre stops emitting idle and an
    // animated pitch never recovers, while a jump with a new pitch and bearing re-evaluates the view and renders.
    onceIdleOrTimeout(map, 2500, () => map.jumpTo({ pitch: opts.pitch, bearing: opts.bearing }))
  })
}

function onceIdleOrTimeout(map: maplibregl.Map, ms: number, fn: () => void): void {
  let done = false
  const run = () => { if (done) return; done = true; map.off('idle', run); fn() }
  map.once('idle', run)
  setTimeout(run, ms)
}

/** Pitch the camera only once terrain tiles are in, otherwise a close camera can end up under a mountain. */
export function pitchWhenReady(map: maplibregl.Map, pitch: number, bearing: number, duration: number): void {
  const go = () => {
    map.jumpTo({ center: map.getCenter(), zoom: map.getZoom() })  // re-anchor the camera on the now-known ground height
    map.easeTo({ pitch, bearing, duration, essential: true })
  }
  if (map.loaded() && map.areTilesLoaded()) go()
  else map.once('idle', go)
}

/** Slowly rotate the camera around the current centre until the user touches the map. */
export function startOrbit(map: maplibregl.Map, degPerSec = 4): () => void {
  let raf = 0
  let last = performance.now()
  let stopped = false
  const step = (now: number) => {
    if (stopped) return
    const dt = (now - last) / 1000; last = now
    map.setBearing(map.getBearing() + degPerSec * dt)
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  const stop = () => { if (stopped) return; stopped = true; cancelAnimationFrame(raf); for (const ev of evs) map.off(ev, stop) }
  const evs = ['mousedown', 'wheel', 'touchstart', 'dragstart'] as const
  for (const ev of evs) map.on(ev, stop)
  return stop
}

function bearing(a: [number, number], b: [number, number]): number {
  const [lon1, lat1] = a.map((v) => (v * Math.PI) / 180) as [number, number]
  const [lon2, lat2] = b.map((v) => (v * Math.PI) / 180) as [number, number]
  const y = Math.sin(lon2 - lon1) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)
  return (Math.atan2(y, x) * 180) / Math.PI
}

function dist(a: [number, number], b: [number, number]): number {
  const dx = (b[0] - a[0]) * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180))
  const dy = b[1] - a[1]
  return Math.hypot(dx, dy) * 111_195
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180
  return a + d * t
}

/** Fly along a polyline at a constant ground speed, camera pitched and heading along the route. Returns a stop function. */
export function flyAlong(map: maplibregl.Map, coords: [number, number][], opts: { metersPerSec?: number; zoom?: number; pitch?: number; onProgress?: (frac: number) => void; onDone?: () => void } = {}): () => void {
  const { metersPerSec = 140, zoom = 14, pitch = 60 } = opts
  if (coords.length < 2) return () => {}
  const cum = [0]
  for (let i = 1; i < coords.length; i++) cum.push((cum[i - 1] ?? 0) + dist(coords[i - 1]!, coords[i]!))
  const total = cum[cum.length - 1] ?? 0
  let stopped = false
  let raf = 0
  let start = 0
  let heading = bearing(coords[0]!, coords[Math.min(5, coords.length - 1)]!)
  map.jumpTo({ center: coords[0], zoom, pitch, bearing: heading })
  const step = (now: number) => {
    if (stopped) return
    if (!start) start = now
    const d = Math.min(total, ((now - start) / 1000) * metersPerSec)
    let i = 1
    while (i < cum.length - 1 && (cum[i] ?? 0) < d) i++
    const a = coords[i - 1]!, b = coords[i]!
    const seg = (cum[i] ?? 0) - (cum[i - 1] ?? 0)
    const t = seg > 0 ? (d - (cum[i - 1] ?? 0)) / seg : 0
    const center: [number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    const look = coords[Math.min(i + 6, coords.length - 1)]!
    heading = lerpAngle(heading, bearing(center, look), 0.06)
    map.jumpTo({ center, bearing: heading, pitch, zoom })
    opts.onProgress?.(total ? d / total : 1)
    if (d >= total) { opts.onDone?.(); return }
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  const stop = () => { if (stopped) return; stopped = true; cancelAnimationFrame(raf); for (const ev of evs) map.off(ev, stop) }
  const evs = ['mousedown', 'wheel', 'touchstart'] as const
  for (const ev of evs) map.on(ev, stop)
  return stop
}
