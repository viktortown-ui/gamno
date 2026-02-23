import { useMemo, useRef, useState, type ChangeEventHandler } from 'react'
import { clearAllData, exportDataBlob, importDataBlob, seedTestData } from '../core/storage/repo'
import type { AppearanceSettings } from '../ui/appearance'
import { SparkButton } from '../ui/SparkButton'
import { hardResetSiteAndReload } from '../core/cacheReset'
import { getWorldDebugHUDStorageKey, readWorldDebugHUDFlag, resolveWorldDeveloperMode, resolveWorldShowHud } from '../ui/components/worldDebugHUD'
import { resolveWorldDebugHUDPersistValue } from './settingsDebug'

type BloomPreset = 'soft' | 'normal' | 'hot'
type WorldSystemPreset = 'normal' | 'compact'
type WorldLookPreset = 'clean' | 'cinematic'
type WorldQuality = 'standard' | 'high'

interface SettingsPageProps {
  onDataChanged: () => Promise<void>
  appearance: AppearanceSettings
  onAppearanceChange: (next: AppearanceSettings) => void
}

function readFlag(key: string): boolean {
  const raw = globalThis.localStorage?.getItem(key)?.trim().toLowerCase()
  return raw === '1' || raw === 'true'
}

function readBloomPreset(): BloomPreset {
  const raw = globalThis.localStorage?.getItem('worldBloomPreset')
  if (raw === 'soft' || raw === 'normal' || raw === 'hot') return raw
  return 'normal'
}

function readWorldSystemPreset(): WorldSystemPreset {
  const raw = globalThis.localStorage?.getItem('worldSystemPreset')
  if (raw === 'compact') return 'compact'
  return 'normal'
}

function readWorldLookPreset(): WorldLookPreset {
  return globalThis.localStorage?.getItem('worldLookPreset') === 'cinematic' ? 'cinematic' : 'clean'
}

function readWorldQuality(): WorldQuality {
  return globalThis.localStorage?.getItem('worldQuality') === 'high' ? 'high' : 'standard'
}

function readWorldLutIntensity(): number {
  const raw = Number(globalThis.localStorage?.getItem('worldLutIntensity'))
  if (!Number.isFinite(raw)) return 0.44
  return Math.min(1, Math.max(0, raw))
}



