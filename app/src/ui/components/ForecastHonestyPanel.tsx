import type { BacktestSummary } from '../../core/forecast/backtest'
import { formatNumber } from '../format'

export function ForecastHonestyPanel({ backtest }: { backtest: BacktestSummary }) {
  const recent = backtest.rows.slice(-10).reverse()

  return (
    <article className="summary-card panel honesty-panel">
      <h2>Честность прогноза</h2>
      <p>Покрытие: <strong>{formatNumber(backtest.coverage)}%</strong></p>
      <p>MAE: <strong>{formatNumber(backtest.mae)}</strong> · RMSE: <strong>{formatNumber(backtest.rmse)}</strong></p>
      <p>Средняя ширина интервала: <strong>{formatNumber(backtest.averageIntervalWidth)}</strong></p>
      <table className="table honesty-table">
        <thead>
          <tr><th>Дата</th><th>p50</th><th>Факт</th><th>Внутри</th></tr>
        </thead>
        <tbody>
          {recent.map((row) => (
            <tr key={row.date}>
              <td>{row.date}</td>
              <td className="mono">{formatNumber(row.p50)}</td>
              <td className="mono">{formatNumber(row.actual)}</td>
              <td>{row.insideBand ? 'да' : 'нет'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  )
}
