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
  orbitRgb: string
  planetCore: string
  planetRim: string
  shield: string
}

const VARIANT_STYLES: Record<HeroVariant, VariantStyle> = {
  clean: { glow: 'rgba(112, 189, 255, 0.18)', starsRgb: '160, 210, 255', orbitRgb: '168, 214, 255', planetCore: 'rgba(156, 214, 255, 0.95)', planetRim: 'rgba(89, 136, 255, 0.85)', shield: 'rgba(171, 233, 255, 0.4)' },
  neon: { glow: 'rgba(136, 80, 255, 0.26)', starsRgb: '171, 255, 252', orbitRgb: '214, 142, 255', planetCore: 'rgba(255, 165, 255, 0.95)', planetRim: 'rgba(84, 42, 255, 0.9)', shield: 'rgba(84, 246, 255, 0.42)' },
  instrument: { glow: 'rgba(94, 148, 216, 0.22)', starsRgb: '166, 198, 229', orbitRgb: '171, 198, 226', planetCore: 'rgba(169, 202, 235, 0.92)', planetRim: 'rgba(71, 112, 172, 0.9)', shield: 'rgba(150, 198, 246, 0.38)' },
  warm: { glow: 'rgba(255, 161, 104, 0.24)', starsRgb: '255, 222, 156', orbitRgb: '255, 201, 143', planetCore: 'rgba(255, 207, 163, 0.96)', planetRim: 'rgba(190, 86, 45, 0.9)', shield: 'rgba(255, 214, 153, 0.44)' },
}

function resolveVariant(uiPreset: UiPreset, worldLookPreset: string): HeroVariant {
  if (uiPreset === 'neon' || uiPreset === 'instrument' || uiPreset === 'warm') return uiPreset
  if (worldLookPreset === 'cinematic') return 'neon'
  return 'clean'
}

