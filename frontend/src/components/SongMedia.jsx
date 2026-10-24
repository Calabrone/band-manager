import { useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, Mic, Pencil, Plus, Trash2, Video, X } from 'lucide-react'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'
import ConfirmDialog from './ConfirmDialog'

const AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'amr', '3gp', '3gpp', 'caf', 'webm', 'mp4']
const AUDIO_ACCEPT = ['audio/*', ...AUDIO_EXTS.map(e => `.${e}`)].join(',')

const inputCls = `w-full px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 text-white
                  placeholder-gray-500 text-sm focus:outline-none focus:border-brand-500`

function today() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function formatDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatSize(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function errorText(err, fallback) {
  const detail = err?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-2xl">
        <div className="flex items-center justify-between px-5 pt-4">
          <h3 className="text-white font-semibold text-base">{title}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  )
}

function SectionHeader({ icon: Icon, title, count, onAdd }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
        <Icon className="w-4 h-4" />
        {title} ({count})
      </h2>
      <button
        onClick={onAdd}
        className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300"
      >
        <Plus className="w-4 h-4" />
        Aggiungi
      </button>
    </div>
  )
}

function ItemActions({ onEdit, onDelete }) {
  return (
    <div className="flex items-center gap-3 mt-1">
      <button onClick={onEdit} className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-400">
        <Pencil className="w-3 h-3" />
        Modifica
      </button>
      <button onClick={onDelete} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400">
        <Trash2 className="w-3 h-3" />
        Elimina
      </button>
    </div>
  )
}

function ItemMeta({ item }) {
  return (
    <>
      <p className="text-xs text-gray-500">
        {formatDate(item.recorded_on)} · {item.username}
      </p>
      {item.note && <p className="text-sm text-gray-300 whitespace-pre-wrap mt-1">{item.note}</p>}
    </>
  )
}

// ── Video ──────────────────────────────────────────────────────────────────

function VideoForm({ songId, video, onSaved, onClose }) {
  const editing = !!video
  const [url, setUrl] = useState(video?.url ?? '')
  const [title, setTitle] = useState(video?.title ?? '')
  const [date, setDate] = useState(video?.recorded_on ?? today())
  const [note, setNote] = useState(video?.note ?? '')
  const [thumb, setThumb] = useState(video?.thumb_url ?? null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const previewed = useRef('')

  async function loadPreview() {
    const link = url.trim()
    if (editing || !/^https?:\/\//i.test(link) || previewed.current === link) return
    previewed.current = link
    setPreviewing(true)
    try {
      const { data } = await client.post('/media/preview', { url: link })
      setThumb(data.image)
      setTitle(prev => (prev.trim() ? prev : data.title ?? ''))
    } catch {
      // l'anteprima è facoltativa
    } finally {
      setPreviewing(false)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const body = { title, recorded_on: date, note }
      const { data } = editing
        ? await client.put(`/songs/${songId}/videos/${video.id}`, body)
        : await client.post(`/songs/${songId}/videos`, { ...body, url, thumb_url: thumb })
      onSaved(data)
    } catch (err) {
      setError(errorText(err, 'Salvataggio non riuscito'))
      setSaving(false)
    }
  }

  return (
    <Modal title={editing ? 'Modifica video' : 'Aggiungi video'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {!editing && (
          <Field label="Link (es. cloud GoPro)">
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onBlur={loadPreview}
              onPaste={() => setTimeout(loadPreview, 0)}
              placeholder="https://..."
              required
              className={inputCls}
            />
          </Field>
        )}
        {thumb && (
          <img
            src={thumb}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setThumb(null)}
            className="w-full max-h-40 object-cover rounded-xl"
          />
        )}
        {previewing && <p className="text-xs text-gray-500">Recupero anteprima...</p>}
        <Field label="Titolo">
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={150} required className={inputCls} />
        </Field>
        <Field label="Data della prova">
          <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} required className={inputCls} />
        </Field>
        <Field label="Nota">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000} className={`${inputCls} resize-none`} />
        </Field>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 rounded-xl bg-brand-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-700"
        >
          {saving ? 'Salvataggio...' : 'Salva'}
        </button>
      </form>
    </Modal>
  )
}

