// Metronomo: click continui sul clock dell'AudioContext, con scheduler a lookahead.
// Le funzioni di calcolo sono pure (testate con node --test); createMetronome tocca l'AudioContext solo quando è usato.
import { DEFAULT_BPM, clickFrequency, scheduleClick } from './countin.js'

export const BPM_MIN = 40
export const BPM_MAX = 300

/** Porta un valore qualsiasi in un BPM valido (intero tra BPM_MIN e BPM_MAX); non numerico o ≤ 0 → DEFAULT_BPM. */
export function clampBpm(v) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BPM
  return Math.min(BPM_MAX, Math.max(BPM_MIN, n))
}

/** Click che cadono in [from, to) per un metronomo che parte a `origin` (secondi): [{ time, index }]. */
export function beatTimesInWindow(origin, bpm, from, to) {
  const step = 60 / clampBpm(bpm)
  const first = Math.max(0, Math.ceil((from - origin) / step - 1e-9))
  const out = []
  for (let i = first; origin + i * step < to - 1e-9; i++) out.push({ time: origin + i * step, index: i })
  return out
}

const TAP_RESET_MS = 2000
const TAP_KEEP = 5

/**
 * Tap tempo: `taps` sono gli istanti (ms) dei tocchi precedenti, `now` l'ultimo.
 * Una pausa oltre 2 s riparte da zero; si usano gli ultimi 5 tocchi. Con meno di 2 tocchi bpm è null.
 */
export function tapTempo(taps, now) {
  const kept = taps.length && now - taps[taps.length - 1] > TAP_RESET_MS ? [] : taps
  const next = [...kept, now].slice(-TAP_KEEP)
  if (next.length < 2) return { taps: next, bpm: null }
  const avg = (next[next.length - 1] - next[0]) / (next.length - 1)
  return { taps: next, bpm: avg > 0 ? clampBpm(60000 / avg) : null }
}

const LOOKAHEAD_S = 0.12
const TICK_MS = 25

/**
 * Metronomo continuo. `start(origin)` programma i click da `origin` (clock dell'AudioContext, anche nel futuro,
 * per partire in fase con un conteggio); `stop()` li ferma. Il primo tempo di ogni battuta è più acuto.
 */
export function createMetronome(ctx, { bpm, beatsPerBar = 4, volume = 0.5 }) {
  let timer = null
  let origin = 0
  let scheduledUntil = 0
  let vol = volume

  function tick() {
    const to = ctx.currentTime + LOOKAHEAD_S
    if (to <= scheduledUntil) return
    for (const { time, index } of beatTimesInWindow(origin, bpm, scheduledUntil, to)) {
      scheduleClick(ctx, time, clickFrequency(index, beatsPerBar), vol)
    }
    scheduledUntil = to
  }

  return {
    start(originTime) {
      this.stop()
      origin = originTime
      scheduledUntil = originTime
      tick()
      timer = setInterval(tick, TICK_MS)
    },
    stop() {
      if (timer !== null) clearInterval(timer)
      timer = null
    },
    setVolume(v) {
      vol = v
    },
  }
}
