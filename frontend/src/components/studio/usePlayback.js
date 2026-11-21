import { useEffect, useMemo, useRef, useState } from 'react'
import client from '../../api/client'
import { createBufferEngine, createMediaEngine, engineKindFor, getAudioContext, loadBuffer } from '../../lib/engines'
import { computePeaks } from '../../lib/peaks'
import { baseTimeFor } from '../../lib/sync'

const NO_LOOP = { a: 0, b: 0, active: false }
const DRIFT_MS = 40
const CHECK_EVERY_MS = 250
// Per un audio si prova prima lo streaming con <audio> (pronto in un attimo); se i metadati non arrivano entro questo tempo
// si aspetta il download completo, come prima.
const STREAM_WAIT_MS = 8000
// Lo streaming parte da solo con i metadati; il download completo comincia appena arrivano (o dopo questo tempo),
// così le due richieste non si contendono la banda proprio all'inizio.
const BUFFER_START_MS = 1500
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
  const volumeRef = useRef(1)
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
    let setMainReady
    const mainReady = new Promise((r) => { setMainReady = r })

    function releaseElement(el) {
      el.pause()
      el.removeAttribute('src')
      el.load()
    }

    /** Collega gli eventi del motore principale allo stato del player. */
    function wireMain(m) {
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
    }

    /** Forma d'onda e durata dal buffer decodificato; la forma d'onda mancante sul server si salva una volta sola. */
    function applyDecoded(buffer) {
      setDuration(Math.round(buffer.duration * 1000))
      if (!t.peaks) {
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
        const peaks = computePeaks(channels, buffer.sampleRate)
        setLocalPeaks(peaks)
        if (Number.isInteger(t.id) && peaks.length) {
          client.put(`/studio/takes/${t.id}/analysis`, { peaks, duration_ms: Math.round(buffer.duration * 1000) }).catch(() => {})
        }
      }
    }

    /** <audio> in streaming: risolve con l'elemento appena ci sono i metadati, con null se non arrivano o c'è un errore. */
    function openStreaming() {
      return new Promise((resolve) => {
        const el = new Audio()
        el.preload = 'metadata'
        let done = false
        let timer = null
        const finish = (ok) => {
          if (done) return
          done = true
          clearTimeout(timer)
          el.removeEventListener('loadedmetadata', onOk)
          el.removeEventListener('error', onBad)
          ctrl.signal.removeEventListener('abort', onBad)
          if (ok) resolve(el)
          else {
            releaseElement(el)
            resolve(null)
          }
        }
        const onOk = () => finish(true)
        const onBad = () => finish(false)
        el.addEventListener('loadedmetadata', onOk)
        el.addEventListener('error', onBad)
        ctrl.signal.addEventListener('abort', onBad)
        timer = setTimeout(onBad, STREAM_WAIT_MS)
        el.src = t.file_url
      })
    }

    /** Quando il file è decodificato passa dallo streaming al motore Web Audio (loop senza stacchi), senza interrompere l'ascolto. */
    function upgradeWhenReady(oldEngine, el, buffer) {
      const swap = () => {
        if (cancelled || main.current !== oldEngine) return
        const pos = oldEngine.position()
        const engine = createBufferEngine({ ctx: getAudioContext(), buffer })
        engine.setLoop(loopRef.current)
        engine.setVolume(volumeRef.current)
        engine.seek(pos)
        wireMain(engine)
        main.current = engine
        oldEngine.destroy()
        releaseElement(el)
        applyDecoded(buffer)
      }
      mainReady.then(() => {
        if (cancelled) return
        // se sta suonando si aspetta la prossima pausa: il cambio di motore non deve mai tagliare l'audio
        if (oldEngine.isPlaying()) {
          const off = oldEngine.on('pause', () => {
            off()
            swap()
          })
        } else swap()
      })
    }

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
        const ctx = getAudioContext()
        // Prima lo streaming (metadati), poi download+decodifica: vince chi è pronto prima (di solito lo streaming)
        let startBuffer
        const bufferGo = new Promise((r) => { startBuffer = r })
        const bufferP = bufferGo
          .then(() => loadBuffer(ctx, t.file_url, { signal: ctrl.signal }))
          .catch((err) => (err?.name === 'AbortError' ? 'aborted' : null))
        const streamP = openStreaming()
        streamP.then(startBuffer)
        setTimeout(startBuffer, BUFFER_START_MS)
        const first = await Promise.race([bufferP.then((buffer) => ({ buffer })), streamP.then((streamEl) => ({ streamEl }))])
        if (cancelled) return null
        if (first.buffer === 'aborted') return null
        if (first.buffer) {
          streamP.then((streamEl) => streamEl && releaseElement(streamEl))
          applyDecoded(first.buffer)
          return createBufferEngine({ ctx, buffer: first.buffer })
        }
        const streamEl = first.streamEl ?? (await streamP)
        if (cancelled) return null
        if (streamEl) {
          watchElement(streamEl)
          cleanups.push(() => releaseElement(streamEl))
          const engine = createMediaEngine(streamEl)
          bufferP.then((buffer) => {
            if (buffer && buffer !== 'aborted' && !cancelled) upgradeWhenReady(engine, streamEl, buffer)
          })
          return engine
        }
        // niente streaming: si aspetta il download completo
        const buffer = await bufferP
        if (cancelled || buffer === 'aborted') return null
        if (buffer) {
          applyDecoded(buffer)
          return createBufferEngine({ ctx, buffer })
        }
        // formato non decodificabile: si prova con l'elemento <audio>
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
        wireMain(m)
        m.setLoop(loopRef.current)
        setStatus('ready')
        setMainReady()
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
        if (which !== 'base') volumeRef.current = v
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
