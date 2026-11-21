import { useEffect, useMemo, useRef, useState } from 'react'
import client from '../../api/client'
import { createBufferEngine, createMediaEngine, engineKindFor, getAudioContext, loadBuffer } from '../../lib/engines'
import { computePeaks } from '../../lib/peaks'
import { baseTimeFor } from '../../lib/sync'

const NO_LOOP = { a: 0, b: 0, active: false }
const DRIFT_MS = 40
const CHECK_EVERY_MS = 250
const UNPLAYABLE = 'Questo dispositivo non riesce a riprodurre il formato: scarica il file per ascoltarlo.'

/**
 * Motori di riproduzione di un contenuto della Sala prove, ed eventuale base della sovraincisione.
 *  • Video: <video> (elemento passato in `videoRef`). Audio: Web Audio (decodificato) o <audio> se enorme/non decodificabile.
 *  • Con una base: un secondo motore Web Audio suona la base allineata col modello di lib/sync.js
 *    (b(t) = t − sync − offset + base_start), ricontrollata ogni 250 ms e a ogni giro del loop.
 * Ritorna lo stato e un oggetto `api` stabile (play, pause, seek, setLoop, setOffset, setVolume, getPosition…).
 */
export default function usePlayback(take, videoRef) {
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [baseError, setBaseError] = useState('')
  const [duration, setDuration] = useState(take.duration_ms || 0)
  const [playing, setPlaying] = useState(false)
  const [localPeaks, setLocalPeaks] = useState(null)

  const main = useRef(null)
  const base = useRef(null)
  const playingRef = useRef(false)
  const takeRef = useRef(take)
  takeRef.current = take
  const offsetRef = useRef(take.offset_ms || 0)
  const loopRef = useRef(NO_LOOP)
  // L'URL firmato cambia a ogni richiesta (nuova scadenza): il contenuto si riconosce dal percorso, senza query
  const fileKey = take.file_url.split('?')[0]
  const baseKey = take.base ? take.base.file_url.split('?')[0] : null

  // ── Caricamento ──
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    const cleanups = []
    const t = takeRef.current
    offsetRef.current = t.offset_ms || 0
    setStatus('loading')
    setError('')
    setBaseError('')
    setDuration(t.duration_ms || 0)
    setPlaying(false)
    playingRef.current = false
    setLocalPeaks(null)

    function watchElement(el) {
      const onMeta = () => {
        if (Number.isFinite(el.duration) && el.duration > 0) setDuration(Math.round(el.duration * 1000))
      }
      const onErr = () => {
        if (cancelled) return
        setError(UNPLAYABLE)
        setStatus('error')
      }
      el.addEventListener('loadedmetadata', onMeta)
      el.addEventListener('durationchange', onMeta)
      el.addEventListener('error', onErr)
      cleanups.push(() => {
        el.removeEventListener('loadedmetadata', onMeta)
        el.removeEventListener('durationchange', onMeta)
        el.removeEventListener('error', onErr)
      })
      if (el.readyState >= 1) onMeta()
    }

    async function loadMain() {
      if (t.kind === 'video') {
        const el = videoRef.current
        if (!el) throw new Error('Elemento video non disponibile')
        watchElement(el)
        return createMediaEngine(el)
      }
      if (engineKindFor(t) === 'buffer') {
        try {
          const ctx = getAudioContext()
          const buffer = await loadBuffer(ctx, t.file_url, { signal: ctrl.signal })
          if (cancelled) return null
          setDuration(Math.round(buffer.duration * 1000))
          if (!t.peaks) {
            const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
            const peaks = computePeaks(channels, buffer.sampleRate)
            setLocalPeaks(peaks)
            // Solo la prima volta: si salva sul server, così le aperture successive trovano la forma d'onda già pronta
            if (Number.isInteger(t.id) && peaks.length) {
              client.put(`/studio/takes/${t.id}/analysis`, { peaks, duration_ms: Math.round(buffer.duration * 1000) }).catch(() => {})
            }
          }
          return createBufferEngine({ ctx, buffer })
        } catch (err) {
          if (cancelled || err?.name === 'AbortError') return null
          // formato non decodificabile: si prova con l'elemento <audio>
        }
      }
      const el = new Audio()
      el.preload = 'auto'
      watchElement(el)
      el.src = t.file_url
      cleanups.push(() => {
        el.pause()
        el.removeAttribute('src')
        el.load()
      })
      return createMediaEngine(el)
    }

    async function loadBase() {
      if (!t.base) return null
      try {
        const ctx = getAudioContext()
        const buffer = await loadBuffer(ctx, t.base.file_url, { signal: ctrl.signal })
        const engine = createBufferEngine({ ctx, buffer })
        const a = t.base_loop_start_ms
        const b = t.base_loop_end_ms
        engine.setLoop(Number.isInteger(a) && Number.isInteger(b) ? { a, b, active: true } : NO_LOOP)
        return engine
      } catch (err) {
        if (!cancelled && err?.name !== 'AbortError') {
          setBaseError('La base non si può riprodurre su questo dispositivo: si sente solo questo contenuto.')
        }
        return null
      }
    }

    ;(async () => {
      try {
        const [m, b] = await Promise.all([loadMain(), loadBase()])
        if (cancelled || !m) {
          m?.destroy()
          b?.destroy()
          return
        }
        main.current = m
        base.current = b
        m.on('play', () => {
          playingRef.current = true
          setPlaying(true)
        })
        m.on('pause', () => {
          playingRef.current = false
          setPlaying(false)
          base.current?.pause()
        })
        m.on('ended', () => base.current?.pause())
        m.setLoop(loopRef.current)
        setStatus('ready')
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || UNPLAYABLE)
          setStatus('error')
        }
      }
    })()

    return () => {
      cancelled = true
      ctrl.abort()
      main.current?.destroy()
      base.current?.destroy()
      main.current = null
      base.current = null
      cleanups.forEach((fn) => fn())
    }
    // il contenuto cambia solo con un nuovo id o un nuovo file; videoRef è stabile
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take.id, fileKey, baseKey])

  // ── Allineamento della base ──
  const api = useMemo(() => {
    const params = () => ({
      sync_ms: takeRef.current.sync_ms || 0,
      offset_ms: offsetRef.current,
      base_start_ms: takeRef.current.base_start_ms || 0,
      base_loop_start_ms: takeRef.current.base_loop_start_ms,
      base_loop_end_ms: takeRef.current.base_loop_end_ms,
    })

    /** Riallinea la base alla posizione del contenuto: la riposiziona e, se serve, la fa partire (anche in ritardo). */
    function syncBase(shouldPlay, delaySec = 0) {
      const b = base.current
      const m = main.current
      if (!b || !m) return
      const p = params()
      const mainPos = m.position()
      b.pause()
      const at = baseTimeFor(mainPos, p)
      if (at === null) {
        b.seek(p.base_start_ms)
        if (shouldPlay) b.play(delaySec + (p.sync_ms + p.offset_ms - mainPos) / 1000)
      } else {
        b.seek(at)
        const ended = at >= b.duration() - 20 && !(Number.isInteger(p.base_loop_end_ms) && p.base_loop_end_ms > (p.base_loop_start_ms ?? 0))
        if (shouldPlay && !ended) b.play(delaySec)
      }
    }

    /** Se la base si è staccata di più di 40 ms dal punto atteso, la riallinea. */
    function checkDrift(mainPos) {
      const b = base.current
      if (!b) return
      const p = params()
      const expected = baseTimeFor(mainPos, p)
      if (expected === null) return
      const loopLen = Number.isInteger(p.base_loop_end_ms) && Number.isInteger(p.base_loop_start_ms) ? p.base_loop_end_ms - p.base_loop_start_ms : 0
      if (!b.isPlaying()) {
        if (expected < b.duration() - 20 || loopLen > 0) syncBase(true)
        return
      }
      let diff = Math.abs(b.position() - expected)
      if (loopLen > 0) {
        diff %= loopLen
        diff = Math.min(diff, loopLen - diff)
      }
      if (diff > DRIFT_MS) syncBase(true)
    }

    return {
      async play(delaySec = 0) {
        const m = main.current
        if (!m) return
        syncBase(true, delaySec)
        try {
          await m.play(delaySec)
        } catch (err) {
          base.current?.pause()
          throw err
        }
      },
      pause() {
        main.current?.pause()
        base.current?.pause()
      },
      seek(ms) {
        main.current?.seek(ms)
        if (base.current) syncBase(playingRef.current)
      },
      setLoop(l) {
        loopRef.current = l
        main.current?.setLoop(l)
      },
      setOffset(ms) {
        offsetRef.current = ms
        if (base.current) syncBase(playingRef.current)
      },
      setVolume(which, v) {
        const e = which === 'base' ? base.current : main.current
        e?.setVolume(v)
      },
      getPosition: () => main.current?.position() ?? 0,
      isPlaying: () => playingRef.current,
      syncBase,
      checkDrift,
    }
  }, [])

  // Con una base: a ogni giro del loop del contenuto e ogni 250 ms si riallinea
  useEffect(() => {
    if (!playing || !base.current) return undefined
    let id
    let last = api.getPosition()
    let lastCheck = performance.now()
    const tick = (now) => {
      id = requestAnimationFrame(tick)
      const pos = api.getPosition()
      if (pos < last - 150) api.syncBase(true)
      else if (now - lastCheck > CHECK_EVERY_MS) {
        lastCheck = now
        api.checkDrift(pos)
      }
      last = pos
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, status, api])

  return { status, error, baseError, duration, playing, localPeaks, hasBase: !!take.base, api }
}
