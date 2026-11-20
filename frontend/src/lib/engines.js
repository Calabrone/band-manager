// Motori di riproduzione del player della Sala prove, con la stessa interfaccia:
//   play(delaySec?) → Promise, pause(), seek(ms), setLoop({a, b, active}), position() → ms,
//   duration() → ms, isPlaying(), setVolume(0-1), on('play'|'pause'|'ended', fn) → off, destroy()
//
// • createBufferEngine: audio decodificato in memoria (Web Audio). Il loop è del motore audio, senza stacchi,
//   e la posizione si ricava dal clock dell'AudioContext, quindi è sample-accurate e sincronizzabile con altri motori.
// • createMediaEngine: <video>/<audio>. Il loop è un controllo a ogni frame (con un piccolo stacco al giro).
//
// Nessun accesso al browser in fase di import: i motori ricevono contesto/elemento, e si provano con node --test.

import { wrapLoop } from './loop.js'

/** Oltre questa dimensione un audio non si decodifica in memoria: si usa l'elemento <audio>. */
export const BUFFER_MAX_BYTES = 60 * 1024 * 1024

const NO_LOOP = { a: 0, b: 0, active: false }

function emitter() {
  const handlers = {}
  return {
    on(evt, fn) {
      ;(handlers[evt] ||= new Set()).add(fn)
      return () => handlers[evt].delete(fn)
    },
    emit(evt) {
      handlers[evt]?.forEach((fn) => fn())
    },
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function normalizeLoop(l) {
  return l && l.active && l.b > l.a ? { a: l.a, b: l.b, active: true } : { a: l ? l.a : 0, b: l ? l.b : 0, active: false }
}

/** 'buffer' per gli audio non enormi, 'media' per i video e i file molto grandi. */
export function engineKindFor(take) {
  return take.kind === 'audio' && take.size <= BUFFER_MAX_BYTES ? 'buffer' : 'media'
}

// ── AudioContext condiviso e decodifica ─────────────────────────────────────

let shared = null

export function getAudioContext() {
  if (!shared) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    shared = new Ctx({ latencyHint: 'interactive' })
  }
  return shared
}

/** decodeAudioData in forma a callback: funziona anche sui Safari più vecchi. */
export function decodeAudio(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => ctx.decodeAudioData(arrayBuffer, resolve, reject))
}

