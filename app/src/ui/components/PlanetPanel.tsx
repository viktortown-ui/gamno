import type { WorldMapPlanet } from '../../core/worldMap/types'
import { FanChart } from './FanChart'

export interface PlanetLever {
  actionId: string
  titleRu: string
  p50: number
  p90: number
  es97_5: number
  failRate: number
  ctaRu: 'Сделать' | 'Собрать миссию'
}

interface PlanetPanelProps {
  planet: WorldMapPlanet
  levers: PlanetLever[]
  whyBullets: string[]
  debtProtocol: string[]
  onClose: () => void
}

function pct(value: number): string {
  return `${(Math.max(0, value) * 100).toFixed(1)}%`
}

export function PlanetPanel({ planet, levers, whyBullets, debtProtocol, onClose }: PlanetPanelProps) {
  const topLever = levers[0]
  const stormRows = levers.slice(0, 2)
  const p10 = stormRows.map((lever) => Math.max(0, lever.p50 - Math.abs(lever.p90 - lever.p50) * 0.75) * 100)
  const p50 = stormRows.map((lever) => lever.p50 * 100)
  const p90 = stormRows.map((lever) => lever.p90 * 100)

  const mainThreatRu = planet.metrics.safeMode
    ? 'Safe Mode активен: режим аварийной стабилизации.'
    : planet.metrics.sirenLevel === 'red'
      ? 'Высокий сиренный риск: возможен срыв горизонта.'
      : planet.metrics.failProbability >= 0.25
        ? 'Вероятность провала выше целевого порога.'
        : 'Управляемая зона: угрозы пока под контролем.'

  return (
    <aside className="planet-panel panel" aria-label={`Планета ${planet.labelRu}`}>
      <header className="planet-panel__header">
        <h3>{planet.labelRu}</h3>
        <button type="button" className="planet-panel__close" onClick={onClose} aria-label="Закрыть панель">×</button>
      </header>

      <div className="planet-panel__chips">
        <span className="chip">lvl {planet.metrics.level}</span>
        <span className="chip">{planet.metrics.safeMode ? 'safeMode' : `siren:${planet.metrics.sirenLevel}`}</span>
        <span className="chip">budget {pct(planet.metrics.budgetPressure)}</span>
        <span className="chip">fail {pct(planet.metrics.failProbability)}</span>
      </div>

      <section>
        <h4>Брифинг</h4>
        <p>{mainThreatRu}</p>
        <p>Главный рычаг: <strong>{topLever?.titleRu ?? 'нет данных'}</strong>.</p>
        <ul>
          {whyBullets.slice(0, 3).map((line, index) => <li key={`why-${index}`}>{line}</li>)}
        </ul>
      </section>

      <section>
        <h4>Рычаги</h4>
        <ul className="planet-panel__levers">
          {levers.map((lever) => (
            <li key={lever.actionId}>
              <div>
                <strong>{lever.titleRu}</strong>
                <div className="mono">p50 {pct(lever.p50)} · p90 {pct(lever.p90)} · ES97.5 {pct(lever.es97_5)} · fail {pct(lever.failRate)}</div>
              </div>
              <button type="button">{lever.ctaRu}</button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h4>Storm</h4>
        <FanChart labels={stormRows.map((item) => `${item.titleRu} (H3/H7)`)} p10={p10} p50={p50} p90={p90} />
        {stormRows.map((row) => (
          <p key={`storm-${row.actionId}`} className="mono">{row.titleRu}: ES {pct(row.es97_5)} · VaR {pct(row.p90)} · fail {pct(row.failRate)}</p>
        ))}
      </section>

      <section>
        <h4>Pressure / Debts</h4>
        <p>Бюджетное давление: {pct(planet.metrics.budgetPressure)}. Чем выше, тем строже лимиты по энергии/времени.</p>
        {debtProtocol.length ? <ul>{debtProtocol.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul> : <p>Активных долгов не найдено.</p>}
      </section>

      <nav className="planet-panel__links" aria-label="Быстрые ссылки">
        <a href="#/autopilot">Автопилот</a>
        <a href="#/system">Система</a>
        <a href="#/history">Аудит</a>
      </nav>
    </aside>
  )
}
