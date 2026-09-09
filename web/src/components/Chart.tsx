import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, HeatmapChart, RadarChart, PieChart, ScatterChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, CalendarComponent, MarkPointComponent, MarkLineComponent, DataZoomComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsCoreOption } from 'echarts/core'

echarts.use([BarChart, LineChart, HeatmapChart, RadarChart, PieChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, CalendarComponent, MarkPointComponent, MarkLineComponent, DataZoomComponent, CanvasRenderer])

const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export const chartBase: EChartsCoreOption = {
  backgroundColor: 'transparent',
  textStyle: { fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif', color: '#96a2b1' },
  animationDuration: reduced ? 0 : 600,
  animationEasing: 'cubicOut',
  tooltip: {
    backgroundColor: 'rgba(16,21,28,0.88)', borderColor: 'rgba(255,255,255,0.1)', textStyle: { color: '#eef2f6', fontSize: 12 },
    extraCssText: 'backdrop-filter: blur(14px); border-radius: 10px; box-shadow: 0 10px 30px -10px rgba(0,0,0,.8)',
  },
}

export const axisStyle = {
  axisLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
  axisTick: { show: false },
  axisLabel: { color: '#7f8b99', fontSize: 11, fontFamily: 'ui-monospace, SF Mono, Menlo, monospace' },
  splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
}

export function Chart({ option, className, onClick }: { option: EChartsCoreOption; className?: string; onClick?: (params: unknown) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const inst = useRef<echarts.ECharts | null>(null)
  useEffect(() => {
    if (!ref.current) return
    inst.current = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    const ro = new ResizeObserver(() => inst.current?.resize())
    ro.observe(ref.current)
    return () => { ro.disconnect(); inst.current?.dispose(); inst.current = null }
  }, [])
  useEffect(() => {
    inst.current?.setOption({ ...chartBase, ...option }, { notMerge: true })
  }, [option])
  useEffect(() => {
    const c = inst.current
    if (!c || !onClick) return
    c.on('click', onClick)
    return () => { c.off('click', onClick) }
  }, [onClick])
  return <div ref={ref} className={className ?? 'h-64 w-full'} />
}
