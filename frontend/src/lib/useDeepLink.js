import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../context/ToastContext'
import { STRIP_PARAMS, focusKey, parseFocus, parseLoop, parseTime, pickKey } from './share'

/**
 * Parametri di un link diretto (spec share-links). I valori sono letti una volta al montaggio
 * (lo stato iniziale della pagina), così togliere i parametri dall'URL non li cambia.
 *   tabs: chiavi ammesse per ?tab=
 */
export function useDeepLink({ tabs = [] } = {}) {
  const [params, setParams] = useSearchParams()
  const initial = useRef(null)
  if (initial.current === null) {
    initial.current = {
      focus: parseFocus(params.get('focus')),
      time: parseTime(params.get('t')),
      loop: parseLoop(params.get('a'), params.get('b')),
      tab: pickKey(params.get('tab'), tabs),
    }
  }

  /** Toglie focus/t/a/b dall'URL senza nuova voce di cronologia. */
  const consume = useCallback(() => {
    setParams(
      (prev) => {
        if (!STRIP_PARAMS.some((k) => prev.has(k))) return prev
        const next = new URLSearchParams(prev)
        STRIP_PARAMS.forEach((k) => next.delete(k))
        return next
      },
      { replace: true },
    )
  }, [setParams])

  return { ...initial.current, consume }
}

/** Sostituisce un parametro di vista (tab/cat/seg) nell'URL, senza cronologia; null lo toglie. */
export function useViewParam(name) {
  const [, setParams] = useSearchParams()
  return useCallback(
    (value) => {
      setParams(
        (prev) => {
          const cur = prev.get(name)
          if ((value ?? null) === cur) return prev
          const next = new URLSearchParams(prev)
          if (value === null || value === undefined) next.delete(name)
          else next.set(name, value)
          return next
        },
        { replace: true },
      )
    },
    [name, setParams],
  )
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Scorre fino a [data-share-id="<focus>"] ed evidenzia l'elemento, una volta, quando ready è true.
 * Se l'elemento non c'è (eliminato) mostra «Elemento non più disponibile». Poi chiama consume().
 * onFound(el) facoltativo (es. posizionare il player su un marker).
 */
export function useFocusTarget(focus, ready, consume, { onFound } = {}) {
  const { showToast } = useToast()
  const done = useRef(false)
  const key = useMemo(() => focusKey(focus), [focus])

  useEffect(() => {
    if (!key || !ready || done.current) return
    // Attende il render della scheda appena attivata
    let tries = 0
    let timer
    const attempt = () => {
      if (done.current) return
      const el = document.querySelector(`[data-share-id="${key}"]`)
      if (!el && tries++ < 10) {
        timer = setTimeout(attempt, 100)
        return
      }
      done.current = true
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
        el.classList.add('share-flash')
        setTimeout(() => el.classList.remove('share-flash'), 2200)
        onFound?.(el)
      } else {
        showToast('Elemento non più disponibile')
      }
      consume?.()
    }
    timer = setTimeout(attempt, 0)
    return () => clearTimeout(timer)
  }, [key, ready]) // eslint-disable-line react-hooks/exhaustive-deps
}
