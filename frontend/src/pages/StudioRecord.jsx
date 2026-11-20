import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Circle, Headphones, Loader2, Mic, Square, Upload, Video as VideoIcon } from 'lucide-react'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'
import BottomNav from '../components/BottomNav'
import ConfirmDialog from '../components/ConfirmDialog'
import Timeline from '../components/studio/Timeline'
import LoopPlayer from '../components/studio/LoopPlayer'
import { SizeTips } from '../components/studio/TakeUpload'
import { Field, btnPrimary, btnSecondary, errorText, formatSize, inputCls } from '../components/studio/ui'
import { DEFAULT_BPM, scheduleCountIn } from '../lib/countin'
import { createBufferEngine, getAudioContext, loadBuffer } from '../lib/engines'
import { clampLoop, fullView, formatTime } from '../lib/loop'
import { peaksFromBlob } from '../lib/probe'
import {
  createLevelMeter, createRecorder, levelPercent, listDevices, maxSeconds, openStream, recordingFileName,
  recordingSupported, stopStream,
} from '../lib/recorder'
import { clampOffset, computeSync, estimateLatencyMs } from '../lib/sync'

const COUNT_KEY = 'studio_countin'
const LATENCY_KEY = 'studio_latency_ms'

function readCountIn() {
  try {
    return { enabled: false, beatsPerBar: 4, bars: 1, everyLap: false, ...JSON.parse(localStorage.getItem(COUNT_KEY) || '{}') }
  } catch {
    return { enabled: false, beatsPerBar: 4, bars: 1, everyLap: false }
  }
}

function permissionMessage(err) {
  const name = err?.name
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Permesso negato: abilita microfono e fotocamera per questo sito nelle impostazioni del browser, poi riprova.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Nessun microfono o fotocamera trovati (o il dispositivo scelto non è più disponibile).'
  if (name === 'NotReadableError') return 'Il microfono o la fotocamera sono usati da un\'altra app: chiudila e riprova.'
  return 'Impossibile accedere al microfono o alla fotocamera.'
}

/** Ultimo allineamento scelto su questo dispositivo, altrimenti la stima del browser. */
function initialLatency(ctx, stream) {
  try {
    const saved = Number(localStorage.getItem(LATENCY_KEY))
    if (localStorage.getItem(LATENCY_KEY) !== null && Number.isFinite(saved)) return clampOffset(saved)
  } catch {
    // storage non disponibile
  }
  const inputLatency = stream?.getAudioTracks?.()[0]?.getSettings?.().latency
  return estimateLatencyMs({ outputLatency: ctx.outputLatency, baseLatency: ctx.baseLatency, inputLatency })
}

