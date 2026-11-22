import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'

/** Pulsante flottante (+) sopra la barra di navigazione. */
export default function Fab({ to, label, tour }) {
  return (
    <Link
      to={to}
      aria-label={label}
      data-tour={tour}
      className="fixed right-4 z-30 w-14 h-14 rounded-full bg-brand-600 hover:bg-brand-700 active:bg-brand-700 text-white
                 flex items-center justify-center shadow-lg shadow-black/40 bottom-[calc(76px+env(safe-area-inset-bottom))]"
    >
      <Plus className="w-7 h-7" />
    </Link>
  )
}
