import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MetricControl } from '../components/MetricControl'
import { DEFAULT_CHECKIN_VALUES, METRICS, type MetricConfig, type MetricId } from '../core/metrics'
import type { CheckinRecord, CheckinValues } from '../core/models/checkin'
import type { QuestRecord } from '../core/models/quest'
import { addCheckin, addQuest, computeCurrentRegimeSnapshot, computeCurrentStateSnapshot, getLatestRegimeSnapshot, getLatestStateSnapshot, seedTestData } from '../core/storage/repo'
import { formatNumber } from '../ui/format'
import { buildCheckinResultInsight } from '../core/engines/engagement/suggestions'
import { createQuestFromSuggestion } from '../core/engines/engagement/quests'
import { defaultInfluenceMatrix } from '../core/engines/influence/influence'
import { explainCoreState, type CoreStateSnapshot } from '../core/engines/stateEngine'
import type { RegimeSnapshotRecord } from '../core/models/regime'
import { REGIMES } from '../core/regime/model'
import { assessCollapseRisk, buildDisarmProtocol } from '../core/collapse/model'
import { getLastBlackSwanRun } from '../repo/blackSwanRepo'

type SaveState = 'idle' | 'saving' | 'saved'

function clamp(metric: MetricConfig, value: number): number {
  return Math.min(metric.max, Math.max(metric.min, value))
}

function getValidationError(metric: MetricConfig, raw: string): string | undefined {
  if (raw.trim() === '') return 'Введите число.'
  const parsed = Number(raw)
  if (Number.isNaN(parsed)) return 'Введите корректное число.'
  if (parsed < metric.min || parsed > metric.max) {
    return `Диапазон: ${metric.min}…${metric.max}${metric.unitRu ? ` ${metric.unitRu}` : ''}.`
  }
  return undefined
}

function getRiskLabel(value: number): string {
  if (value >= 70) return 'высокий'
  if (value >= 40) return 'средний'
  return 'низкий'
}

function getVolatilityLabel(value: number): string {
  if (value >= 1.6) return 'высокая'
  if (value >= 0.8) return 'средняя'
  return 'низкая'
}

