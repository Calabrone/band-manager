// Loop A-B, zoom e coordinate della timeline del player della Sala prove.
// Funzioni pure (tempi in millisecondi), nessuna dipendenza: testate con node --test.

export const MIN_LOOP_MS = 200
export const MAX_ZOOM = 32
/** Anticipo con cui il motore rimanda il cursore ad A, per non superare B tra due controlli. */
export const LOOP_EPS_MS = 30

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Loop valido dentro [0, duration]: A < B con almeno `min` ms tra i due. */
export function clampLoop(a, b, duration, min = MIN_LOOP_MS) {
  if (!(duration > 0)) return { a: 0, b: 0 }
  if (duration <= min) return { a: 0, b: duration }
  let lo = clamp(Number.isFinite(a) ? a : 0, 0, duration)
  let hi = clamp(Number.isFinite(b) ? b : duration, 0, duration)
  if (lo > hi) [lo, hi] = [hi, lo]
  if (hi - lo < min) {
    if (lo + min <= duration) hi = lo + min
    else {
      hi = duration
      lo = duration - min
    }
  }
  return { a: lo, b: hi }
}

/** Sposta una maniglia ('a' o 'b') a `ms` senza scavalcare l'altra né uscire dal contenuto. */
export function moveHandle(loop, which, ms, duration, min = MIN_LOOP_MS) {
  if (!(duration > 0)) return { a: 0, b: 0 }
  const { a, b } = clampLoop(loop.a, loop.b, duration, min)
  if (which === 'a') return { a: clamp(ms, 0, Math.max(0, b - min)), b }
  return { a, b: clamp(ms, Math.min(duration, a + min), duration) }
}

/** Taglio predefinito dell'autore → loop iniziale del player (attivo solo se c'è un taglio). */
export function loopFromTrim(trimStart, trimEnd, duration) {
  const hasTrim = Number.isInteger(trimStart) && Number.isInteger(trimEnd)
  if (!hasTrim) return { a: 0, b: duration || 0, active: false }
  const { a, b } = clampLoop(trimStart, trimEnd, duration || trimEnd)
  return { a, b, active: true }
}

/**
 * Se il loop è attivo e la posizione ha raggiunto B (meno `eps`), ritorna il punto in cui
 * saltare (A); altrimenti null. Usata dal ciclo di riproduzione dei motori a elemento media.
 */
export function wrapLoop(posMs, loop, eps = LOOP_EPS_MS) {
  if (!loop || !loop.active) return null
  return posMs >= loop.b - eps ? loop.a : null
}

// ── Vista (zoom e scorrimento) ──────────────────────────────────────────────

export function fullView(duration) {
  return { startMs: 0, spanMs: Math.max(0, duration) }
}

export function minSpan(duration) {
  return Math.min(duration, Math.max(duration / MAX_ZOOM, 50))
}

export function zoomLevel(view, duration) {
  return view.spanMs > 0 ? duration / view.spanMs : 1
}

/** Ingrandisce (factor > 1) o riduce (< 1) tenendo fermo `anchorMs` nella stessa posizione sullo schermo. */
export function zoomAt(view, factor, anchorMs, duration) {
  if (!(duration > 0) || !(factor > 0)) return fullView(duration)
  const span = clamp(view.spanMs / factor, minSpan(duration), duration)
  const rel = view.spanMs > 0 ? clamp((anchorMs - view.startMs) / view.spanMs, 0, 1) : 0.5
  const start = clamp(anchorMs - rel * span, 0, duration - span)
  return { startMs: start, spanMs: span }
}

export function panView(view, deltaMs, duration) {
  return { startMs: clamp(view.startMs + deltaMs, 0, Math.max(0, duration - view.spanMs)), spanMs: view.spanMs }
}

/** Durante la riproduzione la vista segue il cursore quando esce dal 90% della finestra (o a sinistra). */
export function followCursor(view, posMs, duration) {
  if (view.spanMs >= duration) return view
  const end = view.startMs + view.spanMs * 0.9
  if (posMs >= view.startMs && posMs <= end) return view
  const start = clamp(posMs - view.spanMs * 0.1, 0, duration - view.spanMs)
  return { startMs: start, spanMs: view.spanMs }
}

export function msToX(ms, view, width) {
  return view.spanMs > 0 ? ((ms - view.startMs) / view.spanMs) * width : 0
}

export function xToMs(x, view, width) {
  return width > 0 ? view.startMs + (x / width) * view.spanMs : view.startMs
}

// ── Formati ─────────────────────────────────────────────────────────────────

/** "m:ss.d" (es. 45200 → "0:45.2"). */
export function formatTime(ms) {
  const t = Math.max(0, Math.floor((ms || 0) / 100))
  const tenths = t % 10
  const s = Math.floor(t / 10) % 60
  const m = Math.floor(t / 600)
  return `${m}:${String(s).padStart(2, '0')}.${tenths}`
}

/** "m:ss" per i link nei commenti (es. 45200 → "0:45"). */
export function formatClock(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
