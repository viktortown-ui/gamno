import type { ChangeEventHandler } from 'react'
import { clearAllData, exportData, importData } from '../core/storage/repo'

export function SettingsPage({ onDataChanged }: { onDataChanged: () => Promise<void> }) {
  const handleClear = async () => {
    if (!window.confirm('Точно очистить все локальные данные?')) return
    await clearAllData()
    await onDataChanged()
  }

  const handleExport = async () => {
    const payload = await exportData()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `gamno-export-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImport: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!window.confirm('Импорт заменит текущие данные. Продолжить?')) {
      event.target.value = ''
      return
    }

    const text = await file.text()
    const payload = JSON.parse(text)
    await importData(payload)
    await onDataChanged()
    event.target.value = ''
  }

  return (
    <section className="page">
      <h1>Настройки</h1>
      <p>Данные сохраняются локально в браузере (IndexedDB).</p>
      <div className="settings-actions">
        <button type="button" onClick={handleExport}>Экспорт данных</button>
        <label className="import-label">
          Импорт данных
          <input type="file" accept="application/json" onChange={handleImport} />
        </label>
        <button type="button" onClick={handleClear}>Очистить данные</button>
      </div>
    </section>
  )
}
