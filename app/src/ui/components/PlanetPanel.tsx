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
  costRu: string
}

interface PlanetPanelProps {
  planet: WorldMapPlanet
  levers: PlanetLever[]
  whyBullets: string[]
  debtProtocol: string[]
  onClose: () => void
  onApplyLever?: (lever: PlanetLever) => void
}

function pct(value: number): string {
  return `${(Math.max(0, value) * 100).toFixed(1)}%`
}

export function PlanetPanel({ planet, levers, whyBullets, debtProtocol, onClose, onApplyLever }: PlanetPanelProps) {
  const topLever = levers[0]
  const stormRows = levers.slice(0, 2)
  const p10 = stormRows.map((lever) => Math.max(0, lever.p50 - Math.abs(lever.p90 - lever.p50) * 0.75) * 100)
  const p50 = stormRows.map((lever) => lever.p50 * 100)
  const p90 = stormRows.map((lever) => lever.p90 * 100)

  const mainThreatRu = planet.metrics.safeMode
    ? 'Безопасный режим активен: аварийная стабилизация.'
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
        <span className="chip">уровень {planet.metrics.level}</span>
        <span className="chip">{planet.metrics.safeMode ? 'безопасный режим' : `сирена:${planet.metrics.sirenLevel}`}</span>
        <span className="chip">риск срыва {pct(planet.metrics.failProbability)}</span>
      </div>

      <section>
        <h4>Сводка</h4>
        <p>{mainThreatRu}</p>
        <p>Главный рычаг: <strong>{topLever?.titleRu ?? 'нет данных'}</strong>.</p>
      </section>

      <section>
        <h4>Топ-действия</h4>
        <ul className="planet-panel__levers">
          {levers.slice(0, 3).map((lever) => (
            <li key={lever.actionId}>
              <div className="planet-panel__lever-copy">
                <strong>{lever.titleRu}</strong>
                <div className="planet-panel__lever-metrics mono">{lever.costRu} · ES97.5 {pct(lever.es97_5)} · срыв {pct(lever.failRate)}</div>
              </div>
              <button type="button" className="start-primary" onClick={() => onApplyLever?.(lever)}>{lever.ctaRu}</button>
            </li>
          ))}
        </ul>
      </section>

      {topLever ? (
        <section>
          <button type="button" className="start-primary" onClick={() => onApplyLever?.(topLever)}>Сделать: {topLever.titleRu}</button>
        </section>
      ) : null}

      <section>
        <h4>Почему</h4>
        <ul>
          {(whyBullets.length ? whyBullets : ['Нет объяснения.']).slice(0, 2).map((line, index) => <li key={`why-${index}`}>{line}</li>)}
        </ul>
      </section>

      {stormRows.length ? (
        <section>
          <h4>Хвостовой риск</h4>
          <FanChart labels={stormRows.map((item) => `${item.titleRu} (H3/H7)`)} p10={p10} p50={p50} p90={p90} />
        </section>
      ) : null}

      <section>
        <h4>Давление / долги</h4>
        {debtProtocol.length ? <ul>{debtProtocol.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul> : <p>Активных долгов не найдено.</p>}
      </section>
    </aside>
  )
}
