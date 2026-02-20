import { useEffect, useMemo, useState } from 'react'
import { addQuest, getActiveGoal, getLatestCheckin, getLatestRegimeSnapshot, getLatestStateSnapshot, listCheckins } from '../core/storage/repo'
import { getLastBlackSwanRun } from '../repo/blackSwanRepo'
import { getLastSnapshot as getLastTimeDebtSnapshot } from '../repo/timeDebtRepo'
import { getLastSnapshot as getLastAntifragilitySnapshot } from '../repo/antifragilityRepo'
import { buildStateVector, evaluatePoliciesWithAudit, type PolicyConstraints, type PolicyMode } from '../core/engines/policy'
import { createPolicy, getActivePolicy, saveRun, setActivePolicy } from '../repo/policyRepo'

export function AutopilotPage({ onChanged }: { onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<PolicyMode>('balanced')
  const [constraints, setConstraints] = useState<PolicyConstraints>({ maxPCollapse: 0.03, sirenCap: 0.03, maxDebtGrowth: 0.2, minRecoveryScore: 55 })
  const [results, setResults] = useState<Awaited<ReturnType<typeof evaluatePoliciesWithAudit>>>([])
  const [audit, setAudit] = useState<{ weightsSource: 'manual' | 'learned' | 'mixed'; mix: number; tailRiskRunTs?: number; forecastConfidence: 'низкая' | 'средняя' | 'высокая' } | null>(null)
  const [lastRunTs, setLastRunTs] = useState<number | null>(null)

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
      policyVersion: '2.0-01-pr1',
    })
    setResults(evaluated)

    const run = await saveRun({
      ts: Date.now(),
      stateRef: { stateSnapshotId: stateSnapshot?.id, regimeSnapshotId: regimeSnapshot?.id, timeDebtSnapshotId: debtSnapshot?.id },
      goalRef: activeGoal?.id ? { id: activeGoal.id, title: activeGoal.title } : undefined,
      inputs: { state, constraints, mode },
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
  }, [constraints.maxDebtGrowth, constraints.maxPCollapse, constraints.sirenCap, constraints.minRecoveryScore, mode])

  const selected = useMemo(() => results.find((item) => item.mode === mode), [results, mode])

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
      horizonDays: 3,
      status: 'active',
      predictedIndexLift: Number(selected.best.deltas.index.toFixed(2)),
      goalId: goal?.id,
    })
    await saveRun({
      ts: Date.now(),
      stateRef: {},
      goalRef: goal?.id ? { id: goal.id, title: goal.title } : undefined,
      inputs: { from: 'accept-action' },
      outputs: selected,
      chosenActionId: action.id,
      audit: audit ?? { weightsSource: 'manual', mix: 0.5, forecastConfidence: 'средняя' },
    })
    await onChanged()
  }

  return (
    <section className="page panel">
      <h1>Автопилот</h1>
      <p>Решения рассчитываются детерминированно из текущего состояния, цели и ограничений.</p>

      <article className="summary-card panel">
        <h2>Режим</h2>
        <div className="settings-actions">
          <button type="button" onClick={() => setMode('risk')} className={mode === 'risk' ? 'chip' : ''}>Осторожный</button>
          <button type="button" onClick={() => setMode('balanced')} className={mode === 'balanced' ? 'chip' : ''}>Сбалансированный</button>
          <button type="button" onClick={() => setMode('growth')} className={mode === 'growth' ? 'chip' : ''}>Разгон</button>
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
        <h2>Рекомендации</h2>
        <div className="dashboard-grid">
          {results.map((policy) => (
            <article key={policy.mode} className="panel">
              <h3>{policy.nameRu}</h3>
              <p><strong>Следующее действие:</strong> {policy.best.action.titleRu}</p>
              <p>Δ goalScore {policy.best.deltas.goalScore >= 0 ? '+' : ''}{policy.best.deltas.goalScore.toFixed(2)} · Δ индекс {policy.best.deltas.index >= 0 ? '+' : ''}{policy.best.deltas.index.toFixed(2)}</p>
              <p>Δ P(collapse) {(policy.best.deltas.pCollapse * 100).toFixed(2)} п.п. · Δ tail-risk {(policy.best.deltas.tailRisk * 100).toFixed(2)} п.п. · Δ долг {policy.best.deltas.debt.toFixed(2)}</p>
              <ol>{policy.best.reasonsRu.map((reason) => <li key={reason}>{reason}</li>)}</ol>
              <div className="settings-actions">
                <button type="button" onClick={() => void handleAcceptPolicy(policy.mode)}>Принять политику</button>
                <button type="button" onClick={() => void handleAcceptAction()}>Принять действие</button>
              </div>
            </article>
          ))}
        </div>
      </article>

      <article className="summary-card panel">
        <h2>Аудит</h2>
        <p>Источник весов: <strong>{audit?.weightsSource ?? '—'}</strong> · mix: <strong>{audit?.mix ?? '—'}</strong></p>
        <p>Последний хвостовой прогон: <strong>{audit?.tailRiskRunTs ? new Date(audit.tailRiskRunTs).toLocaleString('ru-RU') : 'нет'}</strong></p>
        <p>Уверенность прогноза: <strong>{audit?.forecastConfidence ?? '—'}</strong></p>
        <p>Последний запуск автопилота: <strong>{lastRunTs ? new Date(lastRunTs).toLocaleString('ru-RU') : '—'}</strong></p>
      </article>
    </section>
  )
}