function VideoItem({ video, mine, onEdit, onDelete }) {
  const [thumbOk, setThumbOk] = useState(true)
  return (
    <div className="flex gap-3">
      <a
        href={video.url}
        target="_blank"
        rel="noopener noreferrer"
        className="relative w-28 h-20 flex-shrink-0 rounded-xl overflow-hidden bg-gray-800 flex items-center justify-center"
      >
        {video.thumb_url && thumbOk ? (
          <img
            src={video.thumb_url}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setThumbOk(false)}
            className="w-full h-full object-cover"
          />
        ) : (
          <Video className="w-8 h-8 text-gray-600" />
        )}
      </a>
      <div className="flex-1 min-w-0">
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-sm font-medium text-white hover:text-brand-300"
        >
          <span className="truncate">{video.title}</span>
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
        </a>
        <ItemMeta item={video} />
        {mine && <ItemActions onEdit={onEdit} onDelete={onDelete} />}
      </div>
    </div>
  )
}

function VideoSection({ songId }) {
  const { user } = useAuth()
  const [videos, setVideos] = useState([])
  const [form, setForm] = useState(null)   // null | 'new' | video
  const [deleteTarget, setDeleteTarget] = useState(null)

  useEffect(() => {
    let cancelled = false
    client.get(`/songs/${songId}/videos`).then(({ data }) => {
      if (!cancelled) setVideos(data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [songId])

  function saved(v) {
    setVideos(prev => {
      const next = prev.some(x => x.id === v.id) ? prev.map(x => x.id === v.id ? v : x) : [v, ...prev]
      return next.sort((a, b) => b.recorded_on.localeCompare(a.recorded_on) || b.id - a.id)
    })
    setForm(null)
  }

  async function confirmDelete() {
    const id = deleteTarget.id
    try {
      await client.delete(`/songs/${songId}/videos/${id}`)
      setVideos(prev => prev.filter(v => v.id !== id))
    } catch {
      // ignore
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="px-4 mb-6">
      <SectionHeader icon={Video} title="Video prove" count={videos.length} onAdd={() => setForm('new')} />
      {videos.length === 0 ? (
        <p className="text-sm text-gray-600 italic">Nessun video ancora.</p>
      ) : (
        <div className="space-y-4">
          {videos.map(v => (
            <VideoItem
              key={v.id}
              video={v}
              mine={v.user_id === user?.id}
              onEdit={() => setForm(v)}
              onDelete={() => setDeleteTarget(v)}
            />
          ))}
        </div>
      )}
      {form && (
        <VideoForm
          songId={songId}
          video={form === 'new' ? null : form}
          onSaved={saved}
          onClose={() => setForm(null)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="Elimina video"
          message={`Eliminare "${deleteTarget.title}"? Il video sul cloud non viene toccato.`}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

// ── Audio ──────────────────────────────────────────────────────────────────

function AudioForm({ songId, audio, maxBytes, onSaved, onClose }) {
  const editing = !!audio
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState(audio?.title ?? '')
  const [date, setDate] = useState(audio?.recorded_on ?? today())
  const [note, setNote] = useState(audio?.note ?? '')
  const [progress, setProgress] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef(null)

  function pickFile(e) {
    const f = e.target.files?.[0]
    setError('')
    if (!f) return
    const ext = f.name.split('.').pop().toLowerCase()
    if (!AUDIO_EXTS.includes(ext)) {
      setFile(null)
      setError(`Formato non supportato (ammessi: ${AUDIO_EXTS.join(', ')})`)
      return
    }
    if (maxBytes > 0 && f.size > maxBytes) {
      setFile(null)
      setError(`File troppo grande (${formatSize(f.size)}): il massimo è ${formatSize(maxBytes)}`)
      return
    }
    setFile(f)
    setTitle(prev => (prev.trim() ? prev : f.name.replace(/\.[^.]+$/, '')))
  }

  async function submit(e) {
    e.preventDefault()
    if (!editing && !file) {
      setError('Scegli un file audio')
      return
    }
    setSaving(true)
    setError('')
    try {
      let data
      if (editing) {
        ({ data } = await client.put(`/songs/${songId}/audios/${audio.id}`, { title, recorded_on: date, note }))
      } else {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('title', title)
        fd.append('recorded_on', date)
        fd.append('note', note)
        abortRef.current = new AbortController()
        setProgress(0)
        ;({ data } = await client.post(`/songs/${songId}/audios`, fd, {
          signal: abortRef.current.signal,
          timeout: 0,
          onUploadProgress: ev => {
            if (ev.total) setProgress(Math.round((ev.loaded / ev.total) * 100))
          },
        }))
      }
      onSaved(data)
    } catch (err) {
      if (err?.code !== 'ERR_CANCELED') setError(errorText(err, 'Upload non riuscito'))
      setSaving(false)
      setProgress(null)
    }
  }

  function close() {
    abortRef.current?.abort()
    onClose()
  }

  return (
    <Modal title={editing ? 'Modifica audio' : 'Aggiungi audio'} onClose={close}>
      <form onSubmit={submit} className="space-y-3">
        {!editing && (
          <Field label={`File audio${maxBytes > 0 ? ` (max ${formatSize(maxBytes)})` : ''}`}>
            <input
              type="file"
              accept={AUDIO_ACCEPT}
              onChange={pickFile}
              disabled={saving}
              className="block w-full text-sm text-gray-300 file:mr-3 file:py-2 file:px-3 file:rounded-xl
                         file:border-0 file:bg-gray-700 file:text-gray-200"
            />
          </Field>
        )}
        <Field label="Titolo">
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={150} required className={inputCls} />
        </Field>
        <Field label="Data della prova">
          <input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} required className={inputCls} />
        </Field>
        <Field label="Nota">
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1000} className={`${inputCls} resize-none`} />
        </Field>
        {progress !== null && (
          <div>
            <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-gray-500 mt-1">{progress}%</p>
          </div>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full py-2.5 rounded-xl bg-brand-600 text-white text-sm font-medium disabled:opacity-50 hover:bg-brand-700"
        >
          {saving ? (editing ? 'Salvataggio...' : 'Caricamento...') : 'Salva'}
        </button>
      </form>
    </Modal>
  )
}

function canPlay(mime) {
  try {
    return document.createElement('audio').canPlayType(mime) !== ''
  } catch {
    return false
  }
}

function AudioItem({ audio, mine, onEdit, onDelete }) {
  const playable = canPlay(audio.mime)
  return (
    <div>
      <p className="text-sm font-medium text-white">{audio.title}</p>
      <ItemMeta item={audio} />
      {playable ? (
        <audio controls preload="none" src={audio.file_url} className="w-full mt-2" />
      ) : (
        <p className="text-xs text-yellow-500 mt-1">
          Questo formato non si ascolta nel browser: scaricalo per riprodurlo.
        </p>
      )}
      <div className="flex items-center gap-3 mt-1">
        <a
          href={`${audio.file_url}&dl=1`}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-brand-300"
        >
          <Download className="w-3 h-3" />
          Scarica ({formatSize(audio.size)})
        </a>
        {mine && (
          <>
            <button onClick={onEdit} className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-400">
              <Pencil className="w-3 h-3" />
              Modifica
            </button>
            <button onClick={onDelete} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400">
              <Trash2 className="w-3 h-3" />
              Elimina
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function AudioSection({ songId }) {
  const { user } = useAuth()
  const [audios, setAudios] = useState([])
  const [maxBytes, setMaxBytes] = useState(0)
  const [form, setForm] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([client.get(`/songs/${songId}/audios`), client.get('/config')]).then(([list, cfg]) => {
      if (cancelled) return
      setAudios(list.data)
      setMaxBytes(cfg.data.max_upload_bytes ?? 0)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [songId])

  function saved(a) {
    setAudios(prev => {
      const next = prev.some(x => x.id === a.id) ? prev.map(x => x.id === a.id ? a : x) : [a, ...prev]
      return next.sort((x, y) => y.recorded_on.localeCompare(x.recorded_on) || y.id - x.id)
    })
    setForm(null)
  }

  async function confirmDelete() {
    const id = deleteTarget.id
    try {
      await client.delete(`/songs/${songId}/audios/${id}`)
      setAudios(prev => prev.filter(a => a.id !== id))
    } catch {
      // ignore
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="px-4 mb-6">
      <SectionHeader icon={Mic} title="Audio prove" count={audios.length} onAdd={() => setForm('new')} />
      {audios.length === 0 ? (
        <p className="text-sm text-gray-600 italic">Nessun audio ancora.</p>
      ) : (
        <div className="space-y-5">
          {audios.map(a => (
            <AudioItem
              key={a.id}
              audio={a}
              mine={a.user_id === user?.id}
              onEdit={() => setForm(a)}
              onDelete={() => setDeleteTarget(a)}
            />
          ))}
        </div>
      )}
      {form && (
        <AudioForm
          songId={songId}
          audio={form === 'new' ? null : form}
          maxBytes={maxBytes}
          onSaved={saved}
          onClose={() => setForm(null)}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="Elimina audio"
          message={`Eliminare "${deleteTarget.title}"? Il file verrà cancellato.`}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

export default function SongMedia({ songId }) {
  return (
    <>
      <VideoSection songId={songId} />
      <AudioSection songId={songId} />
    </>
  )
}
