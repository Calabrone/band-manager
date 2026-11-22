import { useEffect, useRef } from 'react'
import { axisLock, dragOffset, nextIndex, startsInEdge, swipeDecision } from '../../lib/swipe'

// Il gesto non parte da questi elementi (campi, cursori, forme d'onda, aree marcate a mano).
const IGNORE = 'input, textarea, select, [contenteditable], canvas, [data-no-swipe]'
const ANIM_MS = 180

function setProgress(p) {
  document.documentElement.style.setProperty('--swipe-progress', String(p))
}

function inHorizontalScroller(el, root) {
  for (let n = el; n && n !== root; n = n.parentElement) {
    const ox = getComputedStyle(n).overflowX
    if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth + 1) return true
  }
  return false
}

/**
 * Rende "scorrevoli" le sezioni di un selettore: il contenuto segue il dito (verso sinistra -> sezione successiva).
 * keys: chiavi delle sezioni nell'ordine delle schede. onSwipe: chiamato dopo un cambio fatto col gesto.
 */
export default function SwipeTabs({ keys, active, onChange, onSwipe, className = '', children, tour }) {
  const ref = useRef(null)
  const latest = useRef({})
  latest.current = { keys, active, onChange, onSwipe }

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    let g = null
    let timer = 0

    const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const setX = (x, ms) => {
      el.style.transition = ms ? `transform ${ms}ms ease-out` : 'none'
      el.style.transform = x ? `translateX(${x}px)` : ''
    }

    function onStart(e) {
      if (e.touches.length !== 1 || timer) return
      const t = e.touches[0]
      if (startsInEdge(t.clientX, window.innerWidth)) return
      if (e.target.closest?.(IGNORE) || inHorizontalScroller(e.target, el)) return
      g = { x0: t.clientX, y0: t.clientY, t0: Date.now(), axis: null, dx: 0, dy: 0 }
    }

    function onMove(e) {
      if (!g) return
      const t = e.touches[0]
      g.dx = t.clientX - g.x0
      g.dy = t.clientY - g.y0
      if (!g.axis) g.axis = axisLock(g.dx, g.dy)
      if (g.axis === 'y') {
        g = null
        return
      }
      if (g.axis === 'x') {
        if (e.cancelable) e.preventDefault()
        const { keys: k, active: a } = latest.current
        const off = dragOffset(g.dx, k.indexOf(a), k.length)
        setX(off, 0)
        setProgress(Math.max(-1, Math.min(1, -off / el.clientWidth)))
      }
    }

    function onEnd() {
      if (!g || g.axis !== 'x') {
        g = null
        return
      }
      const { dx, dy, t0 } = g
      g = null
      const { keys: k, active: a, onChange: change, onSwipe: swiped } = latest.current
      const index = k.indexOf(a)
      const dir = swipeDecision({ dx, dy, dt: Date.now() - t0 })
      const target = nextIndex(index, dir, k.length)
      const w = el.clientWidth

      if (dir === 0 || target === index) {
        setX(0, reduced() ? 0 : 150)
        setProgress(0)
        return
      }
      if (reduced()) {
        setX(0, 0)
        setProgress(0)
        change(k[target])
        swiped?.()
        return
      }
      // esce dal lato del gesto, cambia sezione, rientra dal lato opposto
      setX(dir > 0 ? -w : w, ANIM_MS)
      setProgress(dir)
      timer = window.setTimeout(() => {
        change(k[target])
        swiped?.()
        navigator.vibrate?.(8)
        setX(dir > 0 ? w : -w, 0)
        setProgress(0)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            setX(0, ANIM_MS)
            timer = 0
          }),
        )
      }, ANIM_MS)
    }

    function onCancel() {
      if (g?.axis === 'x') {
        setX(0, 150)
        setProgress(0)
      }
      g = null
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onCancel)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
      window.clearTimeout(timer)
      setProgress(0)
    }
  }, [])

  // Cambio di sezione col tocco sulla scheda: riporta in alto se la lista era scesa sotto le schede.
  const prev = useRef(active)
  useEffect(() => {
    if (prev.current !== active && window.scrollY > 120) window.scrollTo({ top: 0 })
    prev.current = active
  }, [active])

  return (
    <div className={`overflow-x-clip flex flex-col ${className}`} data-tour={tour}>
      <div ref={ref} data-swipe-area style={{ touchAction: 'pan-y' }} className="flex-1 min-h-[55vh]">
        {children}
      </div>
    </div>
  )
}
