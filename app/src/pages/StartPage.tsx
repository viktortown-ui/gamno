import { useEffect, useMemo, useRef, useState } from 'react'
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
  action: string
  path: string
  status: StepStatus
}

export function StartPage({ onDone, hintsEnabled, onHintsChange, uiPreset, worldLookPreset }: StartPageProps) {
  const navigate = useNavigate()
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const [isStepsOpen, setIsStepsOpen] = useState(false)
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null)
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
        body: 'Это главный экран: сцена и главные действия.',
        action: 'Перейти в Мир',
        path: '/world',
        status: 'active',
      },
      {
        id: 'planet',
        title: 'Выбери планету',
        body: 'Определи, где сейчас самый ценный ход.',
        action: 'Открыть Мир',
        path: '/world',
        status: hasCheckins ? 'done' : 'locked',
      },
      {
        id: 'action',
        title: 'Сделай лучший шаг',
        body: 'Система подскажет оптимальное действие.',
        action: 'Сделать шаг',
        path: '/world',
        status: hasCheckins ? 'active' : 'locked',
      },
      {
        id: 'checkin',
        title: 'Проведи чек-ин',
        body: 'Зафиксируй результат и закрепи динамику.',
        action: hasCheckins ? 'Обновить чек-ин' : 'Первый чек-ин',
        path: '/core',
        status: hasCheckins ? 'done' : 'active',
      },
    ]
  }, [checkinsCount])

  const activeIndex = steps.findIndex((step) => step.status === 'active')
  const defaultExpandedStepId = steps[activeIndex >= 0 ? activeIndex : 0]?.id ?? null

  useEffect(() => {
    if (!isStepsOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsStepsOpen(false)
      }
    }

    const onPointerDown = (event: PointerEvent) => {
      if (!sheetRef.current) return
      if (!sheetRef.current.contains(event.target as Node)) {
        setIsStepsOpen(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [isStepsOpen])

  return (
    <section className="page start-page" aria-label="Первый запуск">
      <section className="start-hero">
        <HeroBackground uiPreset={uiPreset} worldLookPreset={worldLookPreset} />
        <article className="start-copy">
          <p className="start-kicker">ПЕРВЫЙ ЗАПУСК</p>
          <h1>Быстрый старт: включи Мир в рабочий ритм</h1>
          <p className="start-promise">Статус, обучение и прямой путь к действию — без лишних шагов.</p>
          <div className="start-cta-row">
            <button type="button" className="start-primary" onClick={() => navigate('/world')}>Открыть Мир</button>
            <button type="button" className="button-secondary" onClick={() => navigate('/core')}>Первый чек-ин</button>
            <button
              type="button"
              className="button-ghost"
              onClick={() => {
                setIsStepsOpen(true)
                setExpandedStepId(defaultExpandedStepId)
              }}
            >
              Как начать (4 шага)
            </button>
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
              <p><strong>Где я?</strong> На экране «Мир» видны режим, риск и доверие.</p>
              <p><strong>Что дальше?</strong> Нажми «Лучший шаг» в центре сцены.</p>
            </div>
          ) : null}
          <section className="start-benefits" aria-label="Что ты получишь">
            <h2>Что ты получишь</h2>
            <div className="start-benefits-grid">
              <article className="start-benefit-card"><h3>Щит</h3><p>Снижай риск до того, как он ударит.</p></article>
              <article className="start-benefit-card"><h3>Прогноз</h3><p>Понимай, какой шаг даст лучший результат.</p></article>
              <article className="start-benefit-card"><h3>История</h3><p>Следи за динамикой и закрепляй удачные решения.</p></article>
            </div>
          </section>
        </article>
      </section>

      {isStepsOpen ? (
        <div className="start-steps-overlay" aria-hidden="true">
          <aside className="start-steps-sheet panel" ref={sheetRef} aria-label="Как начать: 4 шага" role="dialog" aria-modal="true">
            <div className="start-steps-sheet__head">
              <h2>Как начать: 4 шага</h2>
              <button type="button" className="button-ghost" onClick={() => setIsStepsOpen(false)} aria-label="Закрыть">✕</button>
            </div>
            <div className="start-stepper" aria-label="Шаги старта">
              {steps.map((step, index) => {
                const open = expandedStepId === step.id
                return (
                  <article key={step.id} className={`start-step start-step--${step.status} ${open ? 'start-step--open' : 'start-step--compact'}`}>
                    <button type="button" className="start-step__toggle" onClick={() => setExpandedStepId(step.id)} aria-expanded={open}>
                      <span className="start-step__index">Шаг {index + 1}</span>
                      <h3>{step.title}</h3>
                      <span className="start-step__status">{step.status === 'done' ? 'Готово' : step.status === 'active' ? 'Следующий' : 'Позже'}</span>
                    </button>
                    {open ? (
                      <div className="start-step__details-wrap">
                        <p className="start-step__summary">{step.body}</p>
                        <button type="button" className={step.status === 'active' ? 'start-primary' : 'button-secondary'} onClick={() => navigate(step.path)} disabled={step.status === 'locked'}>
                          {step.action}
                        </button>
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  )
}