export default function StudioRecord() {
  const { pid } = useParams()
  const [params] = useSearchParams()
  const overId = params.get('over')
  const navigate = useNavigate()
  const { user } = useAuth()

  const [project, setProject] = useState(null)
  const [base, setBase] = useState(null)
  const [baseBuffer, setBaseBuffer] = useState(null)
  const [maxBytes, setMaxBytes] = useState(0)
  const [kind, setKind] = useState('audio')
  const [stream, setStream] = useState(null)
  const [devices, setDevices] = useState({ audioIn: [], videoIn: [] })
  const [audioDevice, setAudioDevice] = useState('')
  const [videoDevice, setVideoDevice] = useState('')
  const [phase, setPhase] = useState('setup') // setup | recording | processing | review
  const [level, setLevel] = useState({ rms: 0, peak: 0 })
  const [elapsed, setElapsed] = useState(0)
  const [bytes, setBytes] = useState(0)
  const [warn, setWarn] = useState('')
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [loop, setLoop] = useState({ a: 0, b: 0, active: true })
  const [view, setView] = useState({ startMs: 0, spanMs: 0 })
  const [countIn, setCountIn] = useState(readCountIn)
  const [bpm, setBpm] = useState(DEFAULT_BPM)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [trim, setTrim] = useState(null)
  const [offset, setOffset] = useState(0)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(null)
  const [confirmLeave, setConfirmLeave] = useState(false)

  const phaseRef = useRef('setup')
  const streamRef = useRef(null)
  const meterRef = useRef(null)
  const recorderRef = useRef(null)
  const baseEngineRef = useRef(null)
  const startedAt = useRef(0)
  const syncRef = useRef(null)
  const timerRef = useRef(null)
  const wakeRef = useRef(null)
  const previewRef = useRef(null)
  const abortRef = useRef(null)
  const initialOffset = useRef(0)
  const resultUrl = useRef(null)

  const go = useCallback((p) => {
    phaseRef.current = p
    setPhase(p)
  }, [])

  // ── Dati iniziali: brano di prova, limite di upload, base della sovraincisione ──
  useEffect(() => {
    let cancelled = false
    client.get(`/studio/projects/${pid}`).then(({ data }) => {
      if (cancelled) return
      setProject(data)
      if (data.bpm) setBpm(data.bpm)
    }).catch(() => !cancelled && setError('Brano di prova non trovato'))
    client.get('/config').then(({ data }) => !cancelled && setMaxBytes(data.max_upload_bytes || 0)).catch(() => {})
    if (overId) {
      client.get(`/studio/takes/${overId}`).then(async ({ data }) => {
        if (cancelled) return
        if (String(data.project_id) !== String(pid)) throw new Error('Il contenuto di base non appartiene a questo brano')
        setBase(data)
        const buffer = await loadBuffer(getAudioContext(), data.file_url)
        if (cancelled) return
        const dur = Math.round(buffer.duration * 1000)
        const hasTrim = data.trim_start_ms !== null
        setBaseBuffer(buffer)
        setLoop({ ...clampLoop(hasTrim ? data.trim_start_ms : 0, hasTrim ? data.trim_end_ms : dur, dur), active: true })
        setView(fullView(dur))
      }).catch((err) => {
        if (!cancelled) setError(errorText(err, err?.message || 'Impossibile caricare il contenuto di base: sulla sovraincisione serve un audio riproducibile.'))
      })
    }
    return () => { cancelled = true }
  }, [pid, overId])

  // ── Livello del microfono e anteprima video ──
  const setPreview = useCallback((el) => {
    previewRef.current = el
    if (el && streamRef.current) el.srcObject = streamRef.current
  }, [])

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = stream
    if (!stream || !stream.getAudioTracks().length) return undefined
    const ctx = getAudioContext()
    const meter = createLevelMeter(ctx, stream)
    meterRef.current = meter
    let id
    let n = 0
    const tick = () => {
      id = requestAnimationFrame(tick)
      if (++n % 3 === 0) setLevel(meter.read())
    }
    id = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(id)
      meter.destroy()
      meterRef.current = null
    }
  }, [stream])

  // ── Pulizia e avviso prima di uscire con una registrazione non salvata ──
  useEffect(() => {
    const warnLeave = (e) => {
      if (phaseRef.current !== 'setup') {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warnLeave)
    return () => {
      window.removeEventListener('beforeunload', warnLeave)
      clearInterval(timerRef.current)
      stopStream(streamRef.current)
      baseEngineRef.current?.destroy()
      abortRef.current?.abort()
      wakeRef.current?.release?.().catch(() => {})
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
    }
  }, [])

  async function enableDevices(next = {}) {
    setError('')
    const wanted = next.kind ?? kind
    try {
      stopStream(streamRef.current)
      const s = await openStream({
        kind: wanted,
        audioDeviceId: next.audio ?? audioDevice,
        videoDeviceId: wanted === 'video' ? (next.video ?? videoDevice) : '',
      })
      streamRef.current = s
      setStream(s)
      setDevices(await listDevices())
      setAudioDevice(s.getAudioTracks()[0]?.getSettings().deviceId ?? '')
      setVideoDevice(s.getVideoTracks()[0]?.getSettings().deviceId ?? '')
    } catch (err) {
      streamRef.current = null
      setStream(null)
      setError(permissionMessage(err))
    }
  }

  function changeKind(next) {
    setKind(next)
    if (streamRef.current) enableDevices({ kind: next })
  }

  function updateCountIn(patch) {
    const next = { ...countIn, ...patch }
    setCountIn(next)
    try {
      localStorage.setItem(COUNT_KEY, JSON.stringify(next))
    } catch {
      // storage non disponibile
    }
  }

  // ── Registrazione ──
  async function startRecording() {
    setError('')
    setInfo('')
    setWarn('')
    setBytes(0)
    setElapsed(0)
    try {
      const ctx = getAudioContext()
      await ctx.resume()
      const rec = createRecorder(streamRef.current, {
        kind,
        maxBytes,
        onSize: setBytes,
        onWarn: () => setWarn('Spazio quasi esaurito: la registrazione si fermerà da sola prima del limite di dimensione.'),
        onLimit: () => stopRecording('Registrazione fermata: raggiunto il limite di dimensione del file.'),
      })
      recorderRef.current = rec
      let engine = null
      if (base && baseBuffer) {
        engine = createBufferEngine({ ctx, buffer: baseBuffer })
        engine.setLoop(loop)
        engine.seek(loop.a)
        baseEngineRef.current = engine
      }
      await rec.start()
      const tRec = ctx.currentTime
      startedAt.current = performance.now()
      initialOffset.current = engine ? initialLatency(ctx, streamRef.current) : 0
      syncRef.current = null
      if (engine) {
        const t0 = ctx.currentTime + 0.25
        const tBase = countIn.enabled ? scheduleCountIn(ctx, t0, { bpm, beatsPerBar: countIn.beatsPerBar, bars: countIn.bars }) : t0
        engine.play(tBase - ctx.currentTime)
        syncRef.current = {
          sync_ms: computeSync(tRec, tBase),
          base_start_ms: Math.round(loop.a),
          base_loop_start_ms: Math.round(loop.a),
          base_loop_end_ms: Math.round(loop.b),
        }
      }
      go('recording')
      timerRef.current = setInterval(() => setElapsed(Math.round(performance.now() - startedAt.current)), 200)
      navigator.wakeLock?.request('screen').then((w) => { wakeRef.current = w }).catch(() => {})
    } catch (err) {
      baseEngineRef.current?.destroy()
      baseEngineRef.current = null
      setError(err?.message || 'Impossibile avviare la registrazione')
    }
  }

  async function stopRecording(message) {
    if (phaseRef.current !== 'recording') return
    go('processing')
    clearInterval(timerRef.current)
    baseEngineRef.current?.destroy()
    baseEngineRef.current = null
    wakeRef.current?.release?.().catch(() => {})
    wakeRef.current = null
    const measured = Math.round(performance.now() - startedAt.current)
    try {
      const rec = recorderRef.current
      const blob = await rec.stop()
      if (!rec.ext) throw new Error('Formato di registrazione non riconosciuto')
      const analysis = await peaksFromBlob(blob, measured)
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
      resultUrl.current = URL.createObjectURL(blob)
      setResult({
        blob, url: resultUrl.current, ext: rec.ext, kind, durationMs: analysis?.durationMs ?? measured,
        peaks: analysis?.peaks ?? null, sync: syncRef.current,
      })
      setTitle(base ? `Sopra a «${base.title}»` : `Registrazione ${new Date().toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`)
      setDescription('')
      setTrim(null)
      setOffset(initialOffset.current)
      setInfo(message || '')
      go('review')
    } catch (err) {
      setError(err?.message || 'Registrazione non riuscita')
      go('setup')
    }
  }

  function discard() {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current)
    resultUrl.current = null
    setResult(null)
    setInfo('')
    go('setup')
  }

  function leave() {
    if (phaseRef.current === 'setup') navigate(base ? `/studio/${pid}/takes/${overId}` : `/studio/${pid}`)
    else setConfirmLeave(true)
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setProgress(null)
    try {
      const fd = new FormData()
      fd.append('file', new File([result.blob], recordingFileName(title, result.ext), { type: result.blob.type }))
      fd.append('kind', result.kind)
      fd.append('title', title)
      if (description.trim()) fd.append('description', description)
      fd.append('duration_ms', String(result.durationMs))
      if (result.peaks?.length) fd.append('peaks', JSON.stringify(result.peaks))
      fd.append('recorded_in_app', '1')
      if (trim) {
        fd.append('trim_start_ms', String(Math.round(trim.a)))
        fd.append('trim_end_ms', String(Math.round(trim.b)))
      }
      if (base && result.sync) {
        fd.append('base_take_id', String(base.id))
        fd.append('offset_ms', String(clampOffset(offset)))
        for (const [k, v] of Object.entries(result.sync)) fd.append(k, String(v))
      }
      abortRef.current = new AbortController()
      const { data } = await client.post(`/studio/projects/${pid}/takes`, fd, {
        signal: abortRef.current.signal,
        onUploadProgress: (ev) => setProgress(ev.total ? Math.round((ev.loaded / ev.total) * 100) : null),
      })
      if (base) {
        try {
          localStorage.setItem(LATENCY_KEY, String(clampOffset(offset)))
        } catch {
          // storage non disponibile
        }
      }
      phaseRef.current = 'setup' // niente più avviso di uscita
      navigate(`/studio/${pid}/takes/${data.id}`, { replace: true, state: { justUploaded: true } })
    } catch (err) {
      if (err?.code !== 'ERR_CANCELED') setError(errorText(err, 'Upload non riuscito, riprova'))
      setSaving(false)
    }
  }

  // Take provvisorio per il player della revisione: il file è in memoria (blob), il resto come lo vedrebbe il server
  const pseudo = useMemo(() => {
    if (!result) return null
    const s = result.sync
    return {
      id: `rec-${result.url}`, project_id: Number(pid), user_id: user.id, username: user.username, title, description: '',
      kind: result.kind, size: result.blob.size, mime: result.blob.type, file_url: result.url, duration_ms: result.durationMs,
      peaks: result.peaks, trim_start_ms: trim ? trim.a : null, trim_end_ms: trim ? trim.b : null,
      base: base && s ? { id: base.id, title: base.title, file_url: base.file_url } : null,
      base_take_id: base && s ? base.id : null, offset_ms: initialOffset.current,
      sync_ms: s?.sync_ms ?? null, base_start_ms: s?.base_start_ms ?? null,
      base_loop_start_ms: s?.base_loop_start_ms ?? null, base_loop_end_ms: s?.base_loop_end_ms ?? null,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, trim, base, pid, user.id, user.username])

  const supported = recordingSupported()
  const limitSec = maxSeconds(kind, maxBytes)
  const baseDuration = baseBuffer ? Math.round(baseBuffer.duration * 1000) : 0
  const canStart = supported && !!stream && (!overId || !!baseBuffer)

  return (
    <div className="min-h-screen pb-24">
      <header className="flex items-center gap-3 px-4 py-3 bg-gray-950 border-b border-gray-800 sticky top-0 z-10">
        <button onClick={leave} className="p-1 text-gray-400 hover:text-gray-200"><ArrowLeft className="w-6 h-6" /></button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-white truncate">{overId ? 'Registra sopra' : 'Registra'}</h1>
          {project && <p className="text-[11px] text-gray-500 truncate">{project.title}</p>}
        </div>
      </header>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {!supported && (
          <p className="p-3 rounded-xl bg-amber-900/20 text-sm text-amber-300 flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            Questo browser non supporta la registrazione. Registra con l'app del telefono e usa «Carica file».
          </p>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {info && <p className="text-sm text-amber-300">{info}</p>}

        {/* ── Preparazione ── */}
        {phase === 'setup' && supported && (
          <>
            <div className="grid grid-cols-2 gap-2">
              {[['audio', 'Solo audio', Mic], ['video', 'Video + audio', VideoIcon]].map(([k, label, Icon]) => (
                <button key={k} type="button" onClick={() => changeKind(k)}
                        className={`py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 ${kind === k ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300'}`}>
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>

            {!stream ? (
              <button type="button" onClick={() => enableDevices()} className={`${btnPrimary} w-full py-3`}>
                {kind === 'video' ? 'Attiva fotocamera e microfono' : 'Attiva il microfono'}
              </button>
            ) : (
              <div className="space-y-3">
                {kind === 'video' && <video ref={setPreview} autoPlay muted playsInline className="w-full max-h-[40vh] bg-black rounded-xl" />}
                <div>
                  <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full transition-[width] duration-75" style={{ width: `${levelPercent(level.rms) * 100}%`, background: level.peak > 0.98 ? '#ef4444' : '#22c55e' }} />
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {level.peak > 0.98 ? <span className="text-red-400">Saturazione: abbassa il volume o allontanati dal microfono. </span> : 'Suona qualcosa per controllare il livello. '}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {devices.audioIn.length > 1 && (
                    <Field label="Microfono">
                      <select value={audioDevice} onChange={(e) => { setAudioDevice(e.target.value); enableDevices({ audio: e.target.value }) }} className={inputCls}>
                        {devices.audioIn.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microfono ${i + 1}`}</option>)}
                      </select>
                    </Field>
                  )}
                  {kind === 'video' && devices.videoIn.length > 1 && (
                    <Field label="Fotocamera">
                      <select value={videoDevice} onChange={(e) => { setVideoDevice(e.target.value); enableDevices({ video: e.target.value }) }} className={inputCls}>
                        {devices.videoIn.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Fotocamera ${i + 1}`}</option>)}
                      </select>
                    </Field>
                  )}
                </div>
              </div>
            )}

            {overId && (
              <div className="p-3 rounded-xl bg-gray-900 border border-gray-800 space-y-3">
                <p className="text-sm text-white">Base: «{base?.title ?? '…'}»</p>
                {!baseBuffer && !error && <p className="text-xs text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carico la base…</p>}
                {baseBuffer && (
                  <>
                    <Timeline
                      duration={baseDuration}
                      peaks={base.peaks}
                      view={view}
                      onViewChange={setView}
                      loop={loop}
                      onLoopChange={(l) => setLoop({ ...l, active: true })}
                      trim={null}
                      markers={[]}
                      getPosition={() => 0}
                      playing={false}
                      onSeek={() => {}}
                      height={96}
                    />
                    <p className="text-xs text-gray-400">
                      La base suonerà in cuffia in ripetizione da <span className="font-mono text-gray-200">{formatTime(loop.a)}</span> a{' '}
                      <span className="font-mono text-gray-200">{formatTime(loop.b)}</span> (trascina A e B per cambiare).
                    </p>
                    <div className="flex items-center gap-3 text-xs text-gray-300">
                      <label className="flex items-center gap-2">
                        <input type="checkbox" checked={countIn.enabled} onChange={(e) => updateCountIn({ enabled: e.target.checked })} />
                        Conteggio prima di partire
                      </label>
                      {countIn.enabled && (
                        <label className="flex items-center gap-1">
                          BPM
                          <input type="number" min={40} max={300} value={bpm} onChange={(e) => setBpm(Math.max(40, Math.min(300, Number(e.target.value) || DEFAULT_BPM)))}
                                 className="w-16 px-2 py-1 rounded-lg bg-gray-800 border border-gray-700 text-white" />
                        </label>
                      )}
                    </div>
                  </>
                )}
                <p className="flex gap-2 text-xs text-amber-300 bg-amber-900/20 rounded-lg p-2">
                  <Headphones className="w-4 h-4 flex-shrink-0" />
                  Usa le cuffie, meglio se con il filo (il Bluetooth ritarda l'audio): senza cuffie il microfono registra anche la base.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <SizeTips maxBytes={maxBytes} />
              {limitSec && (
                <p className="text-[11px] text-gray-500">
                  Con questa qualità la registrazione può durare circa {Math.floor(limitSec / 60)} min {limitSec % 60} s prima del limite di dimensione.
                </p>
              )}
            </div>

            <button type="button" onClick={startRecording} disabled={!canStart}
                    className="w-full py-4 rounded-2xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white font-semibold flex items-center justify-center gap-2">
              <Circle className="w-5 h-5 fill-current" /> Registra
            </button>
          </>
        )}

        {/* ── In registrazione ── */}
        {phase === 'recording' && (
          <div className="space-y-4">
            {kind === 'video' && <video ref={setPreview} autoPlay muted playsInline className="w-full max-h-[40vh] bg-black rounded-xl" />}
            <div className="text-center space-y-1">
              <p className="flex items-center justify-center gap-2 text-red-400 text-sm"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> Registrazione in corso</p>
              <p className="text-4xl font-mono text-white">{formatTime(elapsed)}</p>
              <p className="text-xs text-gray-500">{formatSize(bytes)}{maxBytes ? ` di ${formatSize(maxBytes)}` : ''}</p>
            </div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full transition-[width] duration-75" style={{ width: `${levelPercent(level.rms) * 100}%`, background: level.peak > 0.98 ? '#ef4444' : '#22c55e' }} />
            </div>
            {warn && <p className="text-sm text-amber-300 text-center">{warn}</p>}
            <button type="button" onClick={() => stopRecording()}
                    className="w-full py-4 rounded-2xl bg-gray-800 hover:bg-gray-700 text-white font-semibold flex items-center justify-center gap-2">
              <Square className="w-5 h-5 fill-current" /> Ferma
            </button>
          </div>
        )}

        {phase === 'processing' && (
          <p className="flex items-center justify-center gap-2 text-sm text-gray-400 py-12"><Loader2 className="w-5 h-5 animate-spin" /> Elaboro la registrazione…</p>
        )}

        {/* ── Revisione ── */}
        {phase === 'review' && pseudo && (
          <form onSubmit={save} className="space-y-4">
            <LoopPlayer
              key={pseudo.id}
              take={pseudo}
              markers={[]}
              isAuthor
              projectBpm={project?.bpm}
              onSaveTrim={async (a, b) => setTrim(a === null ? null : { a, b })}
              onOffsetChange={setOffset}
              hint={base
                ? 'Ascolta insieme base e registrazione: se non suonano a tempo regola l\'allineamento. Con A e B puoi anche scegliere la parte utile e premere «Salva come taglio predefinito».'
                : 'Riascolta. Con A e B puoi scegliere la parte utile e premere «Salva come taglio predefinito»: gli altri la troveranno già impostata.'}
            />
            <Field label="Titolo">
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required className={inputCls} />
            </Field>
            <Field label="Descrizione (facoltativa)">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} className={inputCls} />
            </Field>
            {saving && (
              <div>
                <div className="h-2 bg-gray-800 rounded-full overflow-hidden"><div className="h-full bg-brand-600 transition-all" style={{ width: `${progress ?? 5}%` }} /></div>
                <p className="text-xs text-gray-400 mt-1">Caricamento{progress !== null ? ` ${progress}%` : '…'}</p>
              </div>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => (saving ? abortRef.current?.abort() : discard())} className={`${btnSecondary} flex-1`}>
                {saving ? 'Annulla upload' : 'Scarta e registra di nuovo'}
              </button>
              <button type="submit" disabled={saving || !title.trim()} className={`${btnPrimary} flex-1`}>
                <Upload className="w-4 h-4" /> Salva
              </button>
            </div>
          </form>
        )}
      </div>

      {confirmLeave && (
        <ConfirmDialog
          title="Uscire?"
          message={phase === 'recording' ? 'La registrazione in corso andrà persa.' : 'La registrazione non salvata andrà persa.'}
          confirmLabel="Esci e scarta"
          onConfirm={() => {
            phaseRef.current = 'setup'
            navigate(base ? `/studio/${pid}/takes/${overId}` : `/studio/${pid}`)
          }}
          onCancel={() => setConfirmLeave(false)}
        />
      )}
      <BottomNav />
    </div>
  )
}
