import { useCallback, useEffect, useRef, useState } from 'react'
import { followCursor, formatClock, formatTime, moveHandle, msToX, panView, xToMs, zoomAt } from '../../lib/loop'
import { peaksForView } from '../../lib/peaks'
import { userColor } from './ui'

const RULER_H = 20
const LONG_PRESS_MS = 500
const MOVE_PX = 6
const TICK_STEPS = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000]

/** Passo della scala dei tempi: il più piccolo che lascia almeno ~70 px tra due tacche. */
function tickStep(view, width) {
  return TICK_STEPS.find((s) => (s / view.spanMs) * width >= 70) ?? TICK_STEPS[TICK_STEPS.length - 1]
}

function Handle({ x, label, onPointerDown, onPointerMove, onPointerUp }) {
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ left: x - 22, width: 44, top: RULER_H }}
      className="absolute bottom-0 flex justify-center cursor-ew-resize touch-none"
    >
      <div className="w-0.5 h-full bg-purple-400" />
      <div className="absolute bottom-1 w-6 h-8 rounded-md bg-purple-500 text-white text-xs font-bold flex items-center justify-center shadow">
        {label}
      </div>
    </div>
  )
}

/**
 * Timeline del player: forma d'onda su canvas, regione del loop, taglio dell'autore, marker,
 * maniglie A/B trascinabili, zoom (pinch, Ctrl+rotella) e scorrimento. Tutto in millisecondi.
 * Il cursore si ridisegna a ogni frame mentre si riproduce, senza far rieseguire il rendering React.
 */
