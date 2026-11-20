// Registrazione audio/video dal browser (MediaRecorder) per la Sala prove.
// pickMime, extForMime, limitState, levelPercent e recordingFileName sono pure (testate con node --test);
// il resto usa le API del browser e viene chiamato solo dalla pagina di registrazione.

/** Formati in ordine di preferenza: mp4 si riproduce ovunque, webm è il ripiego (Firefox). */
const VIDEO_MIMES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
const AUDIO_MIMES = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

export const VIDEO_BPS = 2_500_000
export const AUDIO_BPS = 128_000
export const WARN_RATIO = 0.85
export const STOP_RATIO = 0.95

/** Primo formato supportato dal browser (`isSupported` = MediaRecorder.isTypeSupported), o null. */
export function pickMime(kind, isSupported) {
  return (kind === 'video' ? VIDEO_MIMES : AUDIO_MIMES).find((m) => isSupported(m)) ?? null
}

/** Estensione del file (ammessa dal server) per un formato di registrazione, o null. */
export function extForMime(mime, kind) {
  const m = String(mime || '').toLowerCase()
  if (m.startsWith('video/mp4')) return 'mp4'
  if (m.startsWith('audio/mp4')) return 'm4a'
  if (m.startsWith('video/webm') || m.startsWith('audio/webm')) return 'webm'
  if (m.startsWith('audio/ogg')) return kind === 'audio' ? 'ogg' : null
  return null
}

/** Byte al secondo stimati con i bitrate impostati. */
export function bytesPerSecond(kind) {
  return ((kind === 'video' ? VIDEO_BPS : 0) + AUDIO_BPS) / 8
}

/** Durata massima stimata (secondi) prima di superare il limite di upload; null se il limite non è noto. */
export function maxSeconds(kind, maxBytes) {
  return maxBytes > 0 ? Math.floor((maxBytes * STOP_RATIO) / bytesPerSecond(kind)) : null
}

/** 'ok' | 'warn' (≥ 85% del limite) | 'stop' (≥ 95%): serve a fermare la registrazione prima che l'upload sia rifiutato. */
export function limitState(bytes, maxBytes) {
  if (!(maxBytes > 0)) return 'ok'
  const r = bytes / maxBytes
  return r >= STOP_RATIO ? 'stop' : r >= WARN_RATIO ? 'warn' : 'ok'
}

/** Livello 0-1 dalla radice del valor quadratico medio (scala dB da −60 a 0). */
export function levelPercent(rms) {
  if (!(rms > 0)) return 0
  return Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60))
}

/** Nome file dal titolo (solo minuscole, cifre e trattini). */
export function recordingFileName(title, ext) {
  const slug = String(title || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return `${slug || 'registrazione'}.${ext}`
}

// ── Browser ─────────────────────────────────────────────────────────────────

export const recordingSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

/** Microfono (e fotocamera) senza elaborazioni vocali: per la musica vanno spente. */
export function openStream({ kind, audioDeviceId, videoDeviceId }) {
  const audio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    ...(audioDeviceId ? { deviceId: { exact: audioDeviceId } } : {}),
  }
  const video =
    kind === 'video'
      ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user', ...(videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {}) }
      : false
  return navigator.mediaDevices.getUserMedia({ audio, video })
}

export function stopStream(stream) {
  stream?.getTracks().forEach((t) => t.stop())
}

/** Ingressi disponibili (le etichette compaiono solo dopo aver concesso il permesso). */
export async function listDevices() {
  const all = await navigator.mediaDevices.enumerateDevices()
  return {
    audioIn: all.filter((d) => d.kind === 'audioinput'),
    videoIn: all.filter((d) => d.kind === 'videoinput'),
  }
}

/**
 * Registratore su un MediaStream. start() si risolve all'evento 'start' del MediaRecorder; stop() ritorna il Blob.
 * Segnala l'avvicinarsi al limite di dimensione (onWarn) e il suo raggiungimento (onLimit).
 */
export function createRecorder(stream, { kind, maxBytes = 0, onSize, onWarn, onLimit }) {
  const mime = pickMime(kind, (t) => MediaRecorder.isTypeSupported(t))
  if (!mime) throw new Error('Questo browser non sa registrare in un formato compatibile')
  const rec = new MediaRecorder(stream, {
    mimeType: mime,
    audioBitsPerSecond: AUDIO_BPS,
    ...(kind === 'video' ? { videoBitsPerSecond: VIDEO_BPS } : {}),
  })
  const chunks = []
  let bytes = 0
  let warned = false
  let limited = false
  rec.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return
    chunks.push(e.data)
    bytes += e.data.size
    onSize?.(bytes)
    const st = limitState(bytes, maxBytes)
    if (st !== 'ok' && !warned) {
      warned = true
      onWarn?.()
    }
    if (st === 'stop' && !limited) {
      limited = true
      onLimit?.()
    }
  }
  const type = rec.mimeType || mime
  return {
    mime: type,
    ext: extForMime(type, kind),
    start: () =>
      new Promise((resolve, reject) => {
        rec.onstart = () => resolve()
        rec.onerror = (e) => reject(e.error || new Error('Registrazione non avviata'))
        rec.start(1000)
      }),
    stop: () =>
      new Promise((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type }))
        if (rec.state === 'inactive') rec.onstop()
        else rec.stop()
      }),
    state: () => rec.state,
  }
}

/** Misuratore di livello sul microfono (RMS e picco, 0-1). */
export function createLevelMeter(ctx, stream) {
  const src = ctx.createMediaStreamSource(stream)
  const an = ctx.createAnalyser()
  an.fftSize = 1024
  src.connect(an)
  const buf = new Float32Array(an.fftSize)
  return {
    read() {
      an.getFloatTimeDomainData(buf)
      let peak = 0
      let sum = 0
      for (let i = 0; i < buf.length; i++) {
        const a = Math.abs(buf[i])
        if (a > peak) peak = a
        sum += buf[i] * buf[i]
      }
      return { rms: Math.sqrt(sum / buf.length), peak }
    },
    destroy() {
      try {
        src.disconnect()
      } catch {
        /* già scollegato */
      }
    },
  }
}
