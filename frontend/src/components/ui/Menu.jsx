import { useState } from 'react'
import { MoreVertical } from 'lucide-react'

/**
 * Menu ⋮: bottom sheet sotto i 640 px, popover sopra. Voci: { icon, label, onClick, danger?, hidden? }.
 * Ha data-no-swipe: i gesti di swipe non partono da qui.
 */
export default function Menu({ items, label = 'Altre azioni', tour }) {
  const [open, setOpen] = useState(false)
  const visible = items.filter((i) => !i.hidden)
  if (visible.length === 0) return null

  return (
    <div data-no-swipe className="relative" data-tour={tour}>
      <button
        onClick={() => setOpen(true)}
        className="p-2 text-gray-400 hover:text-gray-200 rounded-lg"
        aria-label={label}
        aria-haspopup="menu"
      >
        <MoreVertical className="w-5 h-5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 sm:bg-transparent" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="fixed inset-x-0 bottom-0 z-50 bg-gray-900 border-t border-gray-700 rounded-t-2xl pb-[env(safe-area-inset-bottom)]
                       sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-1 sm:w-56 sm:rounded-xl sm:border sm:pb-0 shadow-xl overflow-hidden"
          >
            {visible.map(({ icon: Icon, label: text, onClick, danger }) => (
              <button
                key={text}
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  onClick()
                }}
                className={`flex items-center gap-3 w-full px-5 py-3.5 text-sm text-left hover:bg-gray-800 active:bg-gray-800 ${
                  danger ? 'text-red-400' : 'text-gray-200'
                }`}
              >
                {Icon && <Icon className="w-5 h-5 flex-shrink-0" />}
                {text}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
