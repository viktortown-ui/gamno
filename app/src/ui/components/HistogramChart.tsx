import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

export function HistogramChart({ data }: { data: Array<{ bucket: string; value: number }> }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!rootRef.current) return
    const chart = echarts.init(rootRef.current)
    chart.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: data.map((d) => d.bucket), axisLabel: { color: '#d6def4', rotate: 35 } },
      yAxis: { type: 'value', axisLabel: { color: '#d6def4' } },
      grid: { left: 36, right: 12, top: 20, bottom: 55 },
      series: [{ type: 'bar', data: data.map((d) => d.value), itemStyle: { color: '#7aa2ff' } }],
    })
    const resize = () => chart.resize()
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); chart.dispose() }
  }, [data])

  return <div ref={rootRef} style={{ width: '100%', height: 280 }} aria-label="Гистограмма P(collapse)" />
}
