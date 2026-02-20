import { Command } from 'cmdk'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

const commands = [
  { label: 'Открыть Живое ядро', path: '/core' },
  { label: 'Создать чек-ин', path: '/core' },
  { label: 'Оракул: новый сценарий', path: '/oracle' },
  { label: 'Открыть Мультивселенную', path: '/multiverse' },
  { label: 'Граф: рычаги', path: '/graph' },
  { label: 'Дашборд', path: '/dashboard' },
  { label: 'История', path: '/history' },
  { label: 'Настройки', path: '/settings' },
]

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (!open) return null

  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <Command className="palette" label="Командная палитра" onClick={(e) => e.stopPropagation()}>
        <Command.Input placeholder="Введите команду" autoFocus />
        <Command.List>
          {commands.map((item) => (
            <Command.Item key={`${item.path}-${item.label}`} onSelect={() => { navigate(item.path); setOpen(false) }}>
              {item.label}
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </div>
  )
}
