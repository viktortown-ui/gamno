import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { seedTestData, createGoal, addQuest, completeQuestById } from '../core/storage/repo'
import { saveRun } from '../repo/policyRepo'
import { getLastRun as getLastMultiverseRun } from '../repo/multiverseRepo'
import type { FrameSnapshotRecord } from '../repo/frameRepo'

export function LaunchPage({ frame, onDone }: { frame?: FrameSnapshotRecord; onDone: () => Promise<void> }) {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [done, setDone] = useState(false)

  const canFinish = useMemo(() => step >= 5, [step])

  return (
    <section className="page">
      <h1>Запуск</h1>
      {done ? <p className="chip">Командный запуск завершён</p> : null}
      <article className="panel">
        <h2>Шаг {step}/5</h2>
        {step === 1 ? <><p>Данные</p><button type="button" onClick={async () => { await seedTestData(30, 42); await onDone(); setStep(2) }}>Сгенерировать тестовые данные (30 дней)</button></> : null}
        {step === 2 ? <><p>Цель</p><button type="button" onClick={async () => { await createGoal({ title: 'Стабильный фокус', status: 'active', horizonDays: 14, weights: { focus: 0.4, energy: 0.3, stress: -0.3 } }); await onDone(); setStep(3) }}>Создать цель</button></> : null}
        {step === 3 ? <><p>Первое решение</p><button type="button" onClick={async () => {
          const runTs = Date.now()
          await saveRun({ ts: runTs, stateRef: {}, inputs: {}, outputs: {}, chosenActionId: 'micro-focus-sprint', audit: { weightsSource: 'mixed', mix: 0.5, forecastConfidence: 'средняя' } })
          await addQuest({ title: 'Фокус-спринт 25 минут', predictedIndexLift: 0.4, createdAt: runTs, status: 'active', metricTarget: 'focus', delta: 0.4, horizonDays: 3 })
          await onDone(); setStep(4)
        }}>Открыть Автопилот</button></> : null}
        {step === 4 ? <><p>Проверка будущего</p><button type="button" onClick={async () => { await getLastMultiverseRun(); navigate('/multiverse'); setStep(5) }}>Открыть Мультивселенную</button></> : null}
        {step === 5 ? <><p>Закрепление</p><button type="button" onClick={async () => {
          if (frame?.payload.mission?.id) await completeQuestById(frame.payload.mission.id)
          await onDone(); setDone(true)
        }}>Отметить выполнение</button></> : null}
      </article>
      {canFinish && done ? <button type="button" onClick={() => navigate('/core')}>Перейти в Живое ядро</button> : null}
    </section>
  )
}