export function CorePage({
  onSaved,
  latest,
  previous,
  templateValues,
  activeQuest,
  onQuestChange,
  checkins,
  activeGoalSummary,
}: {
  onSaved: () => Promise<void>
  latest?: CheckinRecord
  previous?: CheckinRecord
  templateValues?: CheckinValues
  activeQuest?: QuestRecord
  onQuestChange: () => Promise<void>
  checkins: CheckinRecord[]
  activeGoalSummary?: { title: string; score: number; gap: number; trend: 'up' | 'down' | null } | null
}) {
  const navigate = useNavigate()
  const [values, setValues] = useState<CheckinValues>(templateValues ?? DEFAULT_CHECKIN_VALUES)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [savedRecord, setSavedRecord] = useState<CheckinRecord | null>(null)
  const [errors, setErrors] = useState<Partial<Record<MetricId, string>>>({})
  const [snapshot, setSnapshot] = useState<CoreStateSnapshot | null>(null)
  const [regimeSnapshot, setRegimeSnapshot] = useState<RegimeSnapshotRecord | null>(null)
  const [tailRiskSummary, setTailRiskSummary] = useState<{ pRed7d: number; esCollapse10: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [latestSnapshot, latestRegime, lastBlackSwan] = await Promise.all([getLatestStateSnapshot(), getLatestRegimeSnapshot(), getLastBlackSwanRun()])
      const current = latestSnapshot ?? await computeCurrentStateSnapshot()
      const currentRegime = latestRegime ?? await computeCurrentRegimeSnapshot()
      if (!cancelled) {
        setSnapshot(current)
        setRegimeSnapshot(currentRegime)
        setTailRiskSummary(lastBlackSwan ? { pRed7d: lastBlackSwan.summary.pRed7d, esCollapse10: lastBlackSwan.summary.esCollapse10 } : null)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [latest?.ts, activeQuest?.id, checkins.length])

  const updateValue = (id: MetricId, value: number) => {
    const metric = METRICS.find((item) => item.id === id)
    if (!metric) return
    setValues((prev) => ({ ...prev, [id]: clamp(metric, value) }))
  }

  const handleBlur = (metric: MetricConfig, raw: string) => {
    const error = getValidationError(metric, raw)
    setErrors((prev) => ({ ...prev, [metric.id]: error }))
    if (!error) {
      const parsed = Number(raw)
      setValues((prev) => ({ ...prev, [metric.id]: clamp(metric, parsed) }))
    }
  }

  const handleSave = async () => {
    setSaveState('saving')
    const saved = await addCheckin(values)
    setSavedRecord(saved)
    setSaveState('saved')
    await onSaved()
    const [nextSnapshot, nextRegime] = await Promise.all([computeCurrentStateSnapshot(), computeCurrentRegimeSnapshot()])
    setSnapshot(nextSnapshot)
    setRegimeSnapshot(nextRegime)
  }

  const resultInsight = useMemo(() => {
    if (!savedRecord) return null
    return buildCheckinResultInsight(savedRecord, latest, defaultInfluenceMatrix)
  }, [savedRecord, latest])

  const acceptAction = async () => {
    if (!resultInsight?.bestLever) return
    const quest = createQuestFromSuggestion(resultInsight.bestLever)
    await addQuest(quest)
    await onQuestChange()
    const [nextSnapshot, nextRegime] = await Promise.all([computeCurrentStateSnapshot(), computeCurrentRegimeSnapshot()])
    setSnapshot(nextSnapshot)
    setRegimeSnapshot(nextRegime)
  }

  const suggestedQuest = useMemo(() => {
    if (!latest) return null
    const insight = buildCheckinResultInsight(latest, previous, defaultInfluenceMatrix)
    return insight.bestLever ? createQuestFromSuggestion(insight.bestLever) : null
  }, [latest, previous])

  const oneNextAction = activeQuest
    ? {
      title: activeQuest.title,
      hint: `Ожидаемый рост индекса: +${formatNumber(activeQuest.predictedIndexLift)}.`,
      ctaLabel: 'Принять миссию',
      ctaPath: '/dashboard',
    }
    : {
      title: suggestedQuest?.title ?? 'Новый сценарий поможет выбрать самый сильный рычаг дня.',
      hint: suggestedQuest
        ? `Рекомендованный шаг: ${suggestedQuest.metricTarget} ${suggestedQuest.delta > 0 ? '+' : ''}${formatNumber(suggestedQuest.delta)}.`
        : 'Соберите свежий чек-ин и получите персональное предложение.',
      ctaLabel: 'Перейти к оракулу',
      ctaPath: '/oracle',
    }

  const contributors = useMemo(
    () => explainCoreState(latest, previous, activeQuest),
    [latest, previous, activeQuest],
  )

  const pulseScale = snapshot ? 1 + Math.min(0.35, snapshot.volatility / 8 + snapshot.risk / 600) : 1
  const glow = snapshot ? Math.max(0.2, Math.min(0.9, snapshot.index / 10)) : 0.25

  const regime = REGIMES.find((item) => item.id === regimeSnapshot?.regimeId) ?? REGIMES[0]
  const nextLikelyIndex = regimeSnapshot?.next1?.reduce((best, value, index) => (value > (regimeSnapshot.next1?.[best] ?? 0) ? index : best), 0) ?? 0
  const nextLikelyProb = regimeSnapshot?.next1?.[nextLikelyIndex] ?? 0
  const nextLikelyRegime = REGIMES[nextLikelyIndex]
  const collapse = snapshot ? assessCollapseRisk(snapshot, latest) : null
  const sirenActions = collapse ? buildDisarmProtocol(latest, collapse, activeQuest) : []
  const orbTone = regimeSnapshot?.regimeId === 4 ? 'rgba(255, 90, 130, 0.8)' : regimeSnapshot?.regimeId === 2 ? 'rgba(255, 183, 92, 0.8)' : 'rgba(46, 233, 210, 0.7)'

  return (
    <section className="page core-cockpit-page">
      <h1>Живое ядро</h1>

      <section className="panel core-cockpit-grid">
        <article className="core-orb-card">
          <h2>Core Orb</h2>
          <div className="core-orb-wrap" aria-label="Состояние ядра">
            <svg viewBox="0 0 240 240" className="core-orb" role="img">
              <defs>
                <radialGradient id="orbFill" cx="50%" cy="45%" r="55%">
                  <stop offset="0%" stopColor="rgba(143, 107, 255, 0.95)" />
                  <stop offset="60%" stopColor="rgba(86, 188, 255, 0.72)" />
                  <stop offset="100%" stopColor="rgba(21, 43, 95, 0.9)" />
                </radialGradient>
              </defs>
              <circle cx="120" cy="120" r="86" fill="url(#orbFill)" style={{ opacity: glow }} />
              <circle cx="120" cy="120" r="98" className="core-orb__halo" style={{ transform: `scale(${pulseScale})`, stroke: orbTone }} />
              <text x="50%" y="48%" textAnchor="middle" className="core-orb__value">{formatNumber(snapshot?.index ?? 0)}</text>
              <text x="50%" y="58%" textAnchor="middle" className="core-orb__label">Индекс ядра</text>
            </svg>
          </div>
          <p>Риск: <strong>{getRiskLabel(snapshot?.risk ?? 0)}</strong> · Волатильность: <strong>{getVolatilityLabel(snapshot?.volatility ?? 0)}</strong></p>
          <p>Режим: <strong>{regime.labelRu}</strong> · P: <strong>{((regimeSnapshot?.next1?.[regime.id] ?? 1) * 100).toFixed(1)}%</strong></p>
          <p>Следующий вероятный: <strong>{nextLikelyRegime.labelRu}</strong> · { (nextLikelyProb * 100).toFixed(1)}%</p>
          <div className="meter" aria-hidden="true"><div className="meter__fill" style={{ width: `${Math.round(nextLikelyProb * 100)}%`, background: orbTone }} /></div>
          <p>P(collapse): <strong className="mono">{((regimeSnapshot?.pCollapse ?? 0) * 100).toFixed(1)}%</strong> · <span className={`status-badge status-badge--${(regimeSnapshot?.sirenLevel ?? 'green') === 'red' ? 'high' : (regimeSnapshot?.sirenLevel ?? 'green') === 'amber' ? 'mid' : 'low'}`}>{(regimeSnapshot?.sirenLevel ?? 'green').toUpperCase()}</span></p>
        </article>

        <article className="panel core-stats-card">
          <h2>Состояние слоя</h2>
          <ul className="core-stats-list">
            {[
              ['Сила', snapshot?.stats.strength ?? 0],
              ['Интеллект', snapshot?.stats.intelligence ?? 0],
              ['Мудрость', snapshot?.stats.wisdom ?? 0],
              ['Ловкость', snapshot?.stats.dexterity ?? 0],
            ].map(([label, value]) => (
              <li key={label}>
                <div className="core-stats-row"><span>{label}</span><strong className="mono">{formatNumber(Number(value))}</strong></div>
                <div className="meter" aria-hidden="true"><div className="meter__fill" style={{ width: `${Number(value)}%` }} /></div>
              </li>
            ))}
          </ul>
          <p>XP: <strong className="mono">{snapshot?.xp ?? 0}</strong> · Уровень: <strong className="mono">{snapshot?.level ?? 1}</strong></p>
          <p>Энтропия: <strong className="mono">{formatNumber(snapshot?.entropy ?? 0)}</strong> · Дрифт: <strong className="mono">{(snapshot?.drift ?? 0) > 0 ? '+' : ''}{formatNumber(snapshot?.drift ?? 0)}</strong></p>
        </article>


        <article className="panel core-next-action">
          <h2>Активная цель</h2>
          {activeGoalSummary ? (
            <>
              <p><strong>{activeGoalSummary.title}</strong></p>
              <p>Индекс цели: <strong>{activeGoalSummary.score.toFixed(1)}</strong> {activeGoalSummary.trend ? (activeGoalSummary.trend === 'up' ? '↑' : '↓') : ''}</p>
              <p>Разрыв: <strong>{activeGoalSummary.gap >= 0 ? '+' : ''}{activeGoalSummary.gap.toFixed(1)}</strong></p>
              <button type="button" onClick={() => navigate('/goals')}>Открыть цели</button>
            </>
          ) : (
            <>
              <p>Активная цель не задана.</p>
              <button type="button" onClick={() => navigate('/goals')}>Создать цель</button>
            </>
          )}
        </article>



        <article className="panel core-next-action">
          <h2>Хвостовой риск</h2>
          {tailRiskSummary ? (
            <>
              <p>P(RED, 7д): <strong>{(tailRiskSummary.pRed7d * 100).toFixed(1)}%</strong></p>
              <p>ES(P(collapse), 10%): <strong>{(tailRiskSummary.esCollapse10 * 100).toFixed(1)}%</strong></p>
              <button type="button" onClick={() => navigate('/black-swans')}>Открыть Чёрные лебеди</button>
            </>
          ) : (
            <>
              <p>Последний расчёт хвостового риска не найден.</p>
              <button type="button" onClick={() => navigate('/black-swans')}>Проверить хвостовой риск</button>
            </>
          )}
        </article>
        <article className="panel core-next-action">
          <h2>Следующий шаг</h2>
          <p><strong>{oneNextAction.title}</strong></p>
          <p>{oneNextAction.hint}</p>
          <button type="button" onClick={() => navigate(oneNextAction.ctaPath)}>{oneNextAction.ctaLabel}</button>
        </article>

        <article className="panel core-explain">
          <h2>Почему ядро такое</h2>
          <ul>
            {contributors.map((item) => (
              <li key={item.id}><strong>{item.title}.</strong> {item.text}</li>
            ))}
          </ul>
        </article>
      </section>

      {!latest ? (
        <article className="empty-state panel">
          <h2>Ядро ждёт первый сигнал</h2>
          <p>Пока данных нет. Начните с одного действия — и ядро станет живым.</p>
          <div className="settings-actions">
            <button type="button" onClick={() => navigate('/core')}>Создать чек-ин</button>
            <button type="button" onClick={async () => { await seedTestData(30, 42); await onSaved(); const [nextSnapshot, nextRegime] = await Promise.all([computeCurrentStateSnapshot(), computeCurrentRegimeSnapshot()]); setSnapshot(nextSnapshot); setRegimeSnapshot(nextRegime) }}>Сгенерировать 30 дней</button>
            <button type="button" onClick={() => navigate('/settings')}>Импортировать данные</button>
          </div>
        </article>
      ) : null}

      {(regimeSnapshot?.sirenLevel === 'red') ? (
        <section className="panel core-siren">
          <h2>Сирена</h2>
          <p>Порог риска превышен. Нужен протокол разрядки.</p>
          <ul>{sirenActions.map((action) => <li key={action.what}><strong>Что сделать:</strong> {action.what}<br /><strong>Почему:</strong> {action.why}<br /><strong>Эффект:</strong> {action.effect}</li>)}</ul>
          <button type="button" disabled={!sirenActions[0]} onClick={async () => { if (!sirenActions[0]) return; await addQuest({ createdAt: Date.now(), title: `Сирена: ${sirenActions[0].what}`, metricTarget: 'stress', delta: -1, horizonDays: 2, status: 'active', predictedIndexLift: 0.8 }); await onQuestChange() }}>Принять действие</button>
        </section>
      ) : null}

      <section className="panel">
        <h2>Новый чек-ин</h2>
        <div className="form-grid">
          {METRICS.map((metric) => (
            <MetricControl
              key={metric.id}
              metric={metric}
              value={values[metric.id]}
              error={errors[metric.id]}
              onValueChange={(next) => updateValue(metric.id, next)}
              onBlur={(raw) => handleBlur(metric, raw)}
            />
          ))}
        </div>

        <div className="save-row">
          <button type="button" className="save-button" onClick={handleSave} disabled={saveState === 'saving'}>
            Сохранить чек-ин
          </button>
          <span className="save-feedback">
            {saveState === 'saving' ? 'Сохранение…' : null}
            {saveState === 'saved' && savedRecord ? `Чек-ин сохранён` : null}
          </span>
        </div>

        {resultInsight ? (
          <section className="result-panel panel">
            <h2>Результат чек-ина</h2>
            <p>Лучший рычаг дня: <strong>{resultInsight.bestLever?.title ?? 'Пока не найден'}</strong></p>
            <div className="save-row">
              <button type="button" onClick={acceptAction} disabled={!resultInsight.bestLever || Boolean(activeQuest)}>
                Принять миссию
              </button>
              {activeQuest ? <span className="chip">У вас уже есть активная миссия</span> : null}
            </div>
          </section>
        ) : null}
      </section>
    </section>
  )
}
