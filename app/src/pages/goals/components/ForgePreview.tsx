interface ForgePreviewProps {
  coresMin: number
  coresMax: number
  weather: 'Штиль' | 'Ветер' | 'Шторм'
  risk: 'Низкий' | 'Средний' | 'Высокий'
}

export function ForgePreview({ coresMin, coresMax, weather, risk }: ForgePreviewProps) {
  const weatherValue = weather === 'Штиль' ? 1 : weather === 'Ветер' ? 2 : 3

  return (
    <section className="forge-preview">
      <h3>Что это даст</h3>
      <div className="forge-preview__cores">
        <span>Ядра</span>
        <strong>+{coresMin}…{coresMax}</strong>
      </div>
      <div className="forge-preview__line">
        <span>Погода</span>
        <div className="forge-preview__weather-scale" aria-label={`Погода: ${weather}`}>
          {[1, 2, 3].map((cell) => <i key={cell} className={cell <= weatherValue ? 'is-active' : ''} />)}
        </div>
        <strong>{weather}</strong>
      </div>
      <div className="forge-preview__line">
        <span>Риск перегруза</span>
        <strong>{risk}</strong>
      </div>
    </section>
  )
}
