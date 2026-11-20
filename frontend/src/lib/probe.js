// Analisi dei file prima del caricamento: tipo (audio/video), durata e forma d'onda.
// kindFor ed extOf sono pure (testate con node --test); il resto usa le API del browser.

import { computePeaks } from './peaks.js'
import { decodeAudio, getAudioContext } from './engines.js'

const AUDIO_ONLY = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'amr', '3gp', '3gpp', 'caf'])
const VIDEO_ONLY = new Set(['m4v', 'mov'])
const EITHER = new Set(['mp4', 'webm'])

export const STUDIO_EXTS = [...AUDIO_ONLY, ...VIDEO_ONLY, ...EITHER]
export const STUDIO_ACCEPT = ['audio/*', 'video/*', ...STUDIO_EXTS.map((e) => `.${e}`)].join(',')

/** Oltre questa dimensione non si decodifica il file per la forma d'onda (memoria dei telefoni). */
export const PEAKS_MAX_FILE_BYTES = 80 * 1024 * 1024
const PEAKS_MAX_DURATION_MS = 15 * 60 * 1000

export function extOf(name) {
  const i = String(name).lastIndexOf('.')
  return i < 0 ? '' : String(name).slice(i + 1).toLowerCase()
}

/**
 * Tipo di contenuto per il server: dall'estensione, e per mp4/webm (ambigui) da ciò che il browser
 * vede nel file (`hasVideo`: true/false, o null se non lo sa) o dal tipo MIME. null se il formato non è ammesso.
 */
export function kindFor(name, type, hasVideo) {
  const ext = extOf(name)
  if (AUDIO_ONLY.has(ext)) return 'audio'
  if (VIDEO_ONLY.has(ext)) return 'video'
  if (!EITHER.has(ext)) return null
  if (hasVideo === true) return 'video'
  if (hasVideo === false) return 'audio'
  return String(type || '').startsWith('audio/') ? 'audio' : 'video'
}

/** Legge i metadati con un elemento <video> in memoria: durata e presenza della traccia video. */
export function probeFile(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement('video')
    let finished = false
    const done = (result) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      el.removeAttribute('src')
      el.load()
      resolve(result)
    }
    const timer = setTimeout(() => done({ ok: false, durationMs: null, hasVideo: null }), 8000)
    el.preload = 'metadata'
    el.muted = true
    el.onloadedmetadata = () =>
      done({
        ok: true,
        durationMs: Number.isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : null,
        hasVideo: el.videoWidth > 0,
      })
    el.onerror = () => done({ ok: false, durationMs: null, hasVideo: null })
    el.src = url
  })
}

/**
 * Forma d'onda (e durata reale) decodificando l'audio del file. null se non è possibile
 * (formato non decodificabile, file troppo grande o troppo lungo): la forma d'onda è facoltativa.
 */
export async function peaksFromBlob(blob, durationMs = null) {
  if (blob.size > PEAKS_MAX_FILE_BYTES || (durationMs && durationMs > PEAKS_MAX_DURATION_MS)) return null
  try {
    const buffer = await decodeAudio(getAudioContext(), await blob.arrayBuffer())
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
    const peaks = computePeaks(channels, buffer.sampleRate)
    return peaks.length ? { peaks, durationMs: Math.round(buffer.duration * 1000) } : null
  } catch {
    return null
  }
}
