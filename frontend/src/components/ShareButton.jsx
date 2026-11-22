import { Share2 } from 'lucide-react'
import { useShare } from '../lib/useShare'

/** Pulsante icona «Condividi» per le intestazioni. Props come share(): kind, ctx, path, params. */
export default function ShareButton({ kind, ctx, path, params, className = '', label = 'Condividi' }) {
  const share = useShare()
  return (
    <button
      type="button"
      onClick={() => share({ kind, ctx, path, params })}
      className={`p-2 text-gray-400 hover:text-gray-200 rounded-lg ${className}`}
      aria-label={label}
      title={label}
      data-testid="share-button"
    >
      <Share2 className="w-5 h-5" />
    </button>
  )
}

/** Azione testuale piccola «Condividi» per le righe degli elementi (audio, video, commenti, marker). */
export function ShareAction({ kind, ctx, path, params, className = '' }) {
  const share = useShare()
  return (
    <button
      type="button"
      onClick={() => share({ kind, ctx, path, params })}
      className={`flex items-center gap-1 text-xs text-gray-500 hover:text-brand-300 ${className}`}
      data-testid="share-action"
    >
      <Share2 className="w-3 h-3" />
      Condividi
    </button>
  )
}
