import type { ChangeEventHandler } from 'react'
import { clearAllData, exportDataBlob, importDataBlob, seedDemoData } from '../core/storage/repo'

export function SettingsPage({ onDataChanged }: { onDataChanged: () => Promise<void> }) {
  const handleClear = async () => {
    if (!window.confirm('Это удалит все данные локально в браузере')) return
    await clearAllData()
    await onDataChanged()
  }

  const handleExport = async () => {
    const blob = await exportDataBlob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const date = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-')
    link.href = url
    link.download = `gamno-backup-${date}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImport: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!window.confirm('Перезаписать данные?')) return
    await importDataBlob(file)
    await onDataChanged()
    event.target.value = ''
  }

  const handleSeed = async () => {
    const raw = window.prompt('Введите seed (опционально)')
    const seed = raw ? Number(raw) : 42
    await seedDemoData(30, Number.isFinite(seed) ? seed : 42)
    await onDataChanged()
  }

  return (
    <section className="page">
      <h1>Настройки</h1>
      <p>Данные хранятся локально в IndexedDB.</p>
      <div className="settings-actions">
        <button type="button" onClick={handleExport}>Экспорт данных</button>
        <label className="import-label">Импорт данных<input type="file" onChange={handleImport} /></label>
        <button type="button" onClick={handleClear}>Очистить данные</button>
        <button type="button" onClick={handleSeed}>Сгенерировать демо-данные (30 дней)</button>
      </div>
    </section>
  )
}
