import { HelpCircle } from 'lucide-react'
import { useOnboarding } from '../../context/OnboardingContext'

/** "?" nell'intestazione: apre la guida; il pallino resta finche' la guida non e' completata ne' saltata. */
export default function HelpButton() {
  const { open, badge } = useOnboarding()
  return (
    <button onClick={open} className="relative p-2 text-gray-400 hover:text-gray-200" aria-label="Guida ai primi passi" data-testid="help-button">
      <HelpCircle className="w-5 h-5" />
      {badge && <span data-testid="help-badge" className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-brand-500 ring-2 ring-gray-950" />}
    </button>
  )
}
