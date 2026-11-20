// Allineamento di una sovraincisione al contenuto base (spec rehearsal-studio, design §5.2).
//
// Per un contenuto T registrato ascoltando la base B, a ogni istante t del file di T corrisponde
// l'istante della base:  b(t) = t − sync − offset + base_start
//   sync       = istante nel file di T in cui la base è partita (deterministico)
//   offset     = latenza uscita+ingresso, regolabile dall'utente (positivo = registrazione in ritardo)
//   base_start = da che punto della base si è partiti
// Se la base suonava in loop, oltre B finale si riparte da A (modulo della lunghezza del loop).
// Funzioni pure (millisecondi): testate con node --test.

export const MAX_OFFSET_MS = 2000

export function clampOffset(ms, range = MAX_OFFSET_MS) {
  if (!Number.isFinite(ms)) return 0
  return Math.max(-range, Math.min(range, Math.round(ms)))
}

/** Istante della base che suona a `tMs` del contenuto sovrainciso; null finché la base non è ancora partita. */
export function baseTimeFor(tMs, p) {
  const elapsed = tMs - (p.sync_ms || 0) - (p.offset_ms || 0)
  if (elapsed < 0) return null
  const pos = (p.base_start_ms || 0) + elapsed
  const a = p.base_loop_start_ms
  const b = p.base_loop_end_ms
  if (Number.isInteger(a) && Number.isInteger(b) && b > a && pos >= b) {
    return a + ((pos - b) % (b - a))
  }
  return pos
}

/** sync_ms da due istanti dell'AudioContext (secondi): avvio della registrazione e avvio della base. */
export function computeSync(tRecStartSec, tBaseStartSec) {
  return Math.max(0, Math.round((tBaseStartSec - tRecStartSec) * 1000))
}

/** Latenza stimata (ms) da quanto dichiarano il browser e il microfono, in secondi; limitata a [0, 2000]. */
export function estimateLatencyMs({ outputLatency, baseLatency, inputLatency } = {}) {
  const out = Number.isFinite(outputLatency) && outputLatency > 0 ? outputLatency : Number.isFinite(baseLatency) ? baseLatency : 0
  const inp = Number.isFinite(inputLatency) && inputLatency > 0 ? inputLatency : 0
  return Math.max(0, Math.min(MAX_OFFSET_MS, Math.round((out + inp) * 1000)))
}
