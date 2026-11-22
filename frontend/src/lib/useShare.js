import { useCallback } from 'react'
import { useConfig } from '../context/ConfigContext'
import { useToast } from '../context/ToastContext'
import { shareText, shareUrl } from './share'

/**
 * Restituisce share({ kind, ctx, path, params }).
 * Ordine: pannello nativo → appunti ("Link copiato") → dialog con il link.
 */
export function useShare() {
  const { bandName } = useConfig()
  const { showToast, showLink } = useToast()

  return useCallback(
    async ({ kind, ctx = {}, path, params }) => {
      const url = shareUrl(path, params, { origin: window.location.origin, base: import.meta.env.BASE_URL })
      const text = shareText(kind, { ...ctx, bandName: bandName || undefined })
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: bandName || 'Band Manager', text, url })
          return 'shared'
        } catch (err) {
          if (err?.name === 'AbortError') return 'aborted'
          // altri errori (es. NotAllowedError): si ripiega sugli appunti
        }
      }
      try {
        await navigator.clipboard.writeText(url)
        showToast('Link copiato')
        return 'copied'
      } catch {
        showLink(url)
        return 'dialog'
      }
    },
    [bandName, showToast, showLink],
  )
}