export function SettingsPage({ onDataChanged, appearance, onAppearanceChange }: SettingsPageProps) {
  const [worldOrbitDim, setWorldOrbitDim] = useState(() => readFlag('worldOrbitDim'))
  const [worldSelectiveBloom, setWorldSelectiveBloom] = useState(() => readFlag('worldSelectiveBloom'))
  const [worldShowAllOrbits, setWorldShowAllOrbits] = useState(() => readFlag('worldShowAllOrbits'))
  const [worldBloomPreset, setWorldBloomPreset] = useState<BloomPreset>(() => readBloomPreset())
  const [worldSystemPreset, setWorldSystemPreset] = useState<WorldSystemPreset>(() => readWorldSystemPreset())
  const [worldLookPreset, setWorldLookPreset] = useState<WorldLookPreset>(() => readWorldLookPreset())
  const [worldQuality, setWorldQuality] = useState<WorldQuality>(() => readWorldQuality())
  const [worldAO, setWorldAO] = useState(() => readFlag('worldAO'))
  const [worldLutIntensity, setWorldLutIntensity] = useState(() => readWorldLutIntensity())
  const [worldDebugHUD, setWorldDebugHUD] = useState(() => readWorldDebugHUDFlag())
  const worldDeveloperUnlockClicksRef = useRef(0)
  const [worldDeveloperOverrideEnabled, setWorldDeveloperOverrideEnabled] = useState(() => readFlag('worldDeveloper'))
  const developerMode = resolveWorldDeveloperMode({ isDev: import.meta.env.DEV, worldDeveloper: worldDeveloperOverrideEnabled })
  const worldDebugHUDEnabled = resolveWorldShowHud({ isDev: import.meta.env.DEV, worldDeveloper: worldDeveloperOverrideEnabled, worldDebugHUD })

  const debugSummary = useMemo(
    () => `Look ${worldLookPreset} · Quality ${worldQuality} · AO ${worldAO ? 'ON' : 'OFF'} · LUT ${worldLutIntensity.toFixed(2)} · OrbitDim ${worldOrbitDim ? 'ON' : 'OFF'} · Selective Bloom ${worldSelectiveBloom ? 'ON' : 'OFF'} · Bloom ${worldBloomPreset} · Preset ${worldSystemPreset} · Show all orbits ${worldShowAllOrbits ? 'ON' : 'OFF'} · Dev mode ${developerMode ? 'ON' : 'OFF'} · HUD ${worldDebugHUDEnabled ? 'ON' : 'OFF'}`,
    [developerMode, worldAO, worldBloomPreset, worldDebugHUDEnabled, worldLookPreset, worldLutIntensity, worldOrbitDim, worldQuality, worldSelectiveBloom, worldShowAllOrbits, worldSystemPreset],
  )

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

  const handleHardCacheReset = async () => {
    if (!window.confirm('Сбросить service worker, CacheStorage и перезагрузить страницу? Это удалит оффлайн-кэш.')) return
    await hardResetSiteAndReload()
  }

  const handleSeed = async () => {
    const raw = window.prompt('Введите сид (опционально)')
    const seed = raw ? Number(raw) : 42
    await seedTestData(30, Number.isFinite(seed) ? seed : 42)
    await onDataChanged()
  }


  const handleSettingsTitleClick = () => {
    worldDeveloperUnlockClicksRef.current += 1
    if (worldDeveloperUnlockClicksRef.current < 7) return
    worldDeveloperUnlockClicksRef.current = 0
    const enabled = !worldDeveloperOverrideEnabled
    globalThis.localStorage?.setItem('worldDeveloper', enabled ? '1' : '0')
    setWorldDeveloperOverrideEnabled(enabled)
  }

  const handleApplyWorldDebugSettings = () => {
    globalThis.localStorage?.setItem('worldOrbitDim', worldOrbitDim ? '1' : '0')
    globalThis.localStorage?.setItem('worldSelectiveBloom', worldSelectiveBloom ? '1' : '0')
    globalThis.localStorage?.setItem('worldShowAllOrbits', worldShowAllOrbits ? '1' : '0')
    globalThis.localStorage?.setItem('worldBloomPreset', worldBloomPreset)
    globalThis.localStorage?.setItem('worldSystemPreset', worldSystemPreset)
    globalThis.localStorage?.setItem('worldLookPreset', worldLookPreset)
    globalThis.localStorage?.setItem('worldQuality', worldQuality)
    globalThis.localStorage?.setItem('worldAO', worldAO ? '1' : '0')
    globalThis.localStorage?.setItem('worldLutIntensity', worldLutIntensity.toFixed(2))
    globalThis.localStorage?.setItem(getWorldDebugHUDStorageKey(), resolveWorldDebugHUDPersistValue({ developerMode, worldDebugHUD }))
    window.location.reload()
  }

  return (
    <section className="page panel">
      <h1 onClick={handleSettingsTitleClick} style={{ cursor: 'default' }}>Настройки</h1>
      {developerMode ? <small className="mono">Dev mode: ON</small> : null}
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

          <label>Look preset
            <select
              value={appearance.worldLookPreset}
              onChange={(event) => onAppearanceChange({ ...appearance, worldLookPreset: event.target.value === 'cinematic' ? 'cinematic' : 'clean' })}
            >
              <option value="clean">Clean</option>
              <option value="cinematic">Cinematic</option>
            </select>
          </label>

          <label>World quality
            <select
              value={appearance.worldQuality}
              onChange={(event) => onAppearanceChange({ ...appearance, worldQuality: event.target.value === 'high' ? 'high' : 'standard' })}
            >
              <option value="standard">Standard</option>
              <option value="high">High</option>
            </select>
          </label>

        </div>
      </article>

      <article className="panel settings-panel settings-debug-panel">
        <h2>Debug / Advanced</h2>
        <p className="settings-debug-status">{debugSummary}</p>
        <div className="settings-debug-grid">
          <label className="settings-toggle">
            <input type="checkbox" checked={worldOrbitDim} onChange={(event) => setWorldOrbitDim(event.target.checked)} />
            OrbitDim (worldOrbitDim)
          </label>
          <label className="settings-toggle">
            <input type="checkbox" checked={worldSelectiveBloom} onChange={(event) => setWorldSelectiveBloom(event.target.checked)} />
            Selective Bloom (worldSelectiveBloom)
          </label>
          <label>
            Bloom preset (worldBloomPreset)
            <select value={worldBloomPreset} onChange={(event) => setWorldBloomPreset(event.target.value as BloomPreset)}>
              <option value="soft">soft</option>
              <option value="normal">normal</option>
              <option value="hot">hot</option>
            </select>
          </label>
          <label>
            System preset (worldSystemPreset)
            <select value={worldSystemPreset} onChange={(event) => setWorldSystemPreset(event.target.value === 'compact' ? 'compact' : 'normal')}>
              <option value="normal">normal</option>
              <option value="compact">compact</option>
            </select>
          </label>
          <label>
            Look preset (worldLookPreset)
            <select value={worldLookPreset} onChange={(event) => setWorldLookPreset(event.target.value === 'cinematic' ? 'cinematic' : 'clean')}>
              <option value="clean">clean</option>
              <option value="cinematic">cinematic</option>
            </select>
          </label>
          <label>
            Quality gate (worldQuality)
            <select value={worldQuality} onChange={(event) => setWorldQuality(event.target.value === 'high' ? 'high' : 'standard')}>
              <option value="standard">standard</option>
              <option value="high">high</option>
            </select>
          </label>
          <label>
            LUT intensity (worldLutIntensity)
            <input type="range" min={0} max={1} step={0.01} value={worldLutIntensity} onChange={(event) => setWorldLutIntensity(Number(event.target.value))} />
          </label>
          {developerMode ? (
            <label className="settings-toggle">
              <input type="checkbox" checked={worldDebugHUD} onChange={(event) => setWorldDebugHUD(event.target.checked)} />
              Показывать HUD (worldDebugHUD)
            </label>
          ) : null}
          <label className="settings-toggle">
            <input type="checkbox" checked={worldShowAllOrbits} onChange={(event) => setWorldShowAllOrbits(event.target.checked)} />
            Show all orbits (worldShowAllOrbits)
          </label>
          {developerMode ? (
            <label className="settings-toggle">
              <input type="checkbox" checked={worldAO} onChange={(event) => setWorldAO(event.target.checked)} />
              AO (worldAO, desktop + high only)
            </label>
          ) : null}
        </div>
        <div className="settings-actions">
          <SparkButton type="button" onClick={handleApplyWorldDebugSettings}>Применить и перезагрузить</SparkButton>
          <SparkButton type="button" onClick={handleHardCacheReset}>Сброс кэша и перезагрузка</SparkButton>
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
