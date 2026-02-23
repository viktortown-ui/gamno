import { useMemo, useRef, useState, type ChangeEventHandler } from 'react'
import { clearAllData, exportDataBlob, importDataBlob, seedTestData } from '../core/storage/repo'
import type { AccentColor, AppearanceSettings, DensityMode, MotionMode, ThemeMode, UiPreset, WorldQuality } from '../ui/appearance'
import { SparkButton } from '../ui/SparkButton'
import { hardResetSiteAndReload } from '../core/cacheReset'
import { getWorldDebugHUDStorageKey, readWorldDebugHUDFlag, resolveWorldDeveloperMode, resolveWorldShowHud } from '../ui/components/worldDebugHUD'
import { resolveWorldDebugHUDPersistValue } from './settingsDebug'

type BloomPreset = 'soft' | 'normal' | 'hot'
type WorldSystemPreset = 'normal' | 'compact'
type WorldLookPreset = 'clean' | 'cinematic'

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
  const value = globalThis.localStorage?.getItem('worldQuality')
  if (value === 'high') return 'high'
  if (value === 'economy') return 'economy'
  return 'standard'
}

function readWorldLutIntensity(): number {
  const raw = Number(globalThis.localStorage?.getItem('worldLutIntensity'))
  if (!Number.isFinite(raw)) return 0.44
  return Math.min(1, Math.max(0, raw))
}

