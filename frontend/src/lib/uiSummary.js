// Riepiloghi testuali mostrati sulla riga dei pannelli richiusi.

/** Pannello "Ascolto" del player: volume, conteggio, volume base, latenza. */
export function summarizeListening({ volume, countIn, baseVolume = null, offsetMs = 0 }) {
  const parts = [`Volume ${Math.round(volume * 100)}%`]
  parts.push(countIn ? 'conteggio attivo' : 'conteggio spento')
  if (baseVolume !== null && baseVolume !== undefined) parts.push(`base ${Math.round(baseVolume * 100)}%`)
  if (offsetMs) parts.push(`latenza ${offsetMs > 0 ? '+' : ''}${offsetMs} ms`)
  return parts.join(' · ')
}

/** Pannello "Tempo" della registrazione. */
export function summarizeTempo({ bpm, countIn, metronome }) {
  return `${bpm} BPM · conteggio ${countIn ? 'sì' : 'no'} · metronomo ${metronome ? 'sì' : 'no'}`
}