export function HeroBackground({ uiPreset, worldLookPreset }: HeroBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
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

    const starsFine = Array.from({ length: reducedMotion ? 24 : 54 }).map(() => ({
      x: Math.random(),
      y: Math.random(),
      radius: Math.random() * 1.6 + 0.2,
      alpha: Math.random() * 0.8 + 0.2,
      speed: Math.random() * 0.004 + 0.001,
      twinkle: Math.random() * Math.PI * 2,
    }))

    const starsLarge = Array.from({ length: reducedMotion ? 7 : 14 }).map(() => ({
      x: Math.random(),
      y: Math.random(),
      radius: Math.random() * 2.4 + 1.2,
      alpha: Math.random() * 0.45 + 0.3,
      speed: Math.random() * 0.003 + 0.0007,
      twinkle: Math.random() * Math.PI * 2,
    }))

    const orbits = Array.from({ length: 4 }).map((_, index) => ({
      radius: 0.18 + index * 0.1,
      width: 0.58 + index * 0.18,
      alpha: 0.18 + index * 0.04,
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

    const layer = layerRef.current
    let pointerTicking = false
    let targetX = 0
    let targetY = 0
    let currentX = 0
    let currentY = 0
    const amplitude = 8
    const lerp = 0.12

    const applyTransform = () => {
      if (!layer || reducedMotion) return
      currentX += (targetX - currentX) * lerp
      currentY += (targetY - currentY) * lerp
      layer.style.transform = `translate3d(${currentX.toFixed(2)}px, ${currentY.toFixed(2)}px, 0)`
    }

    const onPointerMove = (event: PointerEvent) => {
      if (reducedMotion) return
      if (pointerTicking) return
      pointerTicking = true
      window.requestAnimationFrame(() => {
        pointerTicking = false
        const bounds = parent.getBoundingClientRect()
        const nextX = ((event.clientX - bounds.left) / bounds.width - 0.5) * amplitude * 2
        const nextY = ((event.clientY - bounds.top) / bounds.height - 0.5) * amplitude * 2
        targetX = Math.max(-amplitude, Math.min(amplitude, nextX))
        targetY = Math.max(-amplitude, Math.min(amplitude, nextY))
      })
    }

    const onPointerLeave = () => {
      targetX = 0
      targetY = 0
    }

    if (!reducedMotion) {
      parent.addEventListener('pointermove', onPointerMove)
      parent.addEventListener('pointerleave', onPointerLeave)
    }

    const palette = VARIANT_STYLES[variant]
    let raf = 0
    let lastTick = 0
    const frameInterval = reducedMotion ? 1000 : 1000 / 24

    const draw = (time: number) => {
      raf = window.requestAnimationFrame(draw)
      if (!reducedMotion && time - lastTick < frameInterval) return
      lastTick = time

      applyTransform()

      const width = node.width
      const height = node.height
      context.clearRect(0, 0, width, height)

      const nebula = context.createRadialGradient(width * 0.5, height * 0.55, width * 0.08, width * 0.5, height * 0.55, width * 0.8)
      nebula.addColorStop(0, palette.glow)
      nebula.addColorStop(1, 'rgba(0,0,0,0)')
      context.fillStyle = nebula
      context.fillRect(0, 0, width, height)

      const planetX = width * 0.67
      const planetY = height * 0.48

      context.save()
      context.translate(planetX, planetY)
      context.rotate(-0.18)
      orbits.forEach((orbit) => {
        context.beginPath()
        context.ellipse(0, 0, width * orbit.radius, width * orbit.radius * orbit.width, 0, 0, Math.PI * 2)
        context.strokeStyle = `rgba(${palette.orbitRgb}, ${orbit.alpha})`
        context.lineWidth = 1.2 * dpr
        context.stroke()
      })
      context.restore()

      const planetRadius = Math.min(width, height) * 0.13
      const planet = context.createRadialGradient(planetX - planetRadius * 0.35, planetY - planetRadius * 0.4, planetRadius * 0.2, planetX, planetY, planetRadius * 1.25)
      planet.addColorStop(0, palette.planetCore)
      planet.addColorStop(0.5, palette.planetRim)
      planet.addColorStop(1, 'rgba(8, 12, 26, 0.1)')
      context.fillStyle = planet
      context.beginPath()
      context.arc(planetX, planetY, planetRadius, 0, Math.PI * 2)
      context.fill()

      context.beginPath()
      context.ellipse(planetX, planetY, planetRadius * 1.42, planetRadius * 1.02, -0.2, 0, Math.PI * 2)
      context.strokeStyle = palette.shield
      context.lineWidth = 1.4 * dpr
      context.shadowColor = palette.shield
      context.shadowBlur = 18 * dpr
      context.stroke()
      context.shadowBlur = 0

      starsFine.forEach((star) => {
        star.twinkle += reducedMotion ? 0 : star.speed
        const twinkle = reducedMotion ? star.alpha : star.alpha * (0.6 + Math.sin(star.twinkle) * 0.4)
        context.beginPath()
        context.arc(star.x * width, star.y * height, star.radius * dpr, 0, Math.PI * 2)
        context.fillStyle = `rgba(${palette.starsRgb}, ${twinkle.toFixed(2)})`
        context.fill()
      })

      starsLarge.forEach((star) => {
        star.twinkle += reducedMotion ? 0 : star.speed
        const twinkle = reducedMotion ? star.alpha : star.alpha * (0.7 + Math.sin(star.twinkle) * 0.3)
        context.beginPath()
        context.arc(star.x * width, star.y * height, star.radius * dpr, 0, Math.PI * 2)
        context.fillStyle = `rgba(${palette.starsRgb}, ${twinkle.toFixed(2)})`
        context.fill()
      })

      context.fillStyle = 'rgba(255,255,255,0.025)'
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
      <div className="hero-background__parallax-layer" ref={layerRef}>
        <div className="hero-background__gradient" />
        <canvas ref={canvasRef} className="hero-background__canvas" />
        <div className="hero-background__grain" />
      </div>
    </div>
  )
}
