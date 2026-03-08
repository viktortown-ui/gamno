import { useMemo, useState, type ChangeEventHandler } from 'react'
import { clearAllData, exportDataBlob, importDataBlob, seedTestData } from '../core/storage/repo'
import type { AppearanceSettings, DensityMode, MotionMode, UiPreset, WorldQuality } from '../ui/appearance'
import { SparkButton } from '../ui/SparkButton'
import { hardResetSiteAndReload } from '../core/cacheReset'

type BloomPreset = 'soft' | 'normal' | 'hot'
type WorldSystemPreset = 'normal' | 'compact'
type WorldLookPreset = 'clean' | 'cinematic'
type ExpertMode = 'basic' | 'pro'

interface SettingsPageProps {
  onDataChanged: () => Promise<void>
  appearance: AppearanceSettings
  onAppearanceChange: (next: AppearanceSettings) => void
}

interface ThemePack {
  id: string
  uiPreset: UiPreset
  title: string
  description: string
  character: string
  apply: (appearance: AppearanceSettings) => AppearanceSettings
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
  return globalThis.localStorage?.getItem('worldSystemPreset') === 'compact' ? 'compact' : 'normal'
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

function formatBackupTime(value: number | null): string {
  if (!value) return 'Резервная копия ещё не создавалась.'
  return `Последняя резервная копия: ${new Date(value).toLocaleString('ru-RU')}`
}

const THEME_PACKS: ThemePack[] = [
  {
    id: 'instrumental',
    uiPreset: 'instrument',
    title: 'Приборный',
    description: 'Строгая инженерная подача, матовые поверхности и минимум свечения.',
    character: 'Для долгой работы и максимальной ясности',
    apply: (current) => ({ ...current, uiPreset: 'instrument', accentColor: 'blue', motion: 'reduced', transparency: 'reduced', density: 'normal', fxEnabled: false, worldLookPreset: 'clean', worldUiVariant: 'instrument' }),
  },
  {
    id: 'neon',
    uiPreset: 'neon',
    title: 'Неон',
    description: 'Яркая контрастная тема с сильными акцентами и живым научно-фантастическим настроением.',
    character: 'Для демонстрации и сильного визуального эффекта',
    apply: (current) => ({ ...current, uiPreset: 'neon', accentColor: 'cyan', motion: 'normal', transparency: 'glass', density: 'normal', fxEnabled: true, worldLookPreset: 'cinematic', worldUiVariant: 'cinematic' }),
  },
  {
    id: 'deep-space',
    uiPreset: 'neon',
    title: 'Глубокий космос',
    description: 'Атмосферная глубина, мягкие градиенты и ощущение объёма пространства.',
    character: 'Для погружения и визуальной атмосферы',
    apply: (current) => ({ ...current, uiPreset: 'neon', accentColor: 'violet', motion: 'reduced', transparency: 'glass', density: 'comfortable', fxEnabled: true, worldLookPreset: 'cinematic', worldUiVariant: 'cinematic' }),
  },
  {
    id: 'warm-outline',
    uiPreset: 'warm',
    title: 'Тёплый контур',
    description: 'Мягкий тёплый баланс цвета без холодного доминирования синего.',
    character: 'Для спокойной ежедневной работы',
    apply: (current) => ({ ...current, uiPreset: 'warm', accentColor: 'violet', motion: 'reduced', transparency: 'glass', density: 'normal', fxEnabled: true, worldLookPreset: 'clean', worldUiVariant: 'instrument' }),
  },
  {
    id: 'clean-contrast',
    uiPreset: 'clean',
    title: 'Чистый контраст',
    description: 'Минимализм и высокая читаемость, эффекты сведены к минимуму.',
    character: 'Для высокой читаемости и концентрации',
    apply: (current) => ({ ...current, uiPreset: 'clean', accentColor: 'auto', motion: 'off', transparency: 'reduced', density: 'compact', fxEnabled: false, worldLookPreset: 'clean', worldUiVariant: 'instrument' }),
  },
]

export function SettingsPage({ onDataChanged, appearance, onAppearanceChange }: SettingsPageProps) {
  const [mode, setMode] = useState<ExpertMode>('basic')
  const [search, setSearch] = useState('')
  const [advancedThemeOpen, setAdvancedThemeOpen] = useState(false)
  const [themeChoice, setThemeChoice] = useState(() => globalThis.localStorage?.getItem('settingsThemeChoice') ?? 'instrumental')
  const [worldOrbitDim, setWorldOrbitDim] = useState(() => readFlag('worldOrbitDim'))
  const [worldSelectiveBloom, setWorldSelectiveBloom] = useState(() => readFlag('worldSelectiveBloom'))
  const [worldShowAllOrbits, setWorldShowAllOrbits] = useState(() => readFlag('worldShowAllOrbits'))
  const [worldBloomPreset, setWorldBloomPreset] = useState<BloomPreset>(() => readBloomPreset())
  const [worldSystemPreset, setWorldSystemPreset] = useState<WorldSystemPreset>(() => readWorldSystemPreset())
  const [worldLookPreset, setWorldLookPreset] = useState<WorldLookPreset>(() => readWorldLookPreset())
  const [worldQuality, setWorldQuality] = useState<WorldQuality>(() => readWorldQuality())
  const [worldAO, setWorldAO] = useState(() => readFlag('worldAO'))
  const [worldLutIntensity, setWorldLutIntensity] = useState(() => readWorldLutIntensity())
  const [backupTimestamp, setBackupTimestamp] = useState<number | null>(() => {
    const raw = Number(globalThis.localStorage?.getItem('settingsBackupTimestamp'))
    return Number.isFinite(raw) && raw > 0 ? raw : null
  })

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
  }) => {
    if (typeof window === 'undefined') return
    if (next.orbitDim !== undefined) window.localStorage.setItem('worldOrbitDim', next.orbitDim ? '1' : '0')
    if (next.selectiveBloom !== undefined) window.localStorage.setItem('worldSelectiveBloom', next.selectiveBloom ? '1' : '0')
    if (next.showAllOrbits !== undefined) window.localStorage.setItem('worldShowAllOrbits', next.showAllOrbits ? '1' : '0')
    if (next.bloomPreset !== undefined) window.localStorage.setItem('worldBloomPreset', next.bloomPreset)
    if (next.systemPreset !== undefined) window.localStorage.setItem('worldSystemPreset', next.systemPreset)
    if (next.lookPreset !== undefined) window.localStorage.setItem('worldLookPreset', next.lookPreset)
    if (next.quality !== undefined) window.localStorage.setItem('worldQuality', next.quality)
    if (next.ao !== undefined) window.localStorage.setItem('worldAO', next.ao ? '1' : '0')
    if (next.lut !== undefined) window.localStorage.setItem('worldLutIntensity', String(next.lut))
    setWorldQuality(readWorldQuality())
  }

  const handleExport = async () => {
    const blob = await exportDataBlob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gamno-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCreateBackup = async () => {
    await handleExport()
    const now = Date.now()
    globalThis.localStorage?.setItem('settingsBackupTimestamp', String(now))
    setBackupTimestamp(now)
  }

  const handleImport: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    await importDataBlob(file)
    await onDataChanged()
    event.target.value = ''
  }

  const handleClear = async () => {
    if (!window.confirm('Очистить все данные? Это действие нельзя отменить.')) return
    await clearAllData()
    await onDataChanged()
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
    persistWorldSettings({ orbitDim: false, selectiveBloom: false, showAllOrbits: false, bloomPreset: 'normal', systemPreset: 'normal', lookPreset: 'clean', quality: 'standard', ao: false, lut: 0.44 })
  }

  const handleHardCacheReset = async () => {
    if (!window.confirm('Сбросить кэш приложения и перезагрузить страницу?')) return
    await hardResetSiteAndReload()
  }

  const visibleSections = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return new Set(['data', 'appearance', 'behavior', 'world', 'sound', 'tools', 'system'])
    const byText: Array<[string, string]> = [
      ['data', 'данные безопасность резерв копия импорт экспорт очистить сброс'],
      ['appearance', 'внешний вид тема контраст неон тонкая настройка яркость прозрачность'],
      ['behavior', 'поведение интерфейса'],
      ['world', 'мир и графика'],
      ['sound', 'звук и отклик'],
      ['tools', 'инструменты и подсказки'],
      ['system', 'разработчика система'],
    ]
    return new Set(byText.filter((item) => item[1].includes(query)).map((item) => item[0]))
  }, [search])

  const selectedTheme = THEME_PACKS.find((theme) => theme.id === themeChoice) ?? THEME_PACKS[0]

  return (
    <section className="page settings-page settings-v2">
      <header className="panel settings-v2__head">
        <div>
          <h1>Настройки</h1>
          <p>Единый центр управления: главное — сверху, глубокие параметры — ниже.</p>
        </div>
        <div className="settings-v2__controls">
          <label>
            Поиск по настройкам
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Например: резервная копия, контраст, звук" />
          </label>
          <div className="segmented" role="radiogroup" aria-label="Режим настроек">
            <button type="button" className={mode === 'basic' ? 'is-active' : ''} onClick={() => setMode('basic')}>Базовый</button>
            <button type="button" className={mode === 'pro' ? 'is-active' : ''} onClick={() => setMode('pro')}>Профи</button>
          </div>
        </div>
      </header>

      {visibleSections.has('data') ? (
        <section className="panel settings-sector" aria-label="Данные и безопасность">
          <h2>Данные и безопасность</h2>
          <p>Управляйте резервным копированием и восстановлением. Опасные действия вынесены отдельно.</p>
          <p className="settings-sector__status">{formatBackupTime(backupTimestamp)}</p>
          <div className="settings-rows">
            <div className="settings-row"><div><strong>Экспорт данных</strong><small>Скачать все локальные данные в файл.</small></div><SparkButton type="button" onClick={handleExport}>Экспортировать</SparkButton></div>
            <div className="settings-row"><div><strong>Импорт данных</strong><small>Восстановить данные из ранее сохранённого файла.</small></div><label className="import-label">Выбрать файл<input type="file" onChange={handleImport} /></label></div>
            <div className="settings-row"><div><strong>Создать резервную копию</strong><small>Сделать новую копию перед важными изменениями.</small></div><SparkButton type="button" onClick={handleCreateBackup}>Создать копию</SparkButton></div>
          </div>
          <div className="settings-danger-zone">
            <p>⚠️ Опасная зона: удаление данных необратимо.</p>
            <div className="settings-actions">
              <SparkButton type="button" className="danger" onClick={handleClear}>Очистить данные</SparkButton>
              <SparkButton type="button" onClick={handleResetSettingsOnly}>Сбросить только настройки</SparkButton>
            </div>
          </div>
        </section>
      ) : null}

      {visibleSections.has('appearance') ? (
        <section className="panel settings-sector settings-sector--appearance" aria-label="Внешний вид">
          <h2>Внешний вид</h2>
          <p>Сначала выберите готовую тему. Тонкие переопределения доступны ниже.</p>
          <div className="settings-theme-grid" role="radiogroup" aria-label="Готовые темы">
            {THEME_PACKS.map((theme) => (
              <button key={theme.id} type="button" className={`theme-card ${themeChoice === theme.id ? 'theme-card--active' : ''}`} onClick={() => { onAppearanceChange(theme.apply(appearance)); setThemeChoice(theme.id); globalThis.localStorage?.setItem('settingsThemeChoice', theme.id) }} role="radio" aria-checked={themeChoice === theme.id}>
                <strong>{theme.title}</strong>
                <span>{theme.description}</span>
                <em>{theme.character}</em>
                <span className={`theme-preview theme-preview--${theme.id}`} aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="settings-expand">
            <button type="button" className="button-secondary" onClick={() => setAdvancedThemeOpen((prev) => !prev)}>
              {advancedThemeOpen ? 'Скрыть тонкую настройку темы' : 'Показать тонкую настройку темы'}
            </button>
            {(mode === 'pro' || advancedThemeOpen) ? (
              <div className="settings-rows settings-rows--advanced">
                <div className="settings-row"><div><strong>Яркость акцентов</strong><small>Определяет заметность активных кнопок и маркеров.</small></div><div className="segmented"><button type="button" className={appearance.accentColor === 'auto' ? 'is-active' : ''} onClick={() => onAppearanceChange({ ...appearance, accentColor: 'auto' })}>Сбалансировано</button><button type="button" className={appearance.accentColor === 'cyan' ? 'is-active' : ''} onClick={() => onAppearanceChange({ ...appearance, accentColor: 'cyan' })}>Ярче</button><button type="button" className={appearance.accentColor === 'violet' ? 'is-active' : ''} onClick={() => onAppearanceChange({ ...appearance, accentColor: 'violet' })}>Мягче</button></div></div>
                <div className="settings-row"><div><strong>Сила свечения</strong><small>Влияет на «живость» интерфейса и лёгкость восприятия.</small></div><label className="switch-row"><span><small>Сильное свечение может отвлекать.</small></span><input type="checkbox" checked={appearance.fxEnabled} onChange={(event) => onAppearanceChange({ ...appearance, fxEnabled: event.target.checked })} /></label></div>
                <div className="settings-row"><div><strong>Контраст и прозрачность панелей</strong><small>Больше контраста — выше читаемость, меньше прозрачности — строже вид.</small></div><div className="segmented"><button type="button" className={appearance.transparency === 'reduced' ? 'is-active' : ''} onClick={() => onAppearanceChange({ ...appearance, transparency: 'reduced' })}>Жёсткий контраст</button><button type="button" className={appearance.transparency === 'glass' ? 'is-active' : ''} onClick={() => onAppearanceChange({ ...appearance, transparency: 'glass' })}>Больше глубины</button></div></div>
                <div className="settings-row"><div><strong>Плотность интерфейса</strong><small>Компактнее — больше информации, крупнее — легче читать.</small></div><div className="segmented">{([
                  ['compact', 'Компактно'],
                  ['normal', 'Обычно'],
                  ['comfortable', 'Крупнее'],
                ] as Array<[DensityMode, string]>).map(([value, label]) => <button key={value} type="button" className={appearance.density === value ? 'is-active' : ''} onClick={() => onAppearanceChange({ ...appearance, density: value })}>{label}</button>)}</div></div>
                <div className="settings-row"><div><strong>Скорость анимации</strong><small>Отключение анимации может снизить нагрузку на устройство.</small></div><div className="segmented">{([
                  ['normal', 'Обычная'],
                  ['reduced', 'Умеренная'],
                  ['off', 'Без анимации'],
                ] as Array<[MotionMode, string]>).map(([value, label]) => <button key={value} type="button" className={appearance.motion === value ? 'is-active' : ''} onClick={() => onAppearanceChange({ ...appearance, motion: value })}>{label}</button>)}</div></div>
                <div className="settings-row"><div><strong>Подсветка орбит и стиль мира</strong><small>Глубокий слой визуализации. Может влиять на производительность.</small></div><div className="settings-grid-inline"><label className="switch-row"><span><small>Тусклые орбиты</small></span><input type="checkbox" checked={worldOrbitDim} onChange={(event) => { const value = event.target.checked; setWorldOrbitDim(value); persistWorldSettings({ orbitDim: value }) }} /></label><label className="switch-row"><span><small>Выделять только активные орбиты</small></span><input type="checkbox" checked={worldSelectiveBloom} onChange={(event) => { const value = event.target.checked; setWorldSelectiveBloom(value); persistWorldSettings({ selectiveBloom: value }) }} /></label><label className="switch-row"><span><small>Показывать все орбиты сразу</small></span><input type="checkbox" checked={worldShowAllOrbits} onChange={(event) => { const value = event.target.checked; setWorldShowAllOrbits(value); persistWorldSettings({ showAllOrbits: value }) }} /></label></div></div>
                <div className="settings-row"><div><strong>Параметры графики мира</strong><small>Прямо влияют на нагрузку процессора и видеоускорителя.</small></div><div className="settings-grid-inline"><label>Качество мира<select value={worldQuality} onChange={(event) => { const value = event.target.value === 'economy' || event.target.value === 'high' ? event.target.value : 'standard'; setWorldQuality(value); persistWorldSettings({ quality: value }) }}><option value="economy">Эконом</option><option value="standard">Стандарт</option><option value="high">Высокое</option></select></label><label>Стиль подсветки<select value={worldBloomPreset} onChange={(event) => { const value = event.target.value === 'soft' || event.target.value === 'hot' ? event.target.value : 'normal'; setWorldBloomPreset(value); persistWorldSettings({ bloomPreset: value }) }}><option value="soft">Мягкий</option><option value="normal">Сбалансированный</option><option value="hot">Интенсивный</option></select></label><label>Компоновка мира<select value={worldSystemPreset} onChange={(event) => { const value = event.target.value === 'compact' ? 'compact' : 'normal'; setWorldSystemPreset(value); persistWorldSettings({ systemPreset: value }) }}><option value="normal">Обычная</option><option value="compact">Компактная</option></select></label><label>Стиль поверхности<select value={worldLookPreset} onChange={(event) => { const value = event.target.value === 'cinematic' ? 'cinematic' : 'clean'; setWorldLookPreset(value); persistWorldSettings({ lookPreset: value }) }}><option value="clean">Чистый</option><option value="cinematic">Кинематографичный</option></select></label><label className="switch-row"><span><small>Объёмное затенение (нагрузка на графику)</small></span><input type="checkbox" checked={worldAO} onChange={(event) => { const value = event.target.checked; setWorldAO(value); persistWorldSettings({ ao: value }) }} /></label></div></div>
                <div className="settings-row"><div><strong>Цветокоррекция</strong><small>Подстраивает тон изображения мира под выбранную тему.</small></div><label>Интенсивность: {Math.round(worldLutIntensity * 100)}<input type="range" min={0} max={1} step={0.01} value={worldLutIntensity} onChange={(event) => { const value = Number(event.target.value); setWorldLutIntensity(value); persistWorldSettings({ lut: value }) }} /></label></div>
              </div>
            ) : null}
          </div>
          <p className="settings-sector__status">Активная тема: {selectedTheme.title}.</p>
        </section>
      ) : null}

      {visibleSections.has('behavior') ? <section className="panel settings-sector settings-placeholder"><h2>Поведение интерфейса</h2><p>Каркас шага 2: логика подсказок, автофокус и поведение виджетов.</p></section> : null}
      {visibleSections.has('world') ? <section className="panel settings-sector settings-placeholder"><h2>Мир и графика</h2><p>Каркас шага 2: производительность, сцена мира и визуальные профили.</p></section> : null}
      {visibleSections.has('sound') ? <section className="panel settings-sector settings-placeholder"><h2>Звук и отклик</h2><p>Каркас шага 2: звуковые события, громкость каналов и тактильные отклики.</p></section> : null}
      {visibleSections.has('tools') ? <section className="panel settings-sector settings-placeholder"><h2>Инструменты и подсказки</h2><p>Каркас шага 2: интеллектуальные подсказки, быстрые действия и сценарии.</p></section> : null}
      {visibleSections.has('system') ? <section className="panel settings-sector settings-placeholder"><h2>Для разработчика / Система</h2><p>Каркас шага 2: диагностика, служебные флаги и восстановление приложения.</p><div className="settings-actions"><SparkButton type="button" onClick={handleHardCacheReset}>Сброс кэша и перезагрузка</SparkButton><SparkButton type="button" onClick={handleSeed}>Сгенерировать тестовые данные</SparkButton></div></section> : null}
    </section>
  )
}
