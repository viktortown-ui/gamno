import { useEffect, useMemo, useState } from 'react'
import { addQuest, getActiveGoal, getLatestCheckin, getLatestRegimeSnapshot, getLatestStateSnapshot, listCheckins } from '../core/storage/repo'
import { getLastBlackSwanRun } from '../repo/blackSwanRepo'
import { getLastSnapshot as getLastTimeDebtSnapshot } from '../repo/timeDebtRepo'
import { getLastSnapshot as getLastAntifragilitySnapshot } from '../repo/antifragilityRepo'
import { buildStateVector, evaluatePoliciesWithAudit, type PolicyConstraints, type PolicyMode, type PolicyResult, type PolicyTuning } from '../core/engines/policy'
import { getBriefingBullets, getDrilldownCandidates, getModelHealthView, getPolicyCards, getPolicyDuelSummary } from './autopilotUi'
import { createPolicy, getActivePolicy, saveRun, setActivePolicy } from '../repo/policyRepo'
import { getLastActionAudit, listRecentActionAudits, type ActionAuditRecord } from '../repo/actionAuditRepo'

type HorizonDays = 3 | 7

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function policyBudgetStatus(policy: PolicyResult, constraints: PolicyConstraints): string {
  const limits = [
    policy.best.deltas.pCollapse <= constraints.maxPCollapse,
    policy.best.deltas.sirenRisk <= constraints.sirenCap,
    policy.best.deltas.debt <= constraints.maxDebtGrowth,
  ]
  return limits.every(Boolean) ? 'В бюджете' : 'Выше лимитов'
}

function UncertaintyMiniChart({ points }: { points: Array<{ horizon: HorizonDays; p10: number; p50: number; p90: number }> }) {
  const width = 280
  const height = 90
  const pad = 14
  const safe = points.length ? points : [{ horizon: 3, p10: 0, p50: 0, p90: 0 }, { horizon: 7, p10: 0, p50: 0, p90: 0 }]
  const values = safe.flatMap((item) => [item.p10, item.p50, item.p90])
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(0.0001, max - min)
  const x = (idx: number) => pad + (idx * (width - pad * 2)) / Math.max(1, safe.length - 1)
  const y = (value: number) => height - pad - ((value - min) / span) * (height - pad * 2)
  const bandPath = `${safe.map((item, idx) => `${idx === 0 ? 'M' : 'L'} ${x(idx)} ${y(item.p10)}`).join(' ')} ${[...safe].reverse().map((item, idx) => `L ${x(safe.length - 1 - idx)} ${y(item.p90)}`).join(' ')} Z`
  const medianPath = safe.map((item, idx) => `${idx === 0 ? 'M' : 'L'} ${x(idx)} ${y(item.p50)}`).join(' ')

  return (
    <svg width={width} height={height} role="img" aria-label="График неопределённости p10-p90 и p50">
      <path d={bandPath} fill="rgba(63,122,255,0.2)" stroke="rgba(63,122,255,0.35)" />
      <path d={medianPath} fill="none" stroke="rgba(63,122,255,0.95)" strokeWidth="2" />
      {safe.map((item, idx) => <text key={item.horizon} x={x(idx) - 8} y={height - 2} fontSize="10">H{item.horizon}</text>)}
    </svg>
  )
}

