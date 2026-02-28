import { useEffect, useRef, type ReactNode } from 'react'

interface ForgeSheetProps {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}

const focusableSelectors = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function ForgeSheet({ open, title, onClose, children }: ForgeSheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const panel = panelRef.current
    const focusable = panel ? Array.from(panel.querySelectorAll<HTMLElement>(focusableSelectors)) : []
    focusable[0]?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (!open) return
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const dialogNode = panelRef.current
      if (!dialogNode) return
      const trapped = Array.from(dialogNode.querySelectorAll<HTMLElement>(focusableSelectors))
      if (trapped.length === 0) return
      const first = trapped[0]
      const last = trapped[trapped.length - 1]
      const active = document.activeElement
      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="forge-sheet-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={panelRef} className="forge-sheet" role="dialog" aria-modal="true" aria-label={title}>
        {children}
      </div>
    </div>
  )
}