const presets: Array<{ id: UiPreset; title: string; description: string; accent: AccentColor; motion: MotionMode; transparency: AppearanceSettings['transparency']; look: WorldLookPreset }> = [
  { id: 'clean', title: 'Clean', description: 'Чисто, контрастно, минимум свечения.', accent: 'auto', motion: 'reduced', transparency: 'reduced', look: 'clean' },
  { id: 'neon', title: 'Neon', description: 'Циан/фиолет, ярче подсветки и контрасты.', accent: 'cyan', motion: 'normal', transparency: 'glass', look: 'cinematic' },
  { id: 'instrument', title: 'Instrument', description: 'Строго, матово, геометрично.', accent: 'blue', motion: 'reduced', transparency: 'reduced', look: 'clean' },
  { id: 'warm', title: 'Warm', description: 'Теплее оттенки и меньше синего.', accent: 'violet', motion: 'reduced', transparency: 'glass', look: 'clean' },
]

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
  const [restartHint, setRestartHint] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const worldDeveloperUnlockClicksRef = useRef(0)
  const [worldDeveloperOverrideEnabled, setWorldDeveloperOverrideEnabled] = useState(() => readFlag('worldDeveloper'))
  const developerMode = resolveWorldDeveloperMode({ isDev: import.meta.env.DEV, worldDeveloper: worldDeveloperOverrideEnabled })
  const worldDebugHUDEnabled = resolveWorldShowHud({ isDev: import.meta.env.DEV, worldDeveloper: worldDeveloperOverrideEnabled, worldDebugHUD })

  const debugSummary = useMemo(
    () => `Качество: ${worldQuality} · Стиль: ${worldLookPreset} · AO: ${worldAO ? 'ON' : 'OFF'} · Свечение: ${worldBloomPreset} · LUT: ${(worldLutIntensity * 100).toFixed(0)}% · Dev: ${developerMode ? 'ON' : 'OFF'}`,
    [developerMode, worldAO, worldBloomPreset, worldLookPreset, worldLutIntensity, worldQuality],
  )

  const persistWorldSettings = (next: {
    orbitDim?: boolean
    selectiveBloom?: boolean
    showAllOrbits?: boolean
    bloomPreset?: BloomPreset
    systemPreset?: WorldSystemPreset
    lookPreset?: WorldLookPreset
    quality?: WorldQuality
    ao?: boolean
    lut?: number
    hud?: boolean
  }) => {
    if (typeof window === 'undefined') return
    if (next.orbitDim !== undefined) window.localStorage.setItem('worldOrbitDim', next.orbitDim ? '1' : '0')
    if (next.selectiveBloom !== undefined) window.localStorage.setItem('worldSelectiveBloom', next.selectiveBloom ? '1' : '0')
    if (next.showAllOrbits !== undefined) window.localStorage.setItem('worldShowAllOrbits', next.showAllOrbits ? '1' : '0')
    if (next.bloomPreset !== undefined) window.localStorage.setItem('worldBloomPreset', next.bloomPreset)
    if (next.systemPreset !== undefined) window.localStorage.setItem('worldSystemPreset', next.systemPreset)
    if (next.lookPreset !== undefined) window.localStorage.setItem('worldLookPreset', next.lookPreset)
    if (next.quality !== undefined) window.localStorage.setItem('worldQuality', next.quality === 'high' ? 'high' : next.quality === 'economy' ? 'economy' : 'standard')
    if (next.ao !== undefined) window.localStorage.setItem('worldAO', next.ao ? '1' : '0')
    if (next.lut !== undefined) window.localStorage.setItem('worldLutIntensity', next.lut.toFixed(2))
    if (next.hud !== undefined) window.localStorage.setItem(getWorldDebugHUDStorageKey(), resolveWorldDebugHUDPersistValue({ developerMode, worldDebugHUD: next.hud }))
    setRestartHint(true)
  }

  const handleClear = async () => {
    if (!window.confirm('Это удалит все данные локально на этом устройстве.')) return
    await clearAllData()
    await onDataChanged()
  }

  const handleExport = async () => {
    const blob = await exportDataBlob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const date = new Date().toLocaleDateString('ru-RU').replace(/\./g, '-')
    link.href = url
    link.download = `concorer-backup-${date}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImport: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!window.confirm('Перезаписать локальные данные этим файлом?')) return
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

  const handleResetSettingsOnly = () => {
    if (!window.confirm('Сбросить только настройки интерфейса и графики? Данные не удаляются.')) return
    onAppearanceChange({ ...appearance, theme: 'system', motion: 'normal', transparency: 'glass', worldUiVariant: 'instrument', worldRenderMode: 'webgl', worldLookPreset: 'clean', worldQuality: 'standard', uiPreset: 'clean', accentColor: 'auto', density: 'normal', fxEnabled: true, uiSoundEnabled: false, uiSoundVolume: 70 })
    setWorldOrbitDim(false)
    setWorldSelectiveBloom(false)
    setWorldShowAllOrbits(false)
    setWorldBloomPreset('normal')
    setWorldSystemPreset('normal')
    setWorldLookPreset('clean')
    setWorldQuality('standard')
    setWorldAO(false)
    setWorldLutIntensity(0.44)
    setWorldDebugHUD(false)
    persistWorldSettings({ orbitDim: false, selectiveBloom: false, showAllOrbits: false, bloomPreset: 'normal', systemPreset: 'normal', lookPreset: 'clean', quality: 'standard', ao: false, lut: 0.44, hud: false })
  }

  const handleSettingsTitleClick = () => {
    worldDeveloperUnlockClicksRef.current += 1
    if (worldDeveloperUnlockClicksRef.current < 7) return
    worldDeveloperUnlockClicksRef.current = 0
    const enabled = !worldDeveloperOverrideEnabled
    globalThis.localStorage?.setItem('worldDeveloper', enabled ? '1' : '0')
    setWorldDeveloperOverrideEnabled(enabled)
  }

  const applyPreset = (preset: typeof presets[number]) => {
    onAppearanceChange({ ...appearance, uiPreset: preset.id, accentColor: preset.accent, motion: preset.motion, transparency: preset.transparency, worldLookPreset: preset.look, worldUiVariant: preset.id === 'instrument' ? 'instrument' : 'cinematic', fxEnabled: preset.id !== 'clean' })
  }

  const changeTheme = (theme: ThemeMode) => onAppearanceChange({ ...appearance, theme })
  const changeAccent = (accentColor: AccentColor) => onAppearanceChange({ ...appearance, accentColor })
  const changeDensity = (density: DensityMode) => onAppearanceChange({ ...appearance, density })
  const changeMotion = (motion: MotionMode) => onAppearanceChange({ ...appearance, motion })

  return (
    <section className="page settings-page">
      <header className="settings-head panel">
        <div>
          <h1 onClick={handleSettingsTitleClick} style={{ cursor: 'default' }}>Настройки</h1>
          <p>Данные хранятся локально на этом устройстве (IndexedDB).</p>
        </div>
        <span className="settings-version-badge">Сборка: {import.meta.env.MODE}</span>
      </header>

      {restartHint ? (
        <article className="panel settings-restart-hint" role="status" aria-live="polite">
          <p>Часть графических изменений будет полностью видна после перезапуска мира.</p>
          <SparkButton type="button" onClick={() => window.location.reload()}>Перезапустить мир</SparkButton>
        </article>
      ) : null}

      <article className="panel settings-card">
        <h2>Внешний вид — пресеты</h2>
        <p>Быстро меняют цвета, контраст, прозрачность и характер интерфейса.</p>
        <div className="settings-presets" role="radiogroup" aria-label="Быстрые пресеты">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`preset-card ${appearance.uiPreset === preset.id ? 'preset-card--active' : ''}`}
              onClick={() => applyPreset(preset)}
              role="radio"
              aria-checked={appearance.uiPreset === preset.id}
            >
              <strong>{preset.title}</strong>
              <span>{preset.description}</span>
              <span className="preset-mini-preview" aria-hidden="true" />
            </button>
          ))}
        </div>
      </article>

      <article className="panel settings-card">
        <h2>Внешний вид</h2>
        <div className="settings-grid">
          <div>
            <h3>Тема</h3>
            <p>Выберите как выглядят светлые/тёмные поверхности.</p>
            <div className="segmented" role="radiogroup" aria-label="Тема">
              {([
                ['dark', 'Тёмная'],
                ['light', 'Светлая'],
                ['system', 'Системная'],
              ] as Array<[ThemeMode, string]>).map(([value, label]) => (
                <button key={value} type="button" className={appearance.theme === value ? 'is-active' : ''} onClick={() => changeTheme(value)}>{label}</button>
              ))}
            </div>
          </div>
          <div>
            <h3>Акцентный цвет</h3>
            <p>Основной цвет подсветки кнопок и активных состояний.</p>
            <div className="chips-row" role="radiogroup" aria-label="Акцентный цвет">
              {([
                ['cyan', 'Циан'],
                ['violet', 'Фиолет'],
                ['blue', 'Синий'],
                ['auto', 'Авто'],
              ] as Array<[AccentColor, string]>).map(([value, label]) => (
                <button key={value} type="button" className={`chip-button ${appearance.accentColor === value ? 'is-active' : ''}`} onClick={() => changeAccent(value)}>{label}</button>
              ))}
            </div>
          </div>
          <div>
            <h3>Плотность интерфейса</h3>
            <p>Обычная, компактная или крупная плотность элементов.</p>
            <div className="segmented" role="radiogroup" aria-label="Плотность интерфейса">
              {([
                ['normal', 'Обычная'],
                ['compact', 'Компактная'],
                ['comfortable', 'Крупная'],
              ] as Array<[DensityMode, string]>).map(([value, label]) => (
                <button key={value} type="button" className={appearance.density === value ? 'is-active' : ''} onClick={() => changeDensity(value)}>{label}</button>
              ))}
            </div>
          </div>
        </div>
      </article>

      <article className="panel settings-card">
        <h2>Движение и эффекты</h2>
        <div className="settings-grid">
          <div>
            <h3>Анимации</h3>
            <p>Скорость и интенсивность движения интерфейса.</p>
            <div className="segmented" role="radiogroup" aria-label="Анимации">
              {([
                ['normal', 'Обычные'],
                ['reduced', 'Умеренные'],
                ['off', 'Выключить'],
              ] as Array<[MotionMode, string]>).map(([value, label]) => (
                <button key={value} type="button" className={appearance.motion === value ? 'is-active' : ''} onClick={() => changeMotion(value)}>{label}</button>
              ))}
            </div>
          </div>
          <label className="switch-row">
            <span>
              <strong>Эффекты интерфейса (FX)</strong>
              <small>Свечение, мягкие тени и стеклянные эффекты.</small>
            </span>
            <input type="checkbox" checked={appearance.fxEnabled} onChange={(event) => onAppearanceChange({ ...appearance, fxEnabled: event.target.checked })} />
          </label>
          <label className="switch-row">
            <span>
              <strong>Звуки интерфейса</strong>
              <small>Короткий отклик при действиях в UI.</small>
            </span>
            <input type="checkbox" checked={appearance.uiSoundEnabled} onChange={(event) => onAppearanceChange({ ...appearance, uiSoundEnabled: event.target.checked })} />
          </label>
          {appearance.uiSoundEnabled ? (
            <label>
              Громкость звуков
              <input type="range" min={0} max={100} step={1} value={appearance.uiSoundVolume} onChange={(event) => onAppearanceChange({ ...appearance, uiSoundVolume: Number(event.target.value) })} />
            </label>
          ) : null}
        </div>
      </article>

      <article className="panel settings-card">
        <h2>Графика мира</h2>
        <p>Если тормозит — ставьте «Эконом».</p>
        <div className="segmented" role="radiogroup" aria-label="Качество мира">
          {([
            ['economy', 'Эконом'],
            ['standard', 'Стандарт'],
            ['high', 'Высокое'],
          ] as Array<[WorldQuality, string]>).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={worldQuality === value ? 'is-active' : ''}
              onClick={() => {
                setWorldQuality(value)
                persistWorldSettings({ quality: value })
                onAppearanceChange({ ...appearance, worldQuality: value })
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <SparkButton type="button" onClick={() => setAdvancedOpen((value) => !value)}>
          {advancedOpen ? 'Скрыть продвинутые настройки графики' : 'Продвинутые настройки графики'}
        </SparkButton>
      </article>

      {advancedOpen ? (
        <article className="panel settings-card settings-advanced">
          <h2>Продвинутые</h2>
          <p>Внимание: может влиять на FPS и внешний вид.</p>
          <p className="settings-debug-status">{debugSummary}</p>
          <div className="settings-debug-grid">
            <label className="switch-row">
              <span>
                <strong>Затемнять орбиты</strong>
                <small>Делает дальние орбиты менее заметными.</small>
              </span>
              <input type="checkbox" checked={worldOrbitDim} onChange={(event) => { setWorldOrbitDim(event.target.checked); persistWorldSettings({ orbitDim: event.target.checked }) }} />
            </label>
            <label className="switch-row">
              <span>
                <strong>Подсветка выбранного</strong>
                <small>Дополнительный свет вокруг выбранного объекта.</small>
              </span>
              <input type="checkbox" checked={worldSelectiveBloom} onChange={(event) => { setWorldSelectiveBloom(event.target.checked); persistWorldSettings({ selectiveBloom: event.target.checked }) }} />
            </label>
            <label className="switch-row">
              <span>
                <strong>Показывать все орбиты</strong>
                <small>Отключает скрытие второстепенных орбит.</small>
              </span>
              <input type="checkbox" checked={worldShowAllOrbits} onChange={(event) => { setWorldShowAllOrbits(event.target.checked); persistWorldSettings({ showAllOrbits: event.target.checked }) }} />
            </label>
            <label>
              Свечение
              <select value={worldBloomPreset} onChange={(event) => { const value = event.target.value as BloomPreset; setWorldBloomPreset(value); persistWorldSettings({ bloomPreset: value }) }}>
                <option value="soft">Выкл</option>
                <option value="normal">Мягкое</option>
                <option value="hot">Яркое</option>
              </select>
            </label>
            <label>
              Стиль рендера
              <select value={worldSystemPreset} onChange={(event) => { const value = event.target.value === 'compact' ? 'compact' : 'normal'; setWorldSystemPreset(value); persistWorldSettings({ systemPreset: value }) }}>
                <option value="normal">Обычный</option>
                <option value="compact">Компактный</option>
              </select>
            </label>
            <label>
              Цветокоррекция: {Math.round(worldLutIntensity * 100)}
              <input type="range" min={0} max={1} step={0.01} value={worldLutIntensity} onChange={(event) => { const value = Number(event.target.value); setWorldLutIntensity(value); persistWorldSettings({ lut: value }) }} />
            </label>
            {developerMode ? (
              <label className="switch-row">
                <span>
                  <strong>Показывать HUD</strong>
                  <small>Служебная информация рендера поверх мира.</small>
                </span>
                <input type="checkbox" checked={worldDebugHUD} onChange={(event) => { setWorldDebugHUD(event.target.checked); persistWorldSettings({ hud: event.target.checked }) }} />
              </label>
            ) : null}
            {developerMode ? (
              <label className="switch-row">
                <span>
                  <strong>Ambient Occlusion</strong>
                  <small>Дополнительная глубина света (тяжелее для GPU).</small>
                </span>
                <input type="checkbox" checked={worldAO} onChange={(event) => { setWorldAO(event.target.checked); persistWorldSettings({ ao: event.target.checked }) }} />
              </label>
            ) : null}
          </div>

          <div className="settings-dev-tools">
            <h3>Для разработчика</h3>
            {developerMode ? <small className="mono">Dev mode: ON · HUD: {worldDebugHUDEnabled ? 'ON' : 'OFF'}</small> : null}
            <div className="settings-actions">
              <SparkButton type="button" onClick={handleHardCacheReset}>Сброс кэша и перезагрузка</SparkButton>
              <SparkButton type="button" onClick={handleSeed}>Сгенерировать тестовые данные (30 дней)</SparkButton>
            </div>
          </div>
        </article>
      ) : null}

      <article className="panel settings-card">
        <h2>Данные</h2>
        <div className="settings-actions">
          <SparkButton type="button" onClick={handleExport}>Экспорт данных</SparkButton>
          <label className="import-label">Импорт данных<input type="file" onChange={handleImport} /></label>
          <SparkButton type="button" className="danger" onClick={handleClear}>Очистить данные</SparkButton>
          <SparkButton type="button" onClick={handleResetSettingsOnly}>Сбросить только настройки</SparkButton>
        </div>
      </article>
    </section>
  )
}
