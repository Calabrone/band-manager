// Forma d'onda: calcolo dei picchi (da inviare al server) e riduzione per la timeline.
// I picchi sono interi 0-255, uno per "bucket" di tempo uguale: la durata di un bucket è
// duration_ms / peaks.length (il server non la memorizza). Funzioni pure: testate con node --test.

export const PEAKS_MAX = 16000
export const BUCKET_MS = 10

/** Durata in ms di un bucket per un contenuto lungo `durationMs`: 10 ms, o di più se i picchi sarebbero troppi. */
export function bucketMsFor(durationMs, maxCount = PEAKS_MAX) {
  return Math.max(BUCKET_MS, durationMs / maxCount)
}

/**
 * Picchi da canali audio decodificati (array di Float32Array): per ogni bucket il massimo
 * del valore assoluto tra tutti i canali, normalizzato sul massimo globale (0-255).
 */
export function computePeaks(channels, sampleRate, maxCount = PEAKS_MAX) {
  const chs = (channels || []).filter((c) => c && c.length)
  if (!chs.length || !(sampleRate > 0)) return []
  const total = Math.max(...chs.map((c) => c.length))
  const durationMs = (total / sampleRate) * 1000
  const per = Math.max(1, Math.round((sampleRate * bucketMsFor(durationMs, maxCount)) / 1000))
  const count = Math.ceil(total / per)
  const raw = new Float32Array(count)
  let top = 0
  for (const ch of chs) {
    for (let i = 0; i < ch.length; i++) {
      const v = Math.abs(ch[i])
      const b = (i / per) | 0
      if (v > raw[b]) raw[b] = v
    }
  }
  for (let i = 0; i < count; i++) if (raw[i] > top) top = raw[i]
  const out = new Array(count)
  for (let i = 0; i < count; i++) out[i] = top > 0 ? Math.round((raw[i] / top) * 255) : 0
  return out
}

/**
 * Picchi da disegnare in `width` colonne per la porzione `view` ({startMs, spanMs}) del contenuto:
 * ogni colonna prende il massimo dei bucket che copre; con zoom alto più colonne condividono lo stesso bucket.
 */
export function peaksForView(peaks, durationMs, view, width) {
  const w = Math.max(0, Math.floor(width))
  const out = new Array(w).fill(0)
  if (!peaks || !peaks.length || !(durationMs > 0) || !(view.spanMs > 0) || w === 0) return out
  const perMs = peaks.length / durationMs
  for (let x = 0; x < w; x++) {
    const from = (view.startMs + (x / w) * view.spanMs) * perMs
    const to = (view.startMs + ((x + 1) / w) * view.spanMs) * perMs
    const i0 = Math.min(peaks.length - 1, Math.max(0, Math.floor(from)))
    const i1 = Math.min(peaks.length - 1, Math.max(i0, Math.ceil(to) - 1))
    let m = 0
    for (let i = i0; i <= i1; i++) if (peaks[i] > m) m = peaks[i]
    out[x] = m
  }
  return out
}
