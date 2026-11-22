import { Sparkles } from 'lucide-react'
import { useConfig } from '../../context/ConfigContext'

/** Benvenuto mostrato una sola volta al primo accesso al Repertorio. */
export default function WelcomeCard({ onStart, onSkip }) {
  const { bandName } = useConfig()
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4" data-testid="welcome-card">
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        <div className="w-12 h-12 rounded-2xl bg-brand-600 flex items-center justify-center mb-3">
          <Sparkles className="w-6 h-6 text-on-accent" />
        </div>
        <h2 className="text-lg font-bold text-white">Benvenuto in {bandName}</h2>
        <p className="text-sm text-gray-400 mt-1">
          Una guida veloce ti mostra come proporre brani, provarli e registrare le prove. Si spunta da sola mentre usi l&apos;app
          e la ritrovi sempre dal pulsante «?».
        </p>
        <div className="flex gap-2 mt-5">
          <button onClick={onSkip} data-testid="welcome-skip" className="flex-1 py-3 rounded-xl bg-gray-800 text-gray-300 text-sm font-medium">
            Salta
          </button>
          <button onClick={onStart} data-testid="welcome-start" className="flex-1 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-on-accent text-sm font-semibold">
            Inizia la guida
          </button>
        </div>
      </div>
    </div>
  )
}
