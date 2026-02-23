import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listCheckins, seedTestData } from '../core/storage/repo'
import { HeroBackground } from '../ui/components/HeroBackground'
import type { UiPreset } from '../ui/appearance'

interface StartPageProps {
  onDone: () => Promise<void>
  hintsEnabled: boolean
  onHintsChange: (next: boolean) => void
  uiPreset: UiPreset
  worldLookPreset: string
}

type StepStatus = 'done' | 'active' | 'locked'

interface MissionStep {
  id: string
  title: string
  body: string
  details: string
  action: string
  path: string
  status: StepStatus
}

export function StartPage({ onDone, hintsEnabled, onHintsChange, uiPreset, worldLookPreset }: StartPageProps) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [checkinsCount, setCheckinsCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    listCheckins().then((rows) => {
      if (!cancelled) setCheckinsCount(rows.length)
    }).catch(() => {
      if (!cancelled) setCheckinsCount(0)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const steps = useMemo<MissionStep[]>(() => {
    const hasCheckins = checkinsCount > 0
    return [
      {
        id: 'world',
        title: 'Открой Мир',
        body: 'Это главный экран: сцена + действия.',
        details: 'На экране «Мир» видно общее состояние, уровень риска и доступные рычаги.',
        action: 'Перейти в Мир',
        path: '/world',
        status: 'active',
      },
      {
        id: 'planet',
        title: 'Выбери планету',
        body: 'Планета показывает угрозу и рычаги.',
        details: 'Открой карточку планеты и оцени, где сейчас самый полезный шаг.',
        action: 'Открыть Мир',
        path: '/world',
        status: hasCheckins ? 'done' : 'locked',
      },
      {
        id: 'action',
        title: 'Лучший шаг',
        body: 'Система предложит лучший шаг.',
        details: 'Используй подсказку в центре экрана, чтобы не тратить время на сомнения.',
        action: 'Сделать шаг',
        path: '/world',
        status: hasCheckins ? 'active' : 'locked',
      },
      {
        id: 'checkin',
        title: 'Чек-ин',
        body: 'Фиксируй прогресс и историю.',
        details: 'После первого чек-ина появится история динамики и более точные прогнозы.',
        action: hasCheckins ? 'Обновить чек-ин' : 'Первый чек-ин',
        path: '/core',
        status: hasCheckins ? 'done' : 'active',
      },
    ]
  }, [checkinsCount])

  return (
    <section className="page start-page" aria-label="Первый запуск">
      <section className="start-hero">
        <HeroBackground uiPreset={uiPreset} worldLookPreset={worldLookPreset} />
        <article className="start-copy">
          <p className="start-kicker">ПЕРВЫЙ ЗАПУСК</p>
          <h1>Короткий гид: как управлять Миром</h1>
          <p className="start-promise">Выбирай планеты, делай лучший ход и укрепляй щит.</p>
          <div className="start-cta-row">
            <button type="button" className="start-primary" onClick={() => navigate('/world')}>Открыть Мир</button>
            <button type="button" className="button-secondary" onClick={() => navigate('/core')}>Первый чек-ин</button>
            {import.meta.env.DEV ? (
              <button
                type="button"
                className="button-ghost"
                onClick={async () => {
                  await seedTestData(30, 42)
                  await onDone()
                  navigate('/world')
                }}
              >
                Учебные данные
              </button>
            ) : null}
          </div>
          <label className="start-hints-toggle" htmlFor="start-hints-toggle">
            <input id="start-hints-toggle" type="checkbox" checked={hintsEnabled} onChange={(event) => onHintsChange(event.currentTarget.checked)} />
            Показывать подсказки
          </label>
          {hintsEnabled ? (
            <div className="start-hotspots" role="note" aria-label="Подсказки по интерфейсу">
              <p><strong>Где я?</strong> В «Мире» видно режим, риск и доверие.</p>
              <p><strong>Что дальше?</strong> Нажми кнопку «Лучший шаг» на сцене.</p>
            </div>
          ) : null}
          <section className="start-benefits" aria-label="Что ты получишь">
            <h2>Что ты получишь</h2>
            <div className="start-benefits-grid">
              <article className="start-benefit-card"><h3>Щит</h3><p>Снижай риск до того, как он ударит.</p></article>
              <article className="start-benefit-card"><h3>Прогноз</h3><p>Понимай, какой шаг даст лучший результат.</p></article>
              <article className="start-benefit-card"><h3>История</h3><p>Видй динамику и закрепляй удачные решения.</p></article>
            </div>
          </section>
        </article>
      </section>

      <section className="start-mission panel" aria-label="Миссия быстрого старта">
        <h2>Миссия: 4 шага до рабочего ритма</h2>
        <div className="start-stepper">
          {steps.map((step, index) => (
            <article key={step.id} className={`start-step start-step--${step.status}`}>
              <div className="start-step__head">
                <p className="start-step__index">Шаг {index + 1}</p>
                <span className="start-step__status">{step.status === 'done' ? 'Готово' : step.status === 'active' ? 'В работе' : 'Закрыто'}</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              <div className="start-step__actions">
                <button type="button" className={step.status === 'active' ? 'start-primary' : 'button-secondary'} onClick={() => navigate(step.path)} disabled={step.status === 'locked'}>
                  {step.action}
                </button>
                <button type="button" className="button-ghost" onClick={() => setExpanded((prev) => ({ ...prev, [step.id]: !prev[step.id] }))}>Подробнее</button>
              </div>
              {expanded[step.id] ? <p className="start-step__details">{step.details}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}
