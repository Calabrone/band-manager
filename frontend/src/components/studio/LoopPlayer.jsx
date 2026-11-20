import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  AlertTriangle, Download, Flag, Loader2, Minus, Pause, Play, Plus, Repeat, Save, Scissors, Settings2, SkipBack,
  Timer, Volume2, VolumeX, ZoomIn, ZoomOut,
} from 'lucide-react'
import Timeline from './Timeline'
import usePlayback from './usePlayback'
import { btnSecondary } from './ui'
import { getAudioContext } from '../../lib/engines'
import { DEFAULT_BPM, scheduleCountIn } from '../../lib/countin'
import {
  fullView, followCursor, formatTime, loopFromTrim, moveHandle, zoomAt, zoomLevel,
} from '../../lib/loop'
import { MAX_OFFSET_MS, clampOffset } from '../../lib/sync'

const COUNT_KEY = 'studio_countin'
const DEFAULT_COUNT = { enabled: false, beatsPerBar: 4, bars: 1, everyLap: false }
const NUDGE_MS = 100

function loadCountIn() {
  try {
    return { ...DEFAULT_COUNT, ...JSON.parse(localStorage.getItem(COUNT_KEY) || '{}') }
  } catch {
    return DEFAULT_COUNT
  }
}

function Btn({ children, active, className = '', ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-40 flex items-center justify-center gap-1
        ${active ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-200 hover:bg-gray-700'} ${className}`}
    >
      {children}
    </button>
  )
}

function Slider({ label, value, min, max, step = 1, onChange, suffix = '', disabled }) {
  return (
    <label className="flex items-center gap-2 text-xs text-gray-400">
      <span className="w-28 flex-shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
             onChange={(e) => onChange(Number(e.target.value))} className="flex-1 accent-purple-500" />
      <span className="w-14 text-right font-mono text-gray-300">{value}{suffix}</span>
    </label>
  )
}

/**
 * Player di un contenuto della Sala prove: loop A-B con maniglie e rifiniture, taglio predefinito dell'autore,
 * zoom, conteggio, volume e, per le sovraincisioni, base allineata con offset e mixer.
 * Il loop è temporaneo (solo di chi ascolta); solo il taglio salvato dall'autore è visibile a tutti.
 */
const LoopPlayer = forwardRef(function LoopPlayer(
  { take, markers = [], isAuthor, projectBpm, onAddMarker, onSaveTrim, onSaveOffset, onOffsetChange, hint },
  ref
) {
  const videoRef = useRef(null)
  const pb = usePlayback(take, videoRef)
  const { api, status, playing } = pb
  const duration = pb.duration || take.duration_ms || 0
  const peaks = take.peaks || pb.localPeaks
  const hasTrim = take.trim_start_ms !== null && take.trim_start_ms !== undefined

  const touched = useRef(false)
  const lastDuration = useRef(0)
  const [loop, setLoopState] = useState(() => loopFromTrim(take.trim_start_ms, take.trim_end_ms, take.duration_ms || 0))
  const [view, setView] = useState(() => fullView(take.duration_ms || 0))
  const [posDisplay, setPosDisplay] = useState(0)
  const [redraw, setRedraw] = useState(0)
  const [countIn, setCountIn] = useState(loadCountIn)
  const [showCount, setShowCount] = useState(false)
  const [bpm, setBpm] = useState(projectBpm || DEFAULT_BPM)
  const [counting, setCounting] = useState(false)
  const [volume, setVolume] = useState(1)
  const [baseVolume, setBaseVolume] = useState(1)
  const [offset, setOffset] = useState(take.offset_ms || 0)
  const [message, setMessage] = useState('')
  const [playError, setPlayError] = useState('')
  const restarting = useRef(false)

  const lapMode = loop.active && countIn.enabled && countIn.everyLap
  const bump = () => setRedraw((n) => n + 1)

  // Quando la durata è nota (o cambia) si adatta il loop iniziale e la vista
  useEffect(() => {
    if (!duration) return
    if (!touched.current) setLoopState(loopFromTrim(take.trim_start_ms, take.trim_end_ms, duration))
    setView((v) => (v.spanMs === 0 || (v.startMs === 0 && v.spanMs >= lastDuration.current - 1) ? fullView(duration) : v))
    lastDuration.current = duration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration])

  // Il motore riceve il loop (senza loop nativo in modalità "conteggio a ogni giro": lo gestisce il ciclo sotto)
  useEffect(() => {
    if (status === 'ready') api.setLoop(lapMode ? { ...loop, active: false } : loop)
  }, [status, loop, lapMode, api])

  // Pronto: parte da A se c'è un taglio, altrimenti dall'inizio
  useEffect(() => {
    if (status !== 'ready') return
    api.seek(loop.active ? loop.a : 0)
    setPosDisplay(api.getPosition())
    bump()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  useEffect(() => {
    if (status === 'ready') {
      setPosDisplay(api.getPosition())
      bump()
    }
  }, [playing, status, api])

  useEffect(() => {
    try {
      localStorage.setItem(COUNT_KEY, JSON.stringify(countIn))
    } catch {
      // storage non disponibile
    }
  }, [countIn])

  // ── Azioni ──
  const startPlayback = useCallback(async ({ count = true } = {}) => {
    setPlayError('')
    const pos = api.getPosition()
    if (loop.active && (pos < loop.a || pos >= loop.b - 50)) api.seek(loop.a)
    else if (!loop.active && duration && pos >= duration - 50) api.seek(0)
    let delay = 0
    if (count && countIn.enabled) {
      const ctx = getAudioContext()
      if (ctx.state === 'suspended') ctx.resume()
      const end = scheduleCountIn(ctx, ctx.currentTime + 0.05, { bpm, beatsPerBar: countIn.beatsPerBar, bars: countIn.bars })
      delay = Math.max(0, end - ctx.currentTime)
      setCounting(true)
      setTimeout(() => setCounting(false), delay * 1000)
    }
    try {
      await api.play(delay)
    } catch {
      setCounting(false)
      setPlayError('Il browser ha bloccato la riproduzione: tocca di nuovo Play.')
    }
  }, [api, loop, duration, countIn, bpm])
  const startRef = useRef(startPlayback)
  startRef.current = startPlayback

  // Posizione a schermo e, col conteggio a ogni giro, stop a B → conteggio → ripartenza da A
  useEffect(() => {
    if (status !== 'ready' || !playing) return undefined
    let id
    let last = 0
    const tick = (t) => {
      id = requestAnimationFrame(tick)
      const pos = api.getPosition()
      if (t - last > 100) {
        last = t
        setPosDisplay(pos)
      }
      if (lapMode && !restarting.current && api.isPlaying() && pos >= loop.b - 30) {
        restarting.current = true
        api.pause()
        api.seek(loop.a)
        startRef.current().finally(() => {
          restarting.current = false
        })
      }
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [status, playing, lapMode, loop, api])

  function doSeek(ms) {
    const to = Math.max(0, Math.min(duration || ms, ms))
    api.seek(to)
    setPosDisplay(to)
    bump()
  }

  function changeLoop(next, activate = true) {
    touched.current = true
    setLoopState((l) => ({ a: next.a, b: next.b, active: activate ? true : l.active }))
  }

  function togglePlay() {
    if (status !== 'ready') return
    if (playing) api.pause()
    else startPlayback()
  }

  async function seekAndPlay(ms) {
    if (status !== 'ready') return
    if (loop.active && (ms < loop.a || ms >= loop.b)) {
      // un punto fuori dal loop: lo si disattiva, altrimenti il motore ripartirebbe da A
      touched.current = true
      setLoopState((l) => ({ ...l, active: false }))
      api.setLoop({ ...loop, active: false })
    }
    doSeek(ms)
    setView((v) => followCursor(v, ms, duration))
    if (!api.isPlaying()) await startPlayback({ count: false })
  }

  useImperativeHandle(ref, () => ({ seekAndPlay, pause: () => api.pause(), getPosition: () => api.getPosition() }))

  function setPoint(which) {
    const pos = api.getPosition()
    const base = loop.b > loop.a ? loop : { a: 0, b: duration }
    changeLoop(moveHandle(base, which, pos, duration))
  }

  function nudge(which, delta) {
    const base = loop.b > loop.a ? loop : { a: 0, b: duration }
    changeLoop(moveHandle(base, which, base[which] + delta, duration))
  }

  function toggleLoop() {
    touched.current = true
    setLoopState((l) => {
      const base = l.b > l.a ? l : { a: 0, b: duration }
      return { a: base.a, b: base.b, active: !l.active }
    })
  }

  function showAll() {
    touched.current = true
    setLoopState({ a: 0, b: duration, active: false })
  }

  function useAuthorTrim() {
    touched.current = true
    setLoopState(loopFromTrim(take.trim_start_ms, take.trim_end_ms, duration))
    doSeek(take.trim_start_ms)
  }

  async function saveTrim(clear) {
    setMessage('')
    try {
      await onSaveTrim(clear ? null : Math.round(loop.a), clear ? null : Math.round(loop.b))
      setMessage(clear ? 'Taglio rimosso' : 'Taglio salvato: gli altri lo troveranno già impostato')
      if (clear) showAll()
    } catch (err) {
      setMessage(err?.response?.data?.detail || 'Salvataggio non riuscito')
    }
  }

  async function saveOffset() {
    setMessage('')
    try {
      await onSaveOffset(offset)
      setMessage('Offset salvato')
    } catch (err) {
      setMessage(err?.response?.data?.detail || 'Salvataggio non riuscito')
    }
  }

  function zoomBy(factor) {
    const pos = api.getPosition()
    const anchor = pos >= view.startMs && pos <= view.startMs + view.spanMs ? pos : view.startMs + view.spanMs / 2
    setView(zoomAt(view, factor, anchor, duration))
  }

  function changeOffset(ms) {
    const v = clampOffset(ms)
    setOffset(v)
    api.setOffset(v)
    onOffsetChange?.(v)
  }

  function changeVolume(v) {
    setVolume(v)
    api.setVolume('main', v)
  }

  function changeBaseVolume(v) {
    setBaseVolume(v)
    api.setVolume('base', v)
  }

  // ── Tastiera (PC) ──
  const keys = useRef({})
  keys.current = { togglePlay, setPoint, toggleLoop, onAddMarker, zoomBy, doSeek, api, duration }
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const k = keys.current
      const step = e.shiftKey ? 5000 : 1000
      switch (e.key) {
        case ' ': e.preventDefault(); k.togglePlay(); break
        case 'a': case 'A': k.setPoint('a'); break
        case 'b': case 'B': k.setPoint('b'); break
        case 'l': case 'L': k.toggleLoop(); break
        case 'm': case 'M': k.onAddMarker?.(k.api.getPosition()); break
        case 'ArrowLeft': e.preventDefault(); k.doSeek(k.api.getPosition() - step); break
        case 'ArrowRight': e.preventDefault(); k.doSeek(k.api.getPosition() + step); break
        case '+': case '=': k.zoomBy(2); break
        case '-': k.zoomBy(0.5); break
        default:
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const ready = status === 'ready'
  const trim = hasTrim ? { start: take.trim_start_ms, end: take.trim_end_ms } : null
  const offsetRange = Math.max(500, Math.abs(offset))
  const offsetDirty = offset !== (take.offset_ms || 0)

  return (
    <div className="space-y-3">
      {take.kind === 'video' && (
        <video
          ref={videoRef}
          src={take.file_url}
          playsInline
          preload="metadata"
          onClick={togglePlay}
          className="w-full max-h-[45vh] bg-black rounded-xl"
        />
      )}

      {status === 'loading' && (
        <p className="text-xs text-gray-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Carico il contenuto…
        </p>
      )}
      {status === 'error' && (
        <div className="p-3 rounded-xl bg-red-900/20 border border-red-900/40 text-sm text-red-300 space-y-2">
          <p className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />{pb.error}</p>
          <a href={`${take.file_url}&dl=1`} className="inline-flex items-center gap-1 text-purple-300 underline">
            <Download className="w-4 h-4" /> Scarica il file
          </a>
        </div>
      )}
      {pb.baseError && <p className="text-xs text-amber-400">{pb.baseError}</p>}
      {hint && <p className="text-xs text-purple-200 bg-purple-900/20 rounded-lg px-3 py-2">{hint}</p>}

      <Timeline
        duration={duration}
        peaks={peaks}
        view={view}
        onViewChange={setView}
        loop={loop}
        onLoopChange={(l) => changeLoop(l)}
        trim={trim}
        markers={markers}
        getPosition={api.getPosition}
        playing={playing}
        redrawKey={redraw}
        onSeek={doSeek}
        onAddMarkerAt={onAddMarker}
        onMarkerClick={(m) => seekAndPlay(m.time_ms)}
      />

      {/* Tempo e zoom */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span className="font-mono">{formatTime(posDisplay)} / {formatTime(duration)}</span>
        <div className="flex items-center gap-1">
          <Btn onClick={() => zoomBy(0.5)} disabled={view.spanMs >= duration} title="Riduci zoom"><ZoomOut className="w-4 h-4" /></Btn>
          <span className="w-9 text-center font-mono">×{zoomLevel(view, duration).toFixed(zoomLevel(view, duration) < 10 ? 1 : 0)}</span>
          <Btn onClick={() => zoomBy(2)} title="Ingrandisci"><ZoomIn className="w-4 h-4" /></Btn>
        </div>
      </div>

      {/* Trasporto */}
      <div className="flex items-center justify-center gap-3">
        <Btn onClick={() => doSeek(loop.active ? loop.a : 0)} disabled={!ready} title={loop.active ? 'Torna ad A' : 'Torna all\'inizio'} className="w-11 h-11 !rounded-full">
          <SkipBack className="w-5 h-5" />
        </Btn>
        <button
          type="button"
          onClick={togglePlay}
          disabled={!ready}
          className="w-16 h-16 rounded-full bg-brand-600 hover:bg-brand-700 disabled:opacity-40 flex items-center justify-center text-white"
          title={playing ? 'Pausa' : 'Play'}
        >
          {playing ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-1" />}
        </button>
        <Btn onClick={toggleLoop} disabled={!ready} active={loop.active} title="Loop A-B (L)" className="w-11 h-11 !rounded-full">
          <Repeat className="w-5 h-5" />
        </Btn>
      </div>
      {counting && <p className="text-center text-xs text-purple-300">Conteggio…</p>}
      {playError && <p className="text-center text-xs text-amber-400">{playError}</p>}

      {/* Punti A e B */}
      <div className="grid grid-cols-2 gap-2">
        {['a', 'b'].map((which) => (
          <div key={which} className="p-2 rounded-xl bg-gray-900 border border-gray-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-purple-300">{which.toUpperCase()}</span>
              <span className="text-xs font-mono text-gray-300">{formatTime(loop[which])}</span>
            </div>
            <div className="flex gap-1">
              <Btn onClick={() => setPoint(which)} disabled={!ready} className="flex-1">{which.toUpperCase()} qui</Btn>
              <Btn onClick={() => nudge(which, -NUDGE_MS)} disabled={!ready} title="−0,1 s"><Minus className="w-3 h-3" />0,1</Btn>
              <Btn onClick={() => nudge(which, NUDGE_MS)} disabled={!ready} title="+0,1 s"><Plus className="w-3 h-3" />0,1</Btn>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Btn onClick={showAll} disabled={!ready}>Tutto</Btn>
        {hasTrim && <Btn onClick={useAuthorTrim} disabled={!ready}><Scissors className="w-3 h-3" /> Taglio dell'autore</Btn>}
        <Btn onClick={() => onAddMarker?.(api.getPosition())} disabled={!ready}><Flag className="w-3 h-3" /> Marker qui</Btn>
        {isAuthor && (
          <>
            <Btn onClick={() => saveTrim(false)} disabled={!ready || loop.b <= loop.a}><Save className="w-3 h-3" /> Salva come taglio predefinito</Btn>
            {hasTrim && <Btn onClick={() => saveTrim(true)}>Rimuovi taglio</Btn>}
          </>
        )}
      </div>
      {message && <p className="text-xs text-purple-300">{message}</p>}

      {/* Conteggio */}
      <div className="p-2 rounded-xl bg-gray-900 border border-gray-800 space-y-2">
        <div className="flex items-center justify-between">
          <Btn active={countIn.enabled} onClick={() => setCountIn((c) => ({ ...c, enabled: !c.enabled }))}>
            <Timer className="w-3 h-3" /> Conteggio {countIn.enabled ? 'attivo' : 'spento'}
          </Btn>
          {countIn.enabled && (
            <Btn onClick={() => setShowCount((s) => !s)} title="Impostazioni del conteggio"><Settings2 className="w-3 h-3" /></Btn>
          )}
        </div>
        {countIn.enabled && showCount && (
          <div className="grid grid-cols-3 gap-2 text-xs text-gray-400">
            <label>Tempi
              <select value={countIn.beatsPerBar} onChange={(e) => setCountIn((c) => ({ ...c, beatsPerBar: Number(e.target.value) }))}
                      className="w-full mt-1 px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-white">
                {[2, 3, 4, 6].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label>Battute
              <select value={countIn.bars} onChange={(e) => setCountIn((c) => ({ ...c, bars: Number(e.target.value) }))}
                      className="w-full mt-1 px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-white">
                {[1, 2].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label>BPM
              <input type="number" min={40} max={300} value={bpm} onChange={(e) => setBpm(Math.max(40, Math.min(300, Number(e.target.value) || DEFAULT_BPM)))}
                     className="w-full mt-1 px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-white" />
            </label>
            <label className="col-span-3 flex items-center gap-2">
              <input type="checkbox" checked={countIn.everyLap} onChange={(e) => setCountIn((c) => ({ ...c, everyLap: e.target.checked }))} />
              Ripeti il conteggio a ogni giro del loop
            </label>
          </div>
        )}
      </div>

      {/* Volume e, per le sovraincisioni, base e mixer */}
      <div className="p-2 rounded-xl bg-gray-900 border border-gray-800 space-y-2">
        <div className="flex items-center gap-2">
          {volume === 0 ? <VolumeX className="w-4 h-4 text-gray-500" /> : <Volume2 className="w-4 h-4 text-gray-400" />}
          <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => changeVolume(Number(e.target.value))}
                 className="flex-1 accent-purple-500" />
          <span className="text-xs text-gray-400 w-24 text-right">{pb.hasBase ? 'Questo contenuto' : 'Volume'}</span>
        </div>
        {pb.hasBase && (
          <>
            <div className="flex items-center gap-2">
              {baseVolume === 0 ? <VolumeX className="w-4 h-4 text-gray-500" /> : <Volume2 className="w-4 h-4 text-gray-400" />}
              <input type="range" min={0} max={1} step={0.05} value={baseVolume} onChange={(e) => changeBaseVolume(Number(e.target.value))}
                     className="flex-1 accent-purple-500" />
              <span className="text-xs text-gray-400 w-24 text-right">Base: «{take.base.title}»</span>
            </div>
            <div className="space-y-1.5 pt-1 border-t border-gray-800">
              <Slider label="Allineamento" value={offset} min={-offsetRange} max={offsetRange} step={5} suffix=" ms" onChange={changeOffset} />
              <div className="flex gap-1 justify-end">
                {[-20, -5, 5, 20].map((d) => (
                  <Btn key={d} onClick={() => changeOffset(offset + d)}>{d > 0 ? `+${d}` : d}</Btn>
                ))}
                <Btn onClick={() => changeOffset(take.offset_ms || 0)} disabled={!offsetDirty}>Ripristina</Btn>
              </div>
              <p className="text-[11px] text-gray-500">
                Se la registrazione suona in ritardo rispetto alla base aumenta il valore, se anticipa diminuiscilo (limite ±{MAX_OFFSET_MS} ms).
              </p>
              {isAuthor && onSaveOffset && (
                <button type="button" onClick={saveOffset} disabled={!offsetDirty} className={btnSecondary}>
                  <Save className="w-4 h-4" /> Salva allineamento
                </button>
              )}
              {!isAuthor && <p className="text-[11px] text-gray-500">La regolazione vale solo per te: non modifica il contenuto.</p>}
            </div>
          </>
        )}
      </div>

      <p className="text-[11px] text-gray-600 hidden md:block">
        Tastiera: spazio play/pausa · A / B imposta i punti · L loop · M marker · ←/→ ±1 s · +/− zoom
      </p>
    </div>
  )
})

export default LoopPlayer
