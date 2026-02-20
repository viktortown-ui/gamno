import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { listCheckins, addQuest, getLatestRegimeSnapshot } from '../core/storage/repo'
import { computeSocialRadar } from '../core/engines/socialRadar'
import type { PersonRecord, SocialEventRecord, SocialRadarResult } from '../core/models/socialRadar'
import { createPerson, listPeople } from '../repo/peopleRepo'
import { addEvent, deleteEvent, listByRange } from '../repo/eventsRepo'
import { saveInsight } from '../repo/socialRadarRepo'
import { dayKeyFromTs } from '../core/utils/dayKey'

const EVENT_TYPES = ['разговор', 'встреча', 'конфликт', 'поддержка', 'соцсеть', 'семья', 'команда']
const TARGETS = [
  { id: 'stress', label: 'Стресс' },
  { id: 'energy', label: 'Энергия' },
  { id: 'mood', label: 'Настроение' },
  { id: 'index', label: 'Индекс' },
]

export function SocialRadarPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [people, setPeople] = useState<PersonRecord[]>([])
  const [events, setEvents] = useState<SocialEventRecord[]>([])
  const [rangeFrom, setRangeFrom] = useState(() => params.get('day') ?? dayKeyFromTs(Date.now() - 27 * 86400000))
  const [rangeTo, setRangeTo] = useState(() => params.get('day') ?? dayKeyFromTs(Date.now()))
  const [typeFilter, setTypeFilter] = useState('all')
  const [personFilter, setPersonFilter] = useState('all')
  const [selectedMetric, setSelectedMetric] = useState('stress')
  const [selectedInfluenceKey, setSelectedInfluenceKey] = useState<string>('')
  const [result, setResult] = useState<SocialRadarResult | null>(null)
  const [sirenLevel, setSirenLevel] = useState<'green' | 'amber' | 'red'>('green')
  const [newAlias, setNewAlias] = useState('')
  const [form, setForm] = useState(() => ({
    ts: Date.now(),
    type: EVENT_TYPES[0],
    intensity: 3,
    valence: 0,
    personId: '',
    note: '',
  }))

  const load = useCallback(async () => {
    const [nextPeople, nextEvents, checkins, regime] = await Promise.all([
      listPeople(),
      listByRange(rangeFrom, rangeTo),
      listCheckins(),
      getLatestRegimeSnapshot(),
    ])
    setPeople(nextPeople)
    setEvents(nextEvents.reverse())
    setSirenLevel(regime?.sirenLevel ?? 'green')
    const analytics = computeSocialRadar(checkins, nextEvents, nextPeople, { windowDays: 56, maxLag: 7 })
    setResult(analytics)
    await saveInsight(analytics, 56, 7)
  }, [rangeFrom, rangeTo])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      if (typeFilter !== 'all' && event.type !== typeFilter) return false
      if (personFilter !== 'all' && String(event.personId ?? '') !== personFilter) return false
      return true
    })
  }, [events, typeFilter, personFilter])

  const topPositive = (result?.influencesByMetric[selectedMetric] ?? []).filter((item) => item.sign === 'positive').slice(0, 3)
  const topNegative = (result?.influencesByMetric[selectedMetric] ?? []).filter((item) => item.sign === 'negative').slice(0, 3)

  const selectedInfluence = useMemo(() => {
    const metricInfluences = result?.influencesByMetric[selectedMetric] ?? []
    return metricInfluences.find((item) => `${item.key}-${item.lag}` === selectedInfluenceKey) ?? metricInfluences[0] ?? null
  }, [result, selectedMetric, selectedInfluenceKey])

  return (
    <section className="page">
      <h1>Социальный радар</h1>
      <p>Локальная модель оценивает лаговые влияния событий и контактов на ваши метрики. {result?.disclaimerRu}</p>
      <div className="social-radar-grid">
        <article className="panel social-panel">
          <h2>Лента событий</h2>
          <div className="filters">
            <input type="date" value={rangeFrom} onChange={(event) => setRangeFrom(event.target.value)} />
            <input type="date" value={rangeTo} onChange={(event) => setRangeTo(event.target.value)} />
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">Все типы</option>
              {EVENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <select value={personFilter} onChange={(event) => setPersonFilter(event.target.value)}>
              <option value="all">Все контакты</option>
              {people.map((person) => <option key={person.id} value={String(person.id)}>{person.nameAlias}</option>)}
            </select>
          </div>
          <section className="panel">
            <h3>Быстрое добавление события</h3>
            <div className="filters">
              {EVENT_TYPES.map((type) => (
                <button key={type} type="button" className={`filter-button ${form.type === type ? 'filter-button--active' : ''}`} onClick={() => setForm((prev) => ({ ...prev, type }))}>{type}</button>
              ))}
            </div>
            <label>Интенсивность: <strong>{form.intensity}</strong></label>
            <input type="range" min={0} max={5} step={1} value={form.intensity} onChange={(event) => setForm((prev) => ({ ...prev, intensity: Number(event.target.value) }))} />
            <div className="filters">
              {[-2, -1, 0, 1, 2].map((valence) => (
                <button key={valence} type="button" className={`filter-button ${form.valence === valence ? 'filter-button--active' : ''}`} onClick={() => setForm((prev) => ({ ...prev, valence }))}>{valence > 0 ? `+${valence}` : valence}</button>
              ))}
            </div>
            <div className="filters">
              <select value={form.personId} onChange={(event) => setForm((prev) => ({ ...prev, personId: event.target.value }))}>
                <option value="">Без контакта</option>
                {people.map((person) => <option key={person.id} value={String(person.id)}>{person.nameAlias}</option>)}
              </select>
              <input value={newAlias} placeholder="Новый алиас" onChange={(event) => setNewAlias(event.target.value)} />
              <button type="button" onClick={async () => {
                if (!newAlias.trim()) return
                const person = await createPerson({ nameAlias: newAlias.trim() })
                setPeople((prev) => [person, ...prev])
                setForm((prev) => ({ ...prev, personId: String(person.id) }))
                setNewAlias('')
              }}>Добавить контакт</button>
            </div>
            <textarea placeholder="Заметка" value={form.note} onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))} />
            <button type="button" onClick={async () => {
              await addEvent({
                ts: form.ts,
                type: form.type,
                intensity: form.intensity,
                valence: form.valence,
                personId: form.personId ? Number(form.personId) : undefined,
                note: form.note,
              })
              setForm((prev) => ({ ...prev, note: '', ts: Date.now() }))
              await load()
            }}>Добавить событие</button>
          </section>
          <ul className="social-list">
            {filteredEvents.map((event) => (
              <li key={event.id}>
                <strong>{event.type}</strong> · {event.dayKey} · I{event.intensity} · V{event.valence > 0 ? `+${event.valence}` : event.valence}
                {event.personId ? ` · ${people.find((person) => person.id === event.personId)?.nameAlias ?? 'контакт'}` : ''}
                <button type="button" onClick={async () => { if (!event.id) return; await deleteEvent(event.id); await load() }}>Удалить</button>
              </li>
            ))}
          </ul>
        </article>

        <article className="panel social-panel">
          <h2>Влияния</h2>
          <div className="filters">
            {TARGETS.map((metric) => (
              <button key={metric.id} type="button" className={`filter-button ${selectedMetric === metric.id ? 'filter-button--active' : ''}`} onClick={() => { setSelectedMetric(metric.id); setSelectedInfluenceKey('') }}>{metric.label}</button>
            ))}
          </div>
          <h3>Топ позитивных</h3>
          <ul className="social-list">
            {topPositive.map((item) => (
              <li key={`${item.key}-${item.lag}`}>
                <button type="button" onClick={() => setSelectedInfluenceKey(`${item.key}-${item.lag}`)}>{item.key} · через {item.lag} дня · сила {item.strength.toFixed(2)}</button>
                <span className={`status-badge status-badge--${item.confidence === 'high' ? 'low' : item.confidence === 'med' ? 'mid' : 'high'}`}>{item.confidence}</span>
              </li>
            ))}
          </ul>
          <h3>Топ негативных</h3>
          <ul className="social-list">
            {topNegative.map((item) => (
              <li key={`${item.key}-${item.lag}`}>
                <button type="button" onClick={() => setSelectedInfluenceKey(`${item.key}-${item.lag}`)}>{item.key} · через {item.lag} дня · сила {item.strength.toFixed(2)}</button>
                <span className={`status-badge status-badge--${item.confidence === 'high' ? 'low' : item.confidence === 'med' ? 'mid' : 'high'}`}>{item.confidence}</span>
              </li>
            ))}
          </ul>
          {sirenLevel === 'red' ? (
            <section className="panel">
              <h3>Вероятные триггеры</h3>
              <ul className="social-list">
                {topNegative.slice(0, 3).map((item) => <li key={`trigger-${item.key}`}>{item.key} · лаг {item.lag} дн.</li>)}
              </ul>
            </section>
          ) : null}
        </article>

        <article className="panel social-panel">
          <h2>Инспектор влияния</h2>
          {selectedInfluence ? (
            <>
              <p><strong>{selectedInfluence.key}</strong> — влияние через {selectedInfluence.lag} дня.</p>
              <div className="lag-chart" role="img" aria-label="График влияния по лагам">
                {selectedInfluence.effectByLag.map((point) => (
                  <div key={point.lag} className="lag-chart__item">
                    <span>{point.lag}</span>
                    <div className="lag-chart__bar-wrap"><div className="lag-chart__bar" style={{ height: `${Math.min(100, Math.round(Math.abs(point.value) * 220))}%`, background: point.value >= 0 ? 'rgba(46,233,210,0.7)' : 'rgba(255,107,145,0.7)' }} /></div>
                  </div>
                ))}
              </div>
              <h3>Почему</h3>
              <ul className="social-list">
                {selectedInfluence.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}
              </ul>
              <div className="save-row">
                <button type="button" onClick={async () => {
                  await addQuest({
                    createdAt: Date.now(),
                    title: `Буфер: ${selectedInfluence.key}`,
                    metricTarget: selectedMetric,
                    delta: selectedInfluence.sign === 'negative' ? 1 : 0,
                    horizonDays: 3,
                    status: 'active',
                    predictedIndexLift: 0.6,
                  })
                  navigate('/goals')
                }}>Добавить буфер</button>
                <button type="button" onClick={async () => {
                  await addQuest({
                    createdAt: Date.now(),
                    title: `Миссия: стабилизировать ${selectedMetric}`,
                    metricTarget: selectedMetric,
                    delta: selectedInfluence.sign === 'negative' ? 1 : 0,
                    horizonDays: 3,
                    status: 'active',
                    predictedIndexLift: 0.8,
                  })
                  navigate('/goals')
                }}>Создать миссию</button>
              </div>
            </>
          ) : <p>Недостаточно данных для устойчивых влияний в выбранном окне.</p>}
        </article>
      </div>
    </section>
  )
}
