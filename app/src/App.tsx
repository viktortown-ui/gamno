import { useEffect, useMemo, useState, type ChangeEventHandler } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { MetricControl } from './components/MetricControl'
import { DEFAULT_CHECKIN_VALUES, INDEX_METRIC_IDS, METRICS, type MetricConfig, type MetricId } from './core/metrics'
import type { CheckinRecord, CheckinValues } from './core/models/checkin'
import {
  addCheckin,
  clearAllData,
  exportData,
  getLatestCheckin,
  importData,
  listCheckins,
} from './core/storage/repo'

type PageKey = 'core' | 'dashboard' | 'oracle' | 'graph' | 'history' | 'settings'

type SaveState = 'idle' | 'saving' | 'saved'

const pageMeta: { key: PageKey; label: string }[] = [
  { key: 'core', label: 'Чек-ин' },
  { key: 'dashboard', label: 'Дашборд' },
  { key: 'oracle', label: 'Оракул' },
  { key: 'graph', label: 'График' },
  { key: 'history', label: 'История' },
  { key: 'settings', label: 'Настройки' },
]

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU')
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function formatMetricValue(metric: MetricConfig, value: number): string {
  const normalized = metric.step < 1 ? value.toFixed(1) : String(Math.round(value))
  if (metric.unitRu === '₽') {
    return `${new Intl.NumberFormat('ru-RU').format(Number(normalized))} ${metric.unitRu}`
  }
  return metric.unitRu ? `${normalized} ${metric.unitRu}` : normalized
}

function clamp(metric: MetricConfig, value: number): number {
  return Math.min(metric.max, Math.max(metric.min, value))
}

function getValidationError(metric: MetricConfig, raw: string): string | undefined {
  if (raw.trim() === '') {
    return 'Введите число.'
  }

  const parsed = Number(raw)
  if (Number.isNaN(parsed)) {
    return 'Введите корректное число.'
  }

  if (parsed < metric.min || parsed > metric.max) {
    return `Диапазон: ${metric.min}…${metric.max}${metric.unitRu ? ` ${metric.unitRu}` : ''}.`
  }

  return undefined
}

