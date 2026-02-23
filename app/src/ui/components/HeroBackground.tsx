import { useEffect, useMemo, useRef } from 'react'
import type { UiPreset } from '../appearance'

type HeroVariant = 'clean' | 'neon' | 'instrument' | 'warm'

interface HeroBackgroundProps {
  uiPreset: UiPreset
  worldLookPreset: string
}

interface VariantStyle {
  glow: string
  starsRgb: string
}

const VARIANT_STYLES: Record<HeroVariant, VariantStyle> = {
  clean: { glow: 'rgba(112, 189, 255, 0.18)', starsRgb: '160, 210, 255' },
  neon: { glow: 'rgba(136, 80, 255, 0.26)', starsRgb: '171, 255, 252' },
  instrument: { glow: 'rgba(94, 148, 216, 0.22)', starsRgb: '166, 198, 229' },
  warm: { glow: 'rgba(255, 161, 104, 0.24)', starsRgb: '255, 222, 156' },
}

function resolveVariant(uiPreset: UiPreset, worldLookPreset: string): HeroVariant {
  if (uiPreset === 'neon' || uiPreset === 'instrument' || uiPreset === 'warm') return uiPreset
  if (worldLookPreset === 'cinematic') return 'neon'
  return 'clean'
}

export function HeroBackground({ uiPreset, worldLookPreset }: HeroBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const variant = useMemo(() => resolveVariant(uiPreset, worldLookPreset), [uiPreset, worldLookPreset])

  useEffect(() => {
    const node = canvasRef.current
    if (!node) return
    const context = node.getContext('2d')
    if (!context) return

    const motion = document.documentElement.dataset.motion
    const reducedMotion = motion === 'reduced' || motion === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 1.8)
    const parent = node.parentElement
    if (!parent) return

    const stars = Array.from({ length: reducedMotion ? 22 : 52 }).map(() => ({
      x: Math.random(),
      y: Math.random(),
      radius: Math.random() * 1.6 + 0.2,
      alpha: Math.random() * 0.8 + 0.2,
      speed: Math.random() * 0.004 + 0.001,
      twinkle: Math.random() * Math.PI * 2,
    }))

    const orbits = Array.from({ length: 3 }).map((_, index) => ({
      radius: 0.18 + index * 0.14,
      width: 0.55 + index * 0.25,
      alpha: 0.16 + index * 0.04,
    }))

    const resize = () => {
      const bounds = parent.getBoundingClientRect()
      node.width = Math.max(1, Math.floor(bounds.width * dpr))
      node.height = Math.max(1, Math.floor(bounds.height * dpr))
      node.style.width = `${bounds.width}px`
      node.style.height = `${bounds.height}px`
    }

    resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(parent)

    const onPointerMove = (event: PointerEvent) => {
      if (reducedMotion) return
      const bounds = parent.getBoundingClientRect()
      const offsetX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 8
      const offsetY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 8
      parent.style.setProperty('--parallax-x', `${offsetX.toFixed(2)}px`)
      parent.style.setProperty('--parallax-y', `${offsetY.toFixed(2)}px`)
    }

    const onPointerLeave = () => {
      parent.style.setProperty('--parallax-x', '0px')
      parent.style.setProperty('--parallax-y', '0px')
    }

    parent.addEventListener('pointermove', onPointerMove)
    parent.addEventListener('pointerleave', onPointerLeave)

    const palette = VARIANT_STYLES[variant]
    let raf = 0
    let lastTick = 0
    const frameInterval = reducedMotion ? 1000 : 1000 / 24

    const draw = (time: number) => {
      raf = window.requestAnimationFrame(draw)
      if (!reducedMotion && time - lastTick < frameInterval) return
      lastTick = time

      const width = node.width
      const height = node.height
      context.clearRect(0, 0, width, height)

      const nebula = context.createRadialGradient(width * 0.5, height * 0.55, width * 0.08, width * 0.5, height * 0.55, width * 0.8)
      nebula.addColorStop(0, palette.glow)
      nebula.addColorStop(1, 'rgba(0,0,0,0)')
      context.fillStyle = nebula
      context.fillRect(0, 0, width, height)

      context.save()
      context.translate(width * 0.65, height * 0.45)
      context.rotate(-0.16)
      orbits.forEach((orbit) => {
        context.beginPath()
        context.ellipse(0, 0, width * orbit.radius, width * orbit.radius * orbit.width, 0, 0, Math.PI * 2)
        context.strokeStyle = `rgba(185, 221, 255, ${orbit.alpha})`
        context.lineWidth = 1.2 * dpr
        context.stroke()
      })
      context.restore()

      stars.forEach((star) => {
        star.twinkle += reducedMotion ? 0 : star.speed
        const twinkle = reducedMotion ? star.alpha : star.alpha * (0.6 + Math.sin(star.twinkle) * 0.4)
        context.beginPath()
        context.arc(star.x * width, star.y * height, star.radius * dpr, 0, Math.PI * 2)
        context.fillStyle = `rgba(${palette.starsRgb}, ${twinkle.toFixed(2)})`
        context.fill()
      })

      context.fillStyle = 'rgba(255,255,255,0.03)'
      for (let index = 0; index < 5; index += 1) {
        const y = ((time * 0.0008 * (index + 1)) % 1) * height
        context.fillRect(0, y, width, 0.8 * dpr)
      }
    }

    raf = window.requestAnimationFrame(draw)
    return () => {
      window.cancelAnimationFrame(raf)
      parent.removeEventListener('pointermove', onPointerMove)
      parent.removeEventListener('pointerleave', onPointerLeave)
      resizeObserver.disconnect()
    }
  }, [variant])

  return (
    <div className={`hero-background hero-background--${variant}`} aria-hidden="true">
      <div className="hero-background__gradient" />
      <canvas ref={canvasRef} className="hero-background__canvas" />
      <div className="hero-background__grain" />
    </div>
  )
}
