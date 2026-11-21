// Conteggio prima di partire: click sintetizzati con Web Audio, schedulati sul clock dell'AudioContext.
// Le funzioni di calcolo sono pure (testate con node --test); scheduleCountIn tocca l'AudioContext solo quando è chiamata.

export const DEFAULT_BPM = 100

/** Numero totale di click di un conteggio (battute × tempi per battuta). */
export function totalBeats(beatsPerBar, bars) {
  return Math.max(1, Math.round(beatsPerBar)) * Math.max(1, Math.round(bars))
}

/** Durata in secondi del conteggio. */
export function countInSeconds(bpm, beatsPerBar, bars) {
  return (totalBeats(beatsPerBar, bars) * 60) / (bpm > 0 ? bpm : DEFAULT_BPM)
}

/** Istanti (secondi) dei click a partire da `startTime`. */
export function clickTimes(startTime, bpm, beatsPerBar, bars) {
  const step = 60 / (bpm > 0 ? bpm : DEFAULT_BPM)
  return Array.from({ length: totalBeats(beatsPerBar, bars) }, (_, i) => startTime + i * step)
}

/** Frequenza del click: più acuto sul primo tempo di ogni battuta. */
export function clickFrequency(index, beatsPerBar) {
  return index % Math.max(1, Math.round(beatsPerBar)) === 0 ? 1000 : 800
}

/** Un singolo click (oscillatore con inviluppo breve) all'istante `t` del clock dell'AudioContext. */
export function scheduleClick(ctx, t, frequency, volume = 0.5) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), t + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.06)
}

/**
 * Programma i click sull'AudioContext. Ritorna l'istante (clock dell'AudioContext) in cui
 * il conteggio finisce e deve partire la riproduzione.
 */
export function scheduleCountIn(ctx, startTime, { bpm, beatsPerBar = 4, bars = 1, volume = 0.5 }) {
  clickTimes(startTime, bpm, beatsPerBar, bars).forEach((t, i) => {
    scheduleClick(ctx, t, clickFrequency(i, beatsPerBar), volume)
  })
  return startTime + countInSeconds(bpm, beatsPerBar, bars)
}