export default function Timeline({
  duration, peaks, view, onViewChange, loop, onLoopChange, trim, markers, getPosition, playing,
  onSeek, onAddMarkerAt, onMarkerClick, redrawKey = 0, height = 128,
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [width, setWidth] = useState(320)
  // Valori correnti per i gestori di eventi e per il ciclo di disegno (evita closure obsolete)
  const live = useRef({})
  live.current = { duration, peaks, view, loop, trim, markers, width, height, onViewChange, onLoopChange, onSeek, onAddMarkerAt, getPosition }
  const lastPan = useRef(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const measure = () => setWidth(Math.max(120, Math.floor(el.clientWidth)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const draw = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const { duration: dur, peaks: pk, view: v, loop: lp, trim: tr, width: w, height: h, getPosition: pos } = live.current
    const dpr = window.devicePixelRatio || 1
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    const g = c.getContext('2d')
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.fillStyle = '#111827'
    g.fillRect(0, 0, w, h)
    if (!(dur > 0) || !(v.spanMs > 0)) return
    const x = (ms) => msToX(ms, v, w)
    const top = RULER_H
    const bodyH = h - RULER_H
    const mid = top + bodyH / 2

    // Regione del loop
    if (lp && lp.b > lp.a) {
      g.fillStyle = lp.active ? 'rgba(168,85,247,0.22)' : 'rgba(168,85,247,0.08)'
      g.fillRect(x(lp.a), top, x(lp.b) - x(lp.a), bodyH)
    }

    // Forma d'onda
    if (pk && pk.length) {
      const cols = peaksForView(pk, dur, v, w)
      for (let i = 0; i < cols.length; i++) {
        const ms = xToMs(i + 0.5, v, w)
        const inside = lp && lp.active && ms >= lp.a && ms <= lp.b
        g.fillStyle = inside ? '#c084fc' : '#6b7280'
        const amp = Math.max(1, (cols[i] / 255) * (bodyH / 2 - 3))
        g.fillRect(i, mid - amp, 1, amp * 2)
      }
    } else {
      g.fillStyle = '#374151'
      g.fillRect(0, mid - 0.5, w, 1)
    }

    // Parte fuori dal taglio dell'autore, scurita
    if (tr) {
      g.fillStyle = 'rgba(0,0,0,0.45)'
      const x0 = x(tr.start)
      const x1 = x(tr.end)
      if (x0 > 0) g.fillRect(0, top, Math.min(w, x0), bodyH)
      if (x1 < w) g.fillRect(Math.max(0, x1), top, w - Math.max(0, x1), bodyH)
    }

    // Scala dei tempi
    const step = tickStep(v, w)
    g.font = '10px system-ui, sans-serif'
    g.textBaseline = 'top'
    g.fillStyle = '#6b7280'
    g.strokeStyle = '#374151'
    g.lineWidth = 1
    for (let t = Math.ceil(v.startMs / step) * step; t <= v.startMs + v.spanMs; t += step) {
      const px = Math.round(x(t)) + 0.5
      g.beginPath()
      g.moveTo(px, RULER_H - 5)
      g.lineTo(px, RULER_H)
      g.stroke()
      g.fillText(step >= 1000 ? formatClock(t) : formatTime(t), px + 3, 3)
    }

    // Cursore
    const p = pos()
    if (p >= v.startMs && p <= v.startMs + v.spanMs) {
      g.fillStyle = '#ffffff'
      g.fillRect(Math.round(x(p)) - 1, 0, 2, h)
    }
  }, [])

  // Ridisegna quando cambia qualcosa
  useEffect(() => {
    draw()
  }, [draw, duration, peaks, view, loop, trim, markers, width, height, playing, redrawKey])

  // Durante la riproduzione: disegno a ogni frame, e la vista segue il cursore
  useEffect(() => {
    if (!playing) return undefined
    let id
    const frame = () => {
      draw()
      const { view: v, duration: dur, onViewChange: change, getPosition: pos } = live.current
      if (Date.now() - lastPan.current > 2500) {
        const next = followCursor(v, pos(), dur)
        if (next.startMs !== v.startMs) change(next)
      }
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [playing, draw])

  // Zoom con Ctrl/⌘ + rotella, scorrimento con la rotella quando si è ingranditi
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const onWheel = (e) => {
      const { view: v, duration: dur, width: w, onViewChange: change } = live.current
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        change(zoomAt(v, Math.exp(-e.deltaY * 0.01), xToMs(e.clientX - rect.left, v, w), dur))
      } else if (v.spanMs < dur) {
        e.preventDefault()
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        lastPan.current = Date.now()
        change(panView(v, (d / w) * v.spanMs, dur))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── Gesti sulla timeline: tocco = salta, trascinamento = scorri/scrub, pinch = zoom, pressione lunga = marker ──
  const pointers = useRef(new Map())
  const gesture = useRef({ view: null, dist: 0, anchor: 0, timer: null, long: false, lastTap: 0, lastTapX: 0 })

  function relX(e) {
    return e.clientX - wrapRef.current.getBoundingClientRect().left
  }

  function onPointerDown(e) {
    const gs = gesture.current
    const x = relX(e)
    pointers.current.set(e.pointerId, { x, sx: x, moved: false })
    e.currentTarget.setPointerCapture?.(e.pointerId)
    gs.view = live.current.view
    clearTimeout(gs.timer)
    if (pointers.current.size === 1) {
      gs.long = false
      gs.timer = setTimeout(() => {
        const p = [...pointers.current.values()][0]
        if (pointers.current.size === 1 && p && !p.moved) {
          gs.long = true
          const { view: v, width: w, onAddMarkerAt: add } = live.current
          add?.(xToMs(p.x, v, w))
        }
      }, LONG_PRESS_MS)
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gs.dist = Math.max(1, Math.abs(a.x - b.x))
      gs.anchor = xToMs((a.x + b.x) / 2, live.current.view, live.current.width)
      gs.view = live.current.view
    }
  }

  function onPointerMove(e) {
    const p = pointers.current.get(e.pointerId)
    if (!p) return
    const gs = gesture.current
    p.x = relX(e)
    const { duration: dur, width: w, onViewChange: change, onSeek: seek } = live.current
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      a.moved = b.moved = true
      clearTimeout(gs.timer)
      lastPan.current = Date.now()
      change(zoomAt(gs.view, Math.abs(a.x - b.x) / gs.dist, gs.anchor, dur))
      return
    }
    const dx = p.x - p.sx
    if (!p.moved && Math.abs(dx) < MOVE_PX) return
    p.moved = true
    clearTimeout(gs.timer)
    if (gs.view.spanMs < dur) {
      lastPan.current = Date.now()
      change(panView(gs.view, -(dx / w) * gs.view.spanMs, dur))
    } else {
      seek(xToMs(p.x, live.current.view, w))
    }
  }

  function onPointerUp(e) {
    const gs = gesture.current
    const p = pointers.current.get(e.pointerId)
    pointers.current.delete(e.pointerId)
    clearTimeout(gs.timer)
    if (!p || p.moved || gs.long || pointers.current.size > 0) return
    const { view: v, width: w, onSeek: seek, onAddMarkerAt: add } = live.current
    const ms = xToMs(p.x, v, w)
    const now = Date.now()
    if (now - gs.lastTap < 320 && Math.abs(p.x - gs.lastTapX) < 24) {
      gs.lastTap = 0
      add?.(ms) // doppio tocco = marker
    } else {
      gs.lastTap = now
      gs.lastTapX = p.x
      seek(ms)
    }
    draw()
  }

  // ── Maniglie A/B ──
  const dragging = useRef(null)
  function handleDown(which) {
    return (e) => {
      e.stopPropagation()
      dragging.current = which
      e.currentTarget.setPointerCapture?.(e.pointerId)
    }
  }
  function handleMove(e) {
    const which = dragging.current
    if (!which) return
    const { view: v, width: w, duration: dur, loop: lp, onLoopChange: change } = live.current
    const ms = xToMs(relX(e), v, w)
    change(moveHandle(lp, which, ms, dur))
  }
  function handleUp() {
    dragging.current = null
  }

  const visible = (ms) => {
    const px = msToX(ms, view, width)
    return px >= -22 && px <= width + 22
  }

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
      className="relative w-full select-none touch-none rounded-xl overflow-hidden bg-gray-900 border border-gray-800"
      style={{ height }}
    >
      <canvas ref={canvasRef} style={{ width, height }} className="block" />

      {markers.filter((m) => visible(m.time_ms)).map((m) => (
        <button
          key={m.id}
          type="button"
          title={`${formatClock(m.time_ms)} · ${m.username}: ${m.label}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onMarkerClick?.(m)
          }}
          style={{ left: msToX(m.time_ms, view, width) - 11, color: userColor(m.user_id), height: RULER_H }}
          className="absolute top-0 w-[22px] flex items-start justify-center text-[15px] leading-none"
        >
          ⚑
        </button>
      ))}

      {loop && loop.b > loop.a && (
        <>
          {visible(loop.a) && (
            <Handle x={msToX(loop.a, view, width)} label="A" onPointerDown={handleDown('a')} onPointerMove={handleMove} onPointerUp={handleUp} />
          )}
          {visible(loop.b) && (
            <Handle x={msToX(loop.b, view, width)} label="B" onPointerDown={handleDown('b')} onPointerMove={handleMove} onPointerUp={handleUp} />
          )}
        </>
      )}
    </div>
  )
}
