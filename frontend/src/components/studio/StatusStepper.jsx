import { Check } from 'lucide-react'
import { STATUS, StatusBadge } from './ui'

const PATH = ['idea', 'lavorazione', 'pronto']

/**
 * Percorso Idea → In lavoro → Pronto. Il creatore (o l'admin) cambia stato toccando un passo.
 * Gli stati finali (promosso, archiviato) si mostrano come badge: si lasciano dal menu.
 */
export default function StatusStepper({ status, canManage, onChange }) {
  if (!PATH.includes(status)) return <StatusBadge status={status} />
  const current = PATH.indexOf(status)

  return (
    <div data-tour="status-stepper" className="flex items-center" role="group" aria-label="Stato del brano">
      {PATH.map((s, i) => {
        const reached = i <= current
        const Tag = canManage ? 'button' : 'div'
        return (
          <div key={s} className="flex items-center flex-1 min-w-0 last:flex-none">
            <Tag
              {...(canManage ? { onClick: () => i !== current && onChange(s), 'aria-current': i === current } : {})}
              data-status-step={s}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap min-h-[40px] ${
                i === current ? STATUS[s].cls + ' ring-1 ring-current' : reached ? 'text-gray-300 bg-gray-800' : 'text-gray-500 bg-gray-900 border border-gray-800'
              }`}
            >
              {i < current && <Check className="w-3.5 h-3.5" />}
              {STATUS[s].short}
            </Tag>
            {i < PATH.length - 1 && <span className={`flex-1 h-px mx-1 min-w-[6px] ${i < current ? 'bg-gray-600' : 'bg-gray-800'}`} />}
          </div>
        )
      })}
    </div>
  )
}
