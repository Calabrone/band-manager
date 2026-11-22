import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

function readOpen(storageKey, fallback) {
  if (!storageKey) return fallback
  try {
    const v = localStorage.getItem(storageKey)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

/** Pannello richiudibile con riga di riepilogo a pannello chiuso; lo stato si ricorda in localStorage. */
export default function Collapsible({ title, summary, storageKey, defaultOpen = false, icon: Icon, tour, children }) {
  const [open, setOpen] = useState(() => readOpen(storageKey, defaultOpen))

  function toggle() {
    const next = !open
    setOpen(next)
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, next ? '1' : '0')
      } catch {
        // storage non disponibile
      }
    }
  }

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800" data-tour={tour} data-tour-open={open ? '1' : '0'}>
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-2 w-full px-3 py-3 text-left min-h-[48px]"
      >
        {Icon && <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />}
        <span className="text-sm font-medium text-gray-200 flex-shrink-0">{title}</span>
        {!open && summary && <span className="flex-1 min-w-0 text-xs text-gray-500 truncate text-right">{summary}</span>}
        {(open || !summary) && <span className="flex-1" />}
        <ChevronDown className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  )
}