export async function loadBuffer(ctx, url, { signal } = {}) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Download non riuscito (${res.status})`)
  return decodeAudio(ctx, await res.arrayBuffer())
}

// ── Motore Web Audio ────────────────────────────────────────────────────────

export function createBufferEngine({ ctx, buffer, output }) {
  const ev = emitter()
  const gain = ctx.createGain()
  gain.connect(output || ctx.destination)
  const total = buffer.duration * 1000
  let loop = NO_LOOP
  let src = null
  let playing = false
  let p0 = 0 // posizione (ms) all'istante t0
  let t0 = 0 // clock dell'AudioContext a cui corrisponde p0 (futuro se la partenza è ritardata)

  function position() {
    if (!playing) return p0
    let pos = p0 + Math.max(0, (ctx.currentTime - t0) * 1000)
    if (loop.active && pos >= loop.b) pos = loop.a + ((pos - loop.b) % (loop.b - loop.a))
    return Math.min(pos, total)
  }

  function stopSource() {
    if (!src) return
    src.onended = null
    try {
      src.stop()
    } catch {
      /* già fermo */
    }
    try {
      src.disconnect()
    } catch {
      /* già scollegato */
    }
    src = null
  }

  function startSource(delaySec) {
    stopSource()
    if (loop.active && p0 >= loop.b) p0 = loop.a
    if (!loop.active && p0 >= total - 10) p0 = 0 // play a fine contenuto: riparte da capo
    const s = ctx.createBufferSource()
    s.buffer = buffer
    s.connect(gain)
    if (loop.active) {
      s.loop = true
      s.loopStart = loop.a / 1000
      s.loopEnd = loop.b / 1000
    }
    s.onended = () => {
      if (src !== s) return
      src = null
      playing = false
      p0 = total
      ev.emit('pause')
      ev.emit('ended')
    }
    t0 = ctx.currentTime + delaySec
    s.start(t0, p0 / 1000)
    src = s
    playing = true
  }

  return {
    kind: 'buffer',
    play(delaySec = 0) {
      if (playing) return Promise.resolve()
      if (ctx.state === 'suspended') ctx.resume()
      startSource(Math.max(0, delaySec))
      ev.emit('play')
      return Promise.resolve()
    },
    pause() {
      if (!playing) return
      p0 = position()
      stopSource()
      playing = false
      ev.emit('pause')
    },
    seek(ms) {
      const to = clamp(ms, 0, total)
      p0 = to
      if (playing) startSource(0)
    },
    setLoop(l) {
      const next = normalizeLoop(l)
      if (!playing) {
        loop = next
        return
      }
      const pos = position()
      loop = next
      if (next.active && pos >= next.b) {
        p0 = next.a
        startSource(0)
        return
      }
      if (ctx.currentTime >= t0) {
        p0 = pos
        t0 = ctx.currentTime
      }
      if (src) {
        src.loop = next.active
        if (next.active) {
          src.loopStart = next.a / 1000
          src.loopEnd = next.b / 1000
        }
      }
    },
    position,
    duration: () => total,
    isPlaying: () => playing,
    setVolume(v) {
      gain.gain.value = clamp(v, 0, 1)
    },
    on: ev.on,
    destroy() {
      stopSource()
      playing = false
      try {
        gain.disconnect()
      } catch {
        /* già scollegato */
      }
    },
  }
}

// ── Motore a elemento media ─────────────────────────────────────────────────

export function createMediaEngine(el, { raf = (fn) => requestAnimationFrame(fn), caf = (id) => cancelAnimationFrame(id) } = {}) {
  const ev = emitter()
  let loop = NO_LOOP
  let frame = null
  let timer = null

  function tick() {
    frame = null
    if (el.paused) return
    const to = wrapLoop(el.currentTime * 1000, loop)
    if (to !== null) el.currentTime = to / 1000
    frame = raf(tick)
  }

  const onPlay = () => {
    ev.emit('play')
    if (frame === null) frame = raf(tick)
  }
  const onPause = () => ev.emit('pause')
  const onEnded = () => {
    if (loop.active) {
      el.currentTime = loop.a / 1000
      el.play()?.catch?.(() => {})
    } else {
      ev.emit('ended')
    }
  }
  el.addEventListener('play', onPlay)
  el.addEventListener('pause', onPause)
  el.addEventListener('ended', onEnded)

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    kind: 'media',
    play(delaySec = 0) {
      clearTimer()
      if (delaySec > 0) {
        return new Promise((resolve) => {
          timer = setTimeout(() => {
            timer = null
            Promise.resolve(el.play()).then(resolve, resolve)
          }, delaySec * 1000)
        })
      }
      return Promise.resolve(el.play())
    },
    pause() {
      clearTimer()
      el.pause()
    },
    seek(ms) {
      const d = el.duration
      el.currentTime = clamp(ms, 0, Number.isFinite(d) ? d * 1000 : ms) / 1000
    },
    setLoop(l) {
      loop = normalizeLoop(l)
    },
    position: () => (el.currentTime || 0) * 1000,
    duration: () => (Number.isFinite(el.duration) ? el.duration * 1000 : 0),
    isPlaying: () => !el.paused && !el.ended,
    setVolume(v) {
      try {
        el.volume = clamp(v, 0, 1) // iOS ignora il volume degli elementi media
      } catch {
        /* non impostabile */
      }
    },
    on: ev.on,
    destroy() {
      clearTimer()
      if (frame !== null) caf(frame)
      frame = null
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('ended', onEnded)
    },
  }
}
