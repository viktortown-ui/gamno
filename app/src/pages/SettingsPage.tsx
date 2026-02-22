import type { ChangeEventHandler } from 'react'
import { clearAllData, exportDataBlob, importDataBlob, seedTestData } from '../core/storage/repo'
import type { AppearanceSettings } from '../ui/appearance'
import { SparkButton } from '../ui/SparkButton'

interface SettingsPageProps {
  onDataChanged: () => Promise<void>
  appearance: AppearanceSettings
  onAppearanceChange: (next: AppearanceSettings) => void
}

export function SettingsPage({ onDataChanged, appearance, onAppearanceChange }: SettingsPageProps) {
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
    const raw = window.prompt('Введите сид (опционально)')
    const seed = raw ? Number(raw) : 42
    await seedTestData(30, Number.isFinite(seed) ? seed : 42)
    await onDataChanged()
  }

  return (
    <section className="page panel">
      <h1>Настройки</h1>
      <p>Данные хранятся локально в IndexedDB.</p>

      <article className="panel settings-panel">
        <h2>Оформление</h2>
        <div className="settings-appearance">
          <label>Тема
            <select
              value={appearance.theme}
              onChange={(event) => onAppearanceChange({ ...appearance, theme: event.target.value === 'light' ? 'light' : 'dark' })}
            >
              <option value="light">Светлая</option>
              <option value="dark">Тёмная</option>
            </select>
          </label>
          <label>Движение
            <select
              value={appearance.motion}
              onChange={(event) => onAppearanceChange({ ...appearance, motion: event.target.value === 'reduced' ? 'reduced' : 'normal' })}
            >
              <option value="normal">Обычная</option>
              <option value="reduced">Сниженная</option>
            </select>
          </label>
          <label>Прозрачность
            <select
              value={appearance.transparency}
              onChange={(event) => onAppearanceChange({ ...appearance, transparency: event.target.value === 'reduced' ? 'reduced' : 'glass' })}
            >
              <option value="glass">Стекло</option>
              <option value="reduced">Сниженная</option>
            </select>
          </label>
          <label>Рендер мира (dev)
            <select
              value={appearance.worldRenderMode}
              onChange={(event) => onAppearanceChange({ ...appearance, worldRenderMode: event.target.value === 'svg' ? 'svg' : 'webgl' })}
            >
              <option value="webgl">WebGL</option>
              <option value="svg">SVG</option>
            </select>
          </label>

          <label>Мир (dev)
            <select
              value={appearance.worldUiVariant}
              onChange={(event) => onAppearanceChange({ ...appearance, worldUiVariant: event.target.value === 'cinematic' ? 'cinematic' : 'instrument' })}
            >
              <option value="instrument">Instrument</option>
              <option value="cinematic">Cinematic</option>
            </select>
          </label>

        </div>
      </article>

      <div className="settings-actions">
        <SparkButton type="button" onClick={handleExport}>Экспорт данных</SparkButton>
        <label className="import-label">Импорт данных<input type="file" onChange={handleImport} /></label>
        <SparkButton type="button" onClick={handleClear}>Очистить данные</SparkButton>
        <SparkButton type="button" onClick={handleSeed}>Сгенерировать тестовые данные (30 дней)</SparkButton>
      </div>
    </section>
  )
}
