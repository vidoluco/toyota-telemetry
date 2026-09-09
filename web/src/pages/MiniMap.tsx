import * as maplibregl from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import { STYLE_URLS, getBasemap } from '../map/basemap'

export function MiniMap({ lat, lon }: { lat: number; lon: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const map = new maplibregl.Map({ container: ref.current, style: STYLE_URLS[getBasemap()], center: [lon, lat], zoom: 14.5, interactive: false, attributionControl: false })
    const el = document.createElement('div')
    el.style.cssText = 'width:12px;height:12px;border-radius:50%;background:#2ee6b7;box-shadow:0 0 0 4px rgba(46,230,183,.25),0 0 18px #2ee6b7'
    new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map)
    return () => map.remove()
  }, [lat, lon])
  return <div ref={ref} className="w-full h-full" />
}
