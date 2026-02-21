import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { seedTestData } from '../core/storage/repo'
import { buildFrameSnapshot } from '../core/frame/frameEngine'
import { createWorldMapWorker, runWorldMapInWorker, type WorldMapWorkerMessage } from '../core/workers/worldMapClient'
import { WorldMapView } from '../ui/components/WorldMapView'
import type { WorldMapSnapshot } from '../core/worldMap/types'

const NEUTRAL_FRAME = buildFrameSnapshot({ nowTs: Date.UTC(2026, 0, 1) })

interface StartPageProps {
  onDone: () => Promise<void>
  hintsEnabled: boolean
  onHintsChange: (next: boolean) => void
}

export function StartPage({ onDone, hintsEnabled, onHintsChange }: StartPageProps) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [snapshot, setSnapshot] = useState<WorldMapSnapshot | null>(null)
  const [sceneTransition, setSceneTransition] = useState(false)
  const reducedMotion = useMemo(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches, [])

  useEffect(() => {
    const worker = createWorldMapWorker((message: WorldMapWorkerMessage) => {
      if (message.type === 'done') setSnapshot(message.result)
    })

    runWorldMapInWorker(worker, {
      frame: NEUTRAL_FRAME,
      seed: 12,
      viewport: { width: 1500, height: 860, padding: 24 },
    })

    return () => worker.terminate()
  }, [])

  const openWorld = () => {
    if (reducedMotion) {
      navigate('/world')
      return
    }
    setSceneTransition(true)
    window.setTimeout(() => navigate('/world'), 240)
  }

  return (
    <section className={`page start-page ${sceneTransition ? 'start-page--transitioning' : ''}`} aria-label="Стартовая сцена">
      <div className="start-hero" data-reduced-motion={reducedMotion ? 'true' : 'false'}>
        <article className="start-copy">
          <p className="start-kicker">World Cockpit</p>
          <h1>Сделайте ясный старт дня в живой карте мира</h1>
          <p className="start-promise">Одна сцена показывает состояние системы, риск и следующее действие без перегруза.</p>
          <div className="start-cta-row">
            <button type="button" className="start-primary" data-help-target="start-cta" onClick={() => navigate('/core')}>Сделать первый чек-ин</button>
            <button type="button" className="button-secondary" onClick={openWorld}>Открыть Мир</button>
            {import.meta.env.DEV ? (
              <button
                type="button"
                className="button-ghost"
                onClick={async () => {
                  await seedTestData(30, 42)
                  await onDone()
                }}
              >
                Учебные данные
              </button>
            ) : null}
          </div>
          <p className="start-trust">Локально • аудит решений • честная уверенность/дрейф.</p>
          <label className="start-hints-toggle" htmlFor="start-hints-toggle">
            <input id="start-hints-toggle" type="checkbox" checked={hintsEnabled} onChange={(event) => onHintsChange(event.currentTarget.checked)} />
            Показать подсказки
          </label>
          {hintsEnabled ? (
            <div className="start-hotspots" role="note" aria-label="Подсказки по интерфейсу">
              <p><strong>Навигация:</strong> «Мир» — карта, «Запуск» — входная сцена.</p>
              <p><strong>Первый шаг:</strong> нажмите «Сделать первый чек-ин».</p>
            </div>
          ) : null}
        </article>

        <div className="start-scene" aria-hidden="true">
          <div className="start-orb" />
          <div className="start-particles" />
          {snapshot ? <WorldMapView snapshot={snapshot} showNeighborLabels={false} /> : <p>Собираем сцену мира…</p>}
        </div>
      </div>

      <section className="start-how panel" aria-label="Как это работает">
        <h2>Как это работает</h2>
        {[
          ['frame', 'Кадр системы', 'FrameSnapshot собирает текущее состояние, чтобы решения были опорными и повторяемыми.'],
          ['tail', 'Хвостовой риск', 'ES/CVaR + failRate показывают цену редких провалов в горизонте действий.'],
          ['fair', 'Честность', 'Model Health, дрейф и Safe Mode объясняют, где модели можно доверять, а где нужен контроль.'],
        ].map(([key, title, body]) => (
          <article key={key} className="start-how-card">
            <h3>{title}</h3>
            <button type="button" className="button-ghost" onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}>
              Подробнее
            </button>
            {expanded[key] ? <p>{body}</p> : null}
          </article>
        ))}
      </section>

      <section className="start-first-minute panel" aria-label="Первые 60 секунд">
        <h2>Первые 60 секунд</h2>
        <ol>
          <li>Чек-ин</li>
          <li>Мир → планета</li>
          <li>Автопилот → действие → аудит</li>
        </ol>
      </section>
    </section>
  )
}
