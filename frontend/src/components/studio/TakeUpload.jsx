import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import client from '../../api/client'
import { formatDuration, formatSize, errorText, inputCls, btnPrimary, btnSecondary, Field, Modal } from './ui'
import { STUDIO_ACCEPT, STUDIO_EXTS, extOf, kindFor, peaksFromBlob, probeFile } from '../../lib/probe'

/** Consigli mostrati accanto al limite di dimensione: servono a evitare un upload che il server rifiuterebbe. */
export function SizeTips({ maxBytes }) {
  return (
    <div className="text-[11px] text-gray-500 space-y-1">
      <p>
        Dimensione massima: <span className="text-gray-300">{maxBytes ? formatSize(maxBytes) : '…'}</span> per file.
      </p>
      <p>
        Se il video è più grande riduci la risoluzione (1080p invece di 4K) o accorcialo. Su iPhone imposta
        Impostazioni → Fotocamera → Formati → «Più compatibile»: i video HEVC (.mov) non si vedono su Android.
      </p>
    </div>
  )
}

export default function TakeUpload({ projectId, onUploaded, onClose }) {
  const [maxBytes, setMaxBytes] = useState(0)
  const [file, setFile] = useState(null)
  const [info, setInfo] = useState(null) // { kind, durationMs }
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [stage, setStage] = useState('')
  const [progress, setProgress] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef(null)

  useEffect(() => {
    client.get('/config').then(({ data }) => setMaxBytes(data.max_upload_bytes || 0)).catch(() => {})
    return () => abortRef.current?.abort()
  }, [])

  async function pickFile(e) {
    const f = e.target.files?.[0]
    setError('')
    setFile(null)
    setInfo(null)
    if (!f) return
    if (!STUDIO_EXTS.includes(extOf(f.name))) {
      setError(`Formato non supportato (ammessi: ${STUDIO_EXTS.join(', ')})`)
      return
    }
    if (maxBytes && f.size > maxBytes) {
      setError(`Il file pesa ${formatSize(f.size)}: il limite è ${formatSize(maxBytes)}. Riducine la risoluzione o la durata.`)
      return
    }
    setFile(f)
    const probe = await probeFile(f)
    const kind = kindFor(f.name, f.type, probe.hasVideo)
    setInfo({ kind, durationMs: probe.durationMs, unreadable: !probe.ok })
    setTitle((prev) => prev || f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 150))
  }

  async function submit(e) {
    e.preventDefault()
    if (!file || !info) return
    setSaving(true)
    setError('')
    setProgress(null)
    try {
      setStage('Preparo il file…')
      const analysis = await peaksFromBlob(file, info.durationMs)
      const fd = new FormData()
      fd.append('file', file)
      fd.append('kind', info.kind)
      fd.append('title', title)
      if (description.trim()) fd.append('description', description)
      const duration = info.durationMs ?? analysis?.durationMs
      if (duration) fd.append('duration_ms', String(Math.round(duration)))
      if (analysis?.peaks?.length) fd.append('peaks', JSON.stringify(analysis.peaks))
      abortRef.current = new AbortController()
      setStage('Caricamento…')
      const { data } = await client.post(`/studio/projects/${projectId}/takes`, fd, {
        signal: abortRef.current.signal,
        onUploadProgress: (ev) => setProgress(ev.total ? Math.round((ev.loaded / ev.total) * 100) : null),
      })
      onUploaded(data)
    } catch (err) {
      if (err?.code !== 'ERR_CANCELED') setError(errorText(err, 'Upload non riuscito, riprova'))
    } finally {
      setSaving(false)
      setStage('')
    }
  }

  function cancel() {
    abortRef.current?.abort()
    onClose()
  }

  return (
    <Modal title="Carica un contenuto" onClose={cancel}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="File audio o video">
          <input
            type="file"
            accept={STUDIO_ACCEPT}
            onChange={pickFile}
            disabled={saving}
            className="block w-full text-sm text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0
                       file:bg-gray-800 file:text-gray-200 file:text-sm"
          />
        </Field>
        <SizeTips maxBytes={maxBytes} />
        {file && info && (
          <p className="text-xs text-gray-400">
            {info.kind === 'video' ? 'Video' : 'Audio'} · {formatDuration(info.durationMs)} · {formatSize(file.size)}
            {info.unreadable && <span className="block text-amber-400">Questo browser non legge il file: si potrà solo scaricare.</span>}
          </p>
        )}
        <Field label="Titolo">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required className={inputCls}
                 placeholder="es. Riff chitarra strofa" />
        </Field>
        <Field label="Descrizione (facoltativa)">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3}
                    className={inputCls} placeholder="es. Versione lenta, 90 BPM, senza distorsione" />
        </Field>
        {saving && (
          <div>
            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress ?? 5}%` }} />
            </div>
            <p className="text-xs text-gray-400 mt-1">{stage}{progress !== null && stage === 'Caricamento…' ? ` ${progress}%` : ''}</p>
          </div>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={cancel} className={`${btnSecondary} flex-1`}>
            {saving ? 'Annulla upload' : 'Chiudi'}
          </button>
          <button type="submit" disabled={saving || !file || !info || !title.trim()} className={`${btnPrimary} flex-1`}>
            <Upload className="w-4 h-4" />
            Carica
          </button>
        </div>
      </form>
    </Modal>
  )
}
