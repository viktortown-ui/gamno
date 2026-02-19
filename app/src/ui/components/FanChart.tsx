import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

export interface FanChartProps {
  labels: string[]
  p10: number[]
  p50: number[]
  p90: number[]
}

export function FanChart({ labels, p10, p50, p90 }: FanChartProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!rootRef.current) return
    const chart = echarts.init(rootRef.current)

    chart.setOption({
      backgroundColor: 'transparent',
      grid: { left: 40, right: 20, top: 18, bottom: 24 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: labels, axisLabel: { color: '#a4b2ce' }, axisLine: { lineStyle: { color: '#5f6e91' } } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { color: '#a4b2ce' }, splitLine: { lineStyle: { color: 'rgba(148, 167, 203, 0.25)' } } },
      series: [
        {
          name: 'p10',
          type: 'line',
          data: p10,
          lineStyle: { opacity: 0 },
          symbol: 'none',
          stack: 'band',
        },
        {
          name: 'Диапазон p10–p90',
          type: 'line',
          data: p90.map((value, idx) => value - p10[idx]),
          stack: 'band',
          symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: { color: 'rgba(143, 107, 255, 0.28)' },
        },
        {
          name: 'p50',
          type: 'line',
          data: p50,
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: '#2ee9d2', width: 2 },
          itemStyle: { color: '#2ee9d2' },
        },
      ],
    })

    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
  }, [labels, p10, p50, p90])

  return <div className="fan-chart" ref={rootRef} />
}
