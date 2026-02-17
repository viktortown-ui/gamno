import { useMemo } from 'react'

interface Star {
  x: number
  y: number
  radius: number
  opacity: number
}

export function Starfield() {
  const stars = useMemo<Star[]>(() => Array.from({ length: 80 }, (_, index) => ({
    x: (index * 67) % 100,
    y: (index * 37) % 100,
    radius: 0.4 + ((index * 17) % 10) / 20,
    opacity: 0.15 + ((index * 13) % 10) / 40,
  })), [])

  return (
    <div className="starfield" aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {stars.map((star) => (
          <circle
            key={`${star.x}-${star.y}`}
            cx={star.x}
            cy={star.y}
            r={star.radius}
            fill="currentColor"
            opacity={star.opacity}
          />
        ))}
      </svg>
    </div>
  )
}
