import { useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useConfig } from '../../context/ConfigContext'
import NotificationBell from '../NotificationBell'

/**
 * Intestazione delle pagine principali: nome del gruppo (riga piccola) e titolo della sezione.
 * Imposta anche il titolo della scheda del browser. bell=false nasconde la campanella delle notifiche.
 */
export default function AppHeader({ title, icon: Icon, iconClass = 'text-brand-400', onBack, actions, sticky = false, bell = true }) {
  const { bandName } = useConfig()

  useEffect(() => {
    document.title = `${bandName} · ${title}`
  }, [bandName, title])

  return (
    <header
      className={`flex items-center gap-3 px-4 py-2.5 bg-gray-950 border-b border-gray-800 ${sticky ? 'sticky top-0 z-20' : ''}`}
    >
      {onBack && (
        <button onClick={onBack} className="p-1 -ml-1 text-gray-400 hover:text-gray-200" aria-label="Indietro">
          <ArrowLeft className="w-6 h-6" />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <p data-testid="band-name" className="text-[11px] uppercase tracking-wide text-brand-400 truncate leading-tight">
          {bandName}
        </p>
        <h1 className="text-lg font-bold text-white flex items-center gap-2 leading-tight">
          {Icon && <Icon className={`w-5 h-5 flex-shrink-0 ${iconClass}`} />}
          <span className="truncate">{title}</span>
        </h1>
      </div>
      {(actions || bell) && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {actions}
          {bell && <NotificationBell />}
        </div>
      )}
    </header>
  )
}