function DashboardPage({ checkins }: { checkins: CheckinRecord[] }) {
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const last7From = now - 7 * dayMs
  const prev7From = now - 14 * dayMs

  const last7 = checkins.filter((item) => item.ts >= last7From)
  const prev7 = checkins.filter((item) => item.ts >= prev7From && item.ts < last7From)

  const metricRows = METRICS.map((metric) => {
    const currentAvg =
      last7.length > 0 ? last7.reduce((sum, item) => sum + item[metric.id], 0) / last7.length : 0
    const prevAvg =
      prev7.length > 0 ? prev7.reduce((sum, item) => sum + item[metric.id], 0) / prev7.length : 0

    let trend = '→'
    if (currentAvg > prevAvg) trend = '↑'
    else if (currentAvg < prevAvg) trend = '↓'

    return { metric, currentAvg, trend }
  })

  return (
    <section className="page">
      <h1>Дашборд</h1>
      <p>Средние значения за последние 7 дней и тренд к предыдущим 7 дням.</p>
      <table className="table">
        <thead>
          <tr>
            <th>Метрика</th>
            <th>Среднее (7 дн.)</th>
            <th>Тренд</th>
          </tr>
        </thead>
        <tbody>
          {metricRows.map((row) => (
            <tr key={row.metric.id}>
              <td>{row.metric.labelRu}</td>
              <td>{formatMetricValue(row.metric, row.currentAvg)}</td>
              <td>{row.trend}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function HistoryPage({ checkins }: { checkins: CheckinRecord[] }) {
  const [days, setDays] = useState<7 | 30 | 90>(7)

  const filtered = useMemo(() => {
    const fromTs = Date.now() - days * 24 * 60 * 60 * 1000
    return checkins.filter((item) => item.ts >= fromTs)
  }, [checkins, days])

  return (
    <section className="page">
      <h1>История</h1>
      <div className="filters">
        {[7, 30, 90].map((value) => (
          <button
            key={value}
            type="button"
            className={`filter-button ${days === value ? 'filter-button--active' : ''}`}
            onClick={() => setDays(value as 7 | 30 | 90)}
          >
            {value} дней
          </button>
        ))}
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Дата</th>
            {METRICS.map((metric) => (
              <th key={metric.id}>{metric.labelRu}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={METRICS.length + 1}>Данных нет.</td>
            </tr>
          ) : (
            filtered.map((item) => (
              <tr key={item.id}>
                <td>{formatDate(item.ts)}</td>
                {METRICS.map((metric) => (
                  <td key={metric.id}>{formatMetricValue(metric, item[metric.id])}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  )
}

function CorePage({
  onSaved,
  latest,
  previous,
}: {
  onSaved: (saved: CheckinRecord) => Promise<void>
  latest?: CheckinRecord
  previous?: CheckinRecord
}) {
  const [values, setValues] = useState<CheckinValues>(DEFAULT_CHECKIN_VALUES)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [errors, setErrors] = useState<Partial<Record<MetricId, string>>>({})

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
    const savedRecord = await addCheckin(values)
    setSavedAt(savedRecord.ts)
    setSaveState('saved')
    await onSaved(savedRecord)
  }

  const dayIndex = latest
    ? INDEX_METRIC_IDS.reduce((sum, id) => sum + latest[id], 0) / INDEX_METRIC_IDS.length
    : 0

  const topDeltas = latest && previous
    ? METRICS
        .filter((metric) => metric.id !== 'cashFlow')
        .map((metric) => ({
          metric,
          delta: latest[metric.id] - previous[metric.id],
        }))
        .filter((row) => row.delta !== 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 3)
    : []

  return (
    <section className="page">
      <h1>Чек-ин</h1>
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
          {saveState === 'saved' && savedAt ? `Сохранено в ${formatTime(savedAt)}` : null}
        </span>
      </div>

      <section className="last-checkin">
        <h2>Последний чек-ин</h2>
        {!latest ? (
          <p>Пока нет сохраненных чек-инов.</p>
        ) : (
          <>
            <p>{formatDate(latest.ts)}</p>
            <p>
              Индекс дня: <strong>{dayIndex.toFixed(1)}</strong>
            </p>
            {topDeltas.length > 0 ? (
              <ul>
                {topDeltas.map((row) => (
                  <li key={row.metric.id}>
                    Δ {row.metric.labelRu}: {row.delta > 0 ? '+' : ''}
                    {row.delta.toFixed(1).replace('.0', '')}
                  </li>
                ))}
              </ul>
            ) : (
              <p>Изменений относительно прошлого чек-ина пока нет.</p>
            )}
          </>
        )}
      </section>
    </section>
  )
}

function SettingsPage({ onDataChanged }: { onDataChanged: () => Promise<void> }) {
  const handleClear = async () => {
    if (!window.confirm('Удалить все локальные данные?')) {
      return
    }

    await clearAllData()
    await onDataChanged()
  }

  const handleExport = async () => {
    const payload = await exportData()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'gamno-export.json'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const handleImport: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const text = await file.text()
    const payload = JSON.parse(text)
    await importData(payload)
    await onDataChanged()
    event.target.value = ''
  }

  return (
    <section className="page">
      <h1>Настройки</h1>
      <div className="settings-actions">
        <button type="button" onClick={handleClear}>
          Очистить данные
        </button>
        <button type="button" onClick={handleExport}>
          Экспорт JSON
        </button>
        <label className="import-label">
          Импорт JSON
          <input type="file" accept="application/json" onChange={handleImport} />
        </label>
      </div>
    </section>
  )
}

function PageStub({ title }: { title: string }) {
  return (
    <section className="page">
      <h1>{title}</h1>
      <p>Страница-заглушка для раздела {title}.</p>
    </section>
  )
}

function DesktopOnlyGate() {
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1200)

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth >= 1200)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  if (isDesktop) return <DesktopApp />

  return (
    <main className="gate">
      <h1>Только десктоп</h1>
      <p>Откройте приложение на экране шириной не меньше 1200px.</p>
    </main>
  )
}

function DesktopApp() {
  const [checkins, setCheckins] = useState<CheckinRecord[]>([])
  const [latestCheckin, setLatestCheckin] = useState<CheckinRecord | undefined>()

  const loadData = async () => {
    const [all, latest] = await Promise.all([listCheckins(), getLatestCheckin()])
    setCheckins(all)
    setLatestCheckin(latest)
  }

  const handleSaved = async (saved: CheckinRecord) => {
    setLatestCheckin(saved)
    setCheckins((prev) => [saved, ...prev])
    await loadData()
  }

  useEffect(() => {
    void loadData()
  }, [])

  return (
    <div className="layout">
      <aside className="sidebar">
        <h2>Gamno</h2>
        <nav>
          {pageMeta.map((page) => (
            <NavLink
              key={page.key}
              className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}
              to={`/${page.key}`}
            >
              {page.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<Navigate to="/core" replace />} />
          <Route
            path="/core"
            element={<CorePage onSaved={handleSaved} latest={latestCheckin} previous={checkins[1]} />}
          />
          <Route path="/dashboard" element={<DashboardPage checkins={checkins} />} />
          <Route path="/history" element={<HistoryPage checkins={checkins} />} />
          <Route path="/settings" element={<SettingsPage onDataChanged={loadData} />} />
          <Route path="/oracle" element={<PageStub title="Оракул" />} />
          <Route path="/graph" element={<PageStub title="График" />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return <DesktopOnlyGate />
}