export function AutopilotPage({ onChanged }: { onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<PolicyMode>('balanced')
  const [horizon, setHorizon] = useState<HorizonDays>(3)
  const [constraints, setConstraints] = useState<PolicyConstraints>({ maxPCollapse: 0.03, sirenCap: 0.03, maxDebtGrowth: 0.2, minRecoveryScore: 55 })
  const [tuning, setTuning] = useState<PolicyTuning>({ load: 0, cautious: 0 })
  const [results, setResults] = useState<PolicyResult[]>([])
  const [audit, setAudit] = useState<{ weightsSource: 'manual' | 'learned' | 'mixed'; mix: number; tailRiskRunTs?: number; forecastConfidence: 'низкая' | 'средняя' | 'высокая' } | null>(null)
  const [lastRunTs, setLastRunTs] = useState<number | null>(null)
  const [latestActionAudit, setLatestActionAudit] = useState<ActionAuditRecord | null>(null)
  const [auditList, setAuditList] = useState<ActionAuditRecord[]>([])
  const [selectedAuditId, setSelectedAuditId] = useState<number | null>(null)

  const recompute = async () => {
    const [latestCheckin, checkins, stateSnapshot, regimeSnapshot, debtSnapshot, activeGoal, blackSwanRun, active, antifragility] = await Promise.all([
      getLatestCheckin(),
      listCheckins(),
      getLatestStateSnapshot(),
      getLatestRegimeSnapshot(),
      getLastTimeDebtSnapshot(),
      getActiveGoal(),
      getLastBlackSwanRun(),
      getActivePolicy(),
      getLastAntifragilitySnapshot(),
    ])

    if (!latestCheckin) {
      setResults([])
      return
    }

    const weightsSource = active?.mode === 'growth' ? 'mixed' : 'manual'
    const mix = active?.mode === 'growth' ? 0.6 : 0.4
    const state = buildStateVector({
      latestCheckin,
      checkins,
      stateSnapshot,
      regimeSnapshot,
      timeDebtSnapshot: debtSnapshot,
      activeGoal: activeGoal ?? null,
      blackSwanRun,
      recoveryScore: antifragility?.recoveryScore ?? 0,
      shockBudget: antifragility?.shockBudget ?? 0,
    })

    const evaluated = await evaluatePoliciesWithAudit({
      state,
      constraints,
      mode,
      seed: 42,
      buildId: String(import.meta.env.VITE_APP_VERSION ?? 'dev'),
      policyVersion: '2.0-01-pr4',
      tuning,
    })
    setResults(evaluated)

    const [latestStoredAudit, latestAudits] = await Promise.all([
      getLastActionAudit(),
      listRecentActionAudits(12),
    ])
    setLatestActionAudit(latestStoredAudit ?? null)
    setAuditList(latestAudits)
    setSelectedAuditId((prev) => prev ?? (latestStoredAudit?.id ?? null))

    const run = await saveRun({
      ts: Date.now(),
      stateRef: { stateSnapshotId: stateSnapshot?.id, regimeSnapshotId: regimeSnapshot?.id, timeDebtSnapshotId: debtSnapshot?.id },
      goalRef: activeGoal?.id ? { id: activeGoal.id, title: activeGoal.title } : undefined,
      inputs: { state, constraints, mode, tuning },
      outputs: evaluated,
      chosenPolicyId: active?.id,
      chosenActionId: undefined,
      audit: {
        weightsSource,
        mix,
        tailRiskRunTs: blackSwanRun?.ts,
        forecastConfidence: state.volatility < 0.8 ? 'высокая' : state.volatility < 1.6 ? 'средняя' : 'низкая',
      },
    })
    setLastRunTs(run.ts)
    setAudit(run.audit)
  }

  useEffect(() => {
    void recompute()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [constraints.maxDebtGrowth, constraints.maxPCollapse, constraints.sirenCap, constraints.minRecoveryScore, mode, tuning.load, tuning.cautious])

  const selected = useMemo(() => results.find((item) => item.mode === mode), [results, mode])
  const cards = useMemo(() => getPolicyCards({ results, audit: latestActionAudit, horizon }), [results, latestActionAudit, horizon])
  const resultByMode = useMemo(() => new Map(results.map((item) => [item.mode, item])), [results])

  const selectedAudit = useMemo(() => {
    if (!auditList.length) return null
    return auditList.find((item) => item.id === selectedAuditId) ?? auditList[0]
  }, [auditList, selectedAuditId])

  const whyTop = useMemo(() => latestActionAudit?.whyTopRu ?? selected?.best.reasonsRu ?? [], [latestActionAudit, selected])
  const briefing = useMemo(() => getBriefingBullets({ selected, whyTopRu: whyTop, constraints }), [selected, whyTop, constraints])
  const duel = useMemo(() => getPolicyDuelSummary({ horizonSummary: latestActionAudit?.horizonSummary ?? [], horizon }), [latestActionAudit, horizon])
  const drilldown = useMemo(() => getDrilldownCandidates({ selected, constraints, topK: 3 }), [selected, constraints])
  const health = useMemo(() => getModelHealthView(latestActionAudit?.modelHealth), [latestActionAudit])

  const fanChartPoints = useMemo(() => {
    const actionId = selected?.best.action.id
    if (!actionId) return []
    return ([3, 7] as HorizonDays[]).map((h) => {
      const item = (latestActionAudit?.horizonSummary ?? []).find((entry) => entry.horizonDays === h && entry.policyMode === mode && entry.actionId === actionId)
      return { horizon: h, p10: item?.stats.p10 ?? 0, p50: item?.stats.p50 ?? 0, p90: item?.stats.p90 ?? 0 }
    })
  }, [latestActionAudit, mode, selected])

  const handleAcceptPolicy = async (policyMode: PolicyMode) => {
    const existing = await getActivePolicy()
    if (existing && existing.mode === policyMode) return
    const created = await createPolicy({
      nameRu: `Политика: ${policyMode === 'risk' ? 'Осторожный' : policyMode === 'balanced' ? 'Сбалансированный' : 'Разгон'}`,
      mode: policyMode,
      weights: { version: 1 },
      constraints,
      isActive: true,
    })
    await setActivePolicy(created.id ?? 0)
    await onChanged()
  }

  const handleAcceptAction = async () => {
    if (!selected) return
    const action = selected.best.action
    const goal = await getActiveGoal()
    await addQuest({
      createdAt: Date.now(),
      title: `Автопилот: ${action.titleRu}`,
      metricTarget: 'stress',
      delta: action.parameters.delta,
      horizonDays: horizon,
      status: 'active',
      predictedIndexLift: Number(selected.best.deltas.index.toFixed(2)),
      goalId: goal?.id,
    })
    await saveRun({
      ts: Date.now(),
      stateRef: {},
      goalRef: goal?.id ? { id: goal.id, title: goal.title } : undefined,
      inputs: { from: 'accept-action', horizon, tuning },
      outputs: selected,
      chosenActionId: action.id,
      audit: audit ?? { weightsSource: 'manual', mix: 0.5, forecastConfidence: 'средняя' },
    })
    await onChanged()
  }

  const secondary = selected?.ranked[1]

  return (
    <section className="page panel" aria-label="Автопилот 2">
      <h1>Автопилот</h1>
      <p>Решения рассчитываются детерминированно из текущего состояния, цели и ограничений.</p>

      <article className="summary-card panel">
        <h2>Briefing</h2>
        <p><strong>{briefing.summary}</strong></p>
        <ul>{briefing.why.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <ul>{briefing.risks.map((risk) => <li key={risk}>{risk}</li>)}</ul>
      </article>

      <article className="summary-card panel">
        <h2>Неопределённость H3/H7</h2>
        <UncertaintyMiniChart points={fanChartPoints} />
      </article>

      <article className="summary-card panel">
        <h2>Горизонт</h2>
        <div className="settings-actions" role="group" aria-label="Выбор горизонта">
          <button type="button" onClick={() => setHorizon(3)} className={horizon === 3 ? 'chip' : ''} aria-pressed={horizon === 3}>3 дня</button>
          <button type="button" onClick={() => setHorizon(7)} className={horizon === 7 ? 'chip' : ''} aria-pressed={horizon === 7}>7 дней</button>
        </div>
      </article>

      <article className="summary-card panel">
        <h2>Режим</h2>
        <div className="settings-actions" role="group" aria-label="Выбор режима">
          <button type="button" onClick={() => setMode('risk')} className={mode === 'risk' ? 'chip' : ''} aria-pressed={mode === 'risk'}>Осторожный</button>
          <button type="button" onClick={() => setMode('balanced')} className={mode === 'balanced' ? 'chip' : ''} aria-pressed={mode === 'balanced'}>Сбалансированный</button>
          <button type="button" onClick={() => setMode('growth')} className={mode === 'growth' ? 'chip' : ''} aria-pressed={mode === 'growth'}>Разгон</button>
        </div>
      </article>

      <article className="summary-card panel">
        <h2>Ограничения</h2>
        <label>Макс. рост P(collapse)
          <input type="number" step="0.001" value={constraints.maxPCollapse} onChange={(e) => setConstraints((prev) => ({ ...prev, maxPCollapse: Number(e.target.value) || 0 }))} />
        </label>
        <label>Порог риска сирены
          <input type="number" step="0.001" value={constraints.sirenCap} onChange={(e) => setConstraints((prev) => ({ ...prev, sirenCap: Number(e.target.value) || 0 }))} />
        </label>
        <label>Макс. рост долга
          <input type="number" step="0.01" value={constraints.maxDebtGrowth} onChange={(e) => setConstraints((prev) => ({ ...prev, maxDebtGrowth: Number(e.target.value) || 0 }))} />
        </label>
        <label>Минимум RecoveryScore для встрясок
          <input type="number" step="1" value={constraints.minRecoveryScore} onChange={(e) => setConstraints((prev) => ({ ...prev, minRecoveryScore: Number(e.target.value) || 0 }))} />
        </label>
      </article>

      <article className="summary-card panel">
        <h2>Best action now</h2>
        <p><strong>{selected?.best.action.titleRu ?? '—'}</strong></p>
        <p>Режим: {selected?.nameRu ?? '—'} · Горизонт: {horizon} дней</p>
        <div className="settings-actions" role="group" aria-label="Управление автопилотом">
          <button type="button" onClick={() => setTuning((prev) => ({ ...prev, load: Math.min(1, Number((prev.load + 0.2).toFixed(2))) }))}>lower load</button>
          <button type="button" onClick={() => setTuning((prev) => ({ ...prev, cautious: Math.min(1, Number((prev.cautious + 0.2).toFixed(2))) }))}>more cautious</button>
          <span>load {tuning.load.toFixed(1)} · cautious {tuning.cautious.toFixed(1)}</span>
        </div>
        <button type="button" className="primary-action" onClick={() => void handleAcceptAction()} disabled={!selected}>Запустить действие сейчас</button>
      </article>

      <article className="summary-card panel">
        <h2>Policy Duel</h2>
        <p>best p50: <strong>{duel.p50}</strong></p>
        <p>best tail: <strong>{duel.tail}</strong></p>
        <p>best failRate: <strong>{duel.failRate}</strong></p>
        <p>best budget stability: <strong>{duel.budget}</strong></p>
      </article>

      <article className="summary-card panel">
        <h2>Action Drilldown</h2>
        <ul>
          {drilldown.map((item) => (
            <li key={item.id}>
              <strong>{item.titleRu}</strong>: Δgoal {item.deltas.goalScore.toFixed(2)} · Δindex {item.deltas.index.toFixed(2)} · ΔpCollapse {(item.deltas.pCollapse * 100).toFixed(1)} п.п. · Δtail {(item.deltas.tailRisk * 100).toFixed(1)} п.п. · Δdebt {(item.deltas.debt * 100).toFixed(1)} п.п.
              {item.warnings.length ? <div>{item.warnings.join(' ')}</div> : <div>Ограничения соблюдены.</div>}
            </li>
          ))}
        </ul>
      </article>

      <article className="summary-card panel">
        <h2>Политики · top-K</h2>
        <div className="dashboard-grid">
          {cards.map((policy) => {
            const policyResult = resultByMode.get(policy.mode)
            return (<article key={policy.mode} className="panel">
              <h3>{policy.nameRu}</h3>
              <p><strong>Лучшее:</strong> {policy.bestTitle}</p>
              <p><strong>Статус бюджета:</strong> {policyResult ? policyBudgetStatus(policyResult, constraints) : '—'}</p>
              <ol>
                {policy.candidates.map((candidate) => (
                  <li key={candidate.actionId}>
                    <strong>{candidate.titleRu}</strong> · score {candidate.score.toFixed(2)} · penalty {candidate.penalty.toFixed(2)}
                    <br />
                    p50 {candidate.p50.toFixed(2)} · p90 {candidate.p90.toFixed(2)} · tail {formatPercent(candidate.tail)} · fail {formatPercent(candidate.failRate)}
                  </li>
                ))}
              </ol>
              <button type="button" onClick={() => void handleAcceptPolicy(policy.mode)}>Принять политику</button>
            </article>)
          })}
        </div>
      </article>

      <article className="summary-card panel">
        <h2>Explain</h2>
        <p><strong>whyTopRu</strong></p>
        <ul>
          {whyTop.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
        <p><strong>Score breakdown</strong>: score {selected?.best.score.toFixed(2) ?? '—'} · penalty {Number(selected?.best.penalty ?? 0).toFixed(2)} · Δgoal {selected?.best.deltas.goalScore.toFixed(2) ?? '—'} · Δindex {selected?.best.deltas.index.toFixed(2) ?? '—'}</p>
        <p><strong>Почему не #2</strong>: {secondary ? `«${secondary.action.titleRu}» уступает на ${(((selected?.best.score ?? 0) - secondary.score)).toFixed(2)} балла.` : 'Недостаточно кандидатов для сравнения.'}</p>
      </article>

      <article className="summary-card panel">
        <h2>Аудит</h2>
        <p>Источник весов: <strong>{audit?.weightsSource ?? '—'}</strong> · mix: <strong>{audit?.mix ?? '—'}</strong></p>
        <p>Последний хвостовой прогон: <strong>{audit?.tailRiskRunTs ? new Date(audit.tailRiskRunTs).toLocaleString('ru-RU') : 'нет'}</strong></p>
        <p>Уверенность прогноза: <strong>{audit?.forecastConfidence ?? '—'}</strong></p>
        <p>Model Health: <strong>{health.level}</strong> · {health.reason}</p>
        <p>Последний запуск автопилота: <strong>{lastRunTs ? new Date(lastRunTs).toLocaleString('ru-RU') : '—'}</strong></p>

        <div className="audit-layout">
          <div>
            <h3>Последние записи</h3>
            <ul className="audit-list">
              {auditList.map((item) => (
                <li key={item.id}>
                  <button type="button" className={selectedAudit?.id === item.id ? 'chip' : ''} onClick={() => setSelectedAuditId(item.id ?? null)}>
                    {new Date(item.ts).toLocaleString('ru-RU')} · {item.chosenActionId}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Детали</h3>
            {selectedAudit ? (
              <>
                <p>reproToken: build {selectedAudit.reproToken.buildId} · seed {selectedAudit.reproToken.seed}</p>
                <p>stateHash: {selectedAudit.reproToken.stateHash}</p>
                <p>catalogHash: {selectedAudit.reproToken.catalogHash}</p>
                <p>policyVersion: {selectedAudit.reproToken.policyVersion}</p>
                <p>Кандидаты: {selectedAudit.topCandidates.map((candidate) => `${candidate.actionId} (${candidate.score.toFixed(2)})`).join(', ') || '—'}</p>
                <p>H{horizon}: {(selectedAudit.horizonSummary ?? []).filter((item) => item.horizonDays === horizon).map((item) => `${item.policyMode}/${item.actionId}: p50 ${item.stats.p50.toFixed(2)}, p90 ${item.stats.p90.toFixed(2)}, fail ${formatPercent(item.stats.failRate)}`).join(' · ') || '—'}</p>
              </>
            ) : <p>Нет записей аудита.</p>}
          </div>
        </div>
      </article>
    </section>
  )
}
