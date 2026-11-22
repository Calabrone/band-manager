import { useEffect, useState } from 'react'
import { Hand } from 'lucide-react'

const PAD = 6
const FIND_TIMEOUT_MS = 3000

/**
 * Evidenzia l'elemento [data-tour="<target>"] con un riquadro e un fumetto. Fuori dal riquadro la pagina e' scurita e
 * bloccata (un tocco chiude); dentro il riquadro i tocchi passano all'elemento. Senza target mostra solo il fumetto.
 */
export default function Spotlight({ spot, onClose }) {
  const [rect, setRect] = useState(null)
  const [notFound, setNotFound] = useState(!spot.target)

  useEffect(() => {
    if (!spot.target) return undefined
    let el = null
    let raf = 0
    let timer = 0
    const started = Date.now()

    const measure = () => {
      if (!el) return
      const r = el.getBoundingClientRect()
      setRect({ top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 })
    }
    const find = () => {
      // piu' elementi possono avere lo stesso bersaglio (es. link su desktop, pulsante su mobile): il primo visibile
      el =
        [...document.querySelectorAll(`[data-tour="${spot.target}"]`)].find((n) => {
          const r = n.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        }) ?? null
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        measure()
        el.addEventListener('click', onClose, { once: true })
        timer = window.setInterval(measure, 150)
        window.addEventListener('resize', measure)
        window.addEventListener('scroll', measure, true)
      } else if (Date.now() - started < FIND_TIMEOUT_MS) {
        raf = requestAnimationFrame(find)
      } else {
        setNotFound(true)
      }
    }
    find()
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(timer)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      el?.removeEventListener('click', onClose)
    }
  }, [spot.target, onClose])

  const vw = typeof window !== 'undefined' ? window.innerWidth : 360
  const vh = typeof window !== 'undefined' ? window.innerHeight : 640
  const below = rect ? rect.top + rect.height + 150 < vh : true
  const bubbleStyle =
    rect && !notFound
      ? below
        ? { top: rect.top + rect.height + 12 }
        : { bottom: vh - rect.top + 12 }
      : { top: '50%', transform: 'translateY(-50%)' }
  const dim = 'absolute bg-black/70 pointer-events-auto'

  return (
    <div className="fixed inset-0 z-[60]" data-testid="spotlight">
      {rect && !notFound ? (
        <>
          <div className={dim} style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top) }} onClick={onClose} />
          <div className={dim} style={{ top: rect.top + rect.height, left: 0, right: 0, bottom: 0 }} onClick={onClose} />
          <div className={dim} style={{ top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height }} onClick={onClose} />
          <div className={dim} style={{ top: rect.top, left: rect.left + rect.width, right: 0, height: rect.height }} onClick={onClose} />
          <div
            className="absolute rounded-xl border-2 border-brand-400 pointer-events-none"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          >
            {spot.target === 'song-list' && (
              <Hand className="absolute left-1/2 top-1/3 w-9 h-9 text-white drop-shadow animate-swipe-hint" />
            )}
          </div>
        </>
      ) : (
        <div className="absolute inset-0 bg-black/70 pointer-events-auto" onClick={onClose} />
      )}
      <div
        className="absolute left-4 right-4 mx-auto max-w-sm rounded-2xl bg-gray-900 border border-gray-700 p-4 shadow-xl"
        style={bubbleStyle}
      >
        <p className="text-sm font-semibold text-white">{spot.title}</p>
        <p className="text-sm text-gray-300 mt-1">
          {notFound && spot.target ? "Non trovo l'elemento in questa pagina: " : ''}
          {spot.hint}
        </p>
        <button onClick={onClose} data-testid="spotlight-ok" className="mt-3 w-full py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold">
          Ho capito
        </button>
      </div>
    </div>
  )
}
