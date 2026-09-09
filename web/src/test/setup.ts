import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// jsdom has no canvas/WebGL: stub what MapLibre and ECharts touch at import time.
// A map stub that swallows every method call (jsdom has no WebGL).
const stub = () => new Proxy({}, { get: (_t, key) => (key === 'then' ? undefined : (..._a: unknown[]) => stub()) })
vi.mock('maplibre-gl', () => ({ Map: function () { return stub() }, Marker: function () { return stub() }, Popup: function () { return stub() }, NavigationControl: function () { return {} }, LngLatBounds: function () { return { extend: () => {}, isEmpty: () => true } }, setWorkerUrl: vi.fn() }))
vi.mock('echarts/core', () => ({ use: () => {}, init: () => ({ setOption: () => {}, resize: () => {}, dispose: () => {}, on: () => {}, off: () => {} }) }))
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: 'worker.js' }))
window.matchMedia = window.matchMedia ?? ((q: string) => ({ matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) as MediaQueryList)
class RO { observe() {} unobserve() {} disconnect() {} }
window.ResizeObserver = window.ResizeObserver ?? (RO as unknown as typeof ResizeObserver)
