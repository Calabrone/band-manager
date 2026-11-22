import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Circle, Download, Pencil, Trash2 } from 'lucide-react'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'
import Menu from '../components/ui/Menu'
import Tabs from '../components/ui/Tabs'
import { useOnboarding } from '../context/OnboardingContext'
import { trackStep } from '../lib/onboarding'
import ConfirmDialog from '../components/ConfirmDialog'
import LoopPlayer from '../components/studio/LoopPlayer'
import MarkerList from '../components/studio/MarkerList'
import StudioComments from '../components/studio/StudioComments'
import { Field, Modal, btnPrimary, btnSecondary, errorText, formatDateTime, formatSize, inputCls } from '../components/studio/ui'
import { formatClock } from '../lib/loop'

function TakeEditDialog({ take, onClose, onSaved }) {
  const [title, setTitle] = useState(take.title)
  const [description, setDescription] = useState(take.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const { data } = await client.put(`/studio/takes/${take.id}`, { title, description: description.trim() || null })
      onSaved(data)
    } catch (err) {
      setError(errorText(err, 'Salvataggio non riuscito'))
      setSaving(false)
    }
  }

  return (
    <Modal title="Modifica contenuto" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Titolo">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required className={inputCls} />
        </Field>
        <Field label="Descrizione">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={4} className={inputCls} />
        </Field>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={`${btnSecondary} flex-1`}>Annulla</button>
          <button type="submit" disabled={saving || !title.trim()} className={`${btnPrimary} flex-1`}>Salva</button>
        </div>
      </form>
    </Modal>
  )
}

function MarkerDialog({ ms, onClose, onSave }) {
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave(ms, label)
    } catch (err) {
      setError(errorText(err, 'Marker non creato'))
      setSaving(false)
    }
  }

  return (
    <Modal title={`Nuovo marker a ${formatClock(ms)}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nota breve" hint="es. «nota sbagliata», «entra il basso»">
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} required autoFocus className={inputCls} />
        </Field>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className={`${btnSecondary} flex-1`}>Annulla</button>
          <button type="submit" disabled={saving || !label.trim()} className={`${btnPrimary} flex-1`}>Aggiungi</button>
        </div>
      </form>
    </Modal>
  )
}

export default function StudioTake() {
  const { pid, tid } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const playerRef = useRef(null)
  const [take, setTake] = useState(null)
  const [project, setProject] = useState(null)
  const [markers, setMarkers] = useState([])
  const [comments, setComments] = useState([])
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [markerAt, setMarkerAt] = useState(null)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [tab, setTab] = useState('marker')
  const { setCtx } = useOnboarding()

  const reloadMarkers = useCallback(async () => {
    const { data } = await client.get(`/studio/takes/${tid}/markers`)
    setMarkers(data)
  }, [tid])
  const reloadComments = useCallback(async () => {
    const { data } = await client.get(`/studio/takes/${tid}/comments`)
    setComments(data)
  }, [tid])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      client.get(`/studio/takes/${tid}`),
      client.get(`/studio/projects/${pid}`),
      client.get(`/studio/takes/${tid}/markers`),
      client.get(`/studio/takes/${tid}/comments`),
    ]).then(([t, p, m, c]) => {
      if (cancelled) return
      setTake(t.data)
      setProject(p.data)
      setMarkers(m.data)
      setComments(c.data)
      setCtx({ lastProjectId: p.data.id, lastTakeId: t.data.id })
    }).catch((err) => {
      if (cancelled) return
      if (err?.response?.status === 404) setNotFound(true)
      else setError(errorText(err, 'Impossibile caricare il contenuto'))
    })
    return () => { cancelled = true }
  }, [pid, tid, setCtx])

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-gray-500">
        <p className="text-sm">Contenuto non trovato</p>
        <Link to={`/studio/${pid}`} className="text-sm text-purple-400">Torna al brano</Link>
      </div>
    )
  }
  if (!take || !project) return <p className="text-center text-sm text-gray-600 py-16">{error || 'Caricamento…'}</p>

  const isAuthor = take.user_id === user?.id
  const hasTrim = take.trim_start_ms !== null
  const justUploaded = !!location.state?.justUploaded

  function openMarkerDialog(ms) {
    playerRef.current?.pause()
    setMarkerAt(Math.max(0, Math.round(ms)))
  }

  /** Crea un marker e ritorna la riga creata (serve anche al commento che lo cita). */
  async function createMarker(ms, label) {
    const { data } = await client.post(`/studio/takes/${tid}/markers`, { time_ms: Math.max(0, Math.round(ms)), label })
    await reloadMarkers()
    trackStep('marker')
    return data
  }

  async function updateMarker(id, label) {
    await client.put(`/studio/takes/${tid}/markers/${id}`, { label })
    await reloadMarkers()
  }

  async function deleteMarker(m) {
    await client.delete(`/studio/takes/${tid}/markers/${m.id}`)
    await reloadMarkers()
  }

  async function saveTrim(start, end) {
    const { data } = await client.put(`/studio/takes/${tid}`, { trim_start_ms: start, trim_end_ms: end })
    setTake(data)
  }

  async function saveOffset(ms) {
    const { data } = await client.put(`/studio/takes/${tid}`, { offset_ms: ms })
    setTake(data)
  }

  async function doDelete() {
    setConfirmDelete(false)
    try {
      await client.delete(`/studio/takes/${tid}`)
      navigate(`/studio/${pid}`, { replace: true })
    } catch (err) {
      setError(errorText(err, 'Eliminazione non riuscita'))
    }
  }

  function jumpToComment(id) {
    // il commento puo' non essere montato: si passa prima alla scheda Commenti
    setTab('commenti')
    setTimeout(() => document.getElementById(`c-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  const menuItems = [
    { icon: Download, label: 'Scarica il file', onClick: () => { window.location.href = `${take.file_url}&dl=1` } },
    { icon: Pencil, label: 'Modifica', onClick: () => setEditing(true), hidden: !isAuthor },
    { icon: Trash2, label: 'Elimina', onClick: () => setConfirmDelete(true), danger: true, hidden: !isAuthor },
  ]
  const tabs = [
    { key: 'marker', label: 'Marker', count: markers.length },
    { key: 'commenti', label: 'Commenti', count: comments.length },
  ]

  return (
    <div className="min-h-screen pb-8">
      <header className="flex items-center gap-2 px-4 py-3 bg-gray-950 border-b border-gray-800 sticky top-0 z-20">
        <button onClick={() => navigate(`/studio/${pid}`)} className="p-1 -ml-1 text-gray-400 hover:text-gray-200" aria-label="Indietro">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-white truncate">{take.title}</h1>
          <p className="text-[11px] text-gray-500 truncate">{project.title}</p>
        </div>
        <Menu items={menuItems} />
      </header>

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            {take.username} · {formatDateTime(take.created_at)} · {formatSize(take.size)}
            {take.recorded_in_app && ' · registrato nell\'app'}
          </p>
          {take.description && <p className="text-sm text-gray-300 whitespace-pre-wrap">{take.description}</p>}
          <button
            type="button"
            data-tour="overdub-btn"
            onClick={() => navigate(`/studio/${pid}/record?over=${tid}`)}
            className={`${btnSecondary} !py-2 !px-3 !text-xs`}
          >
            <Circle className="w-3 h-3 text-red-400 fill-current" /> Registra sopra
          </button>
        </div>

        <LoopPlayer
          key={take.id}
          ref={playerRef}
          take={take}
          markers={markers}
          isAuthor={isAuthor}
          projectBpm={project.bpm}
          onAddMarker={openMarkerDialog}
          onSaveTrim={saveTrim}
          onSaveOffset={saveOffset}
          hint={justUploaded && isAuthor && !hasTrim
            ? 'Caricato! Se all\'inizio o alla fine ci sono parti inutili, scegli la parte utile con le maniglie A e B e premi «Salva come taglio predefinito»: gli altri la troveranno già impostata.'
            : null}
        />

        <div className="-mx-4">
          <Tabs items={tabs} value={tab} onChange={setTab} stickyClass="top-[57px]" ariaLabel="Marker e commenti" />
        </div>

        {tab === 'marker' && (
          <MarkerList
            markers={markers}
            comments={comments}
            userId={user?.id}
            onSeek={(m) => playerRef.current?.seekAndPlay(m.time_ms)}
            onUpdate={updateMarker}
            onDelete={deleteMarker}
            onJumpToComment={jumpToComment}
          />
        )}

        {tab === 'commenti' && (
          <StudioComments
            takeId={tid}
            comments={comments}
            markers={markers}
            userId={user?.id}
            getPosition={() => playerRef.current?.getPosition() ?? 0}
            onSeekMs={(ms) => playerRef.current?.seekAndPlay(ms)}
            onCreateMarker={createMarker}
            onChanged={reloadComments}
          />
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      {markerAt !== null && (
        <MarkerDialog
          ms={markerAt}
          onClose={() => setMarkerAt(null)}
          onSave={async (ms, label) => {
            await createMarker(ms, label)
            setMarkerAt(null)
          }}
        />
      )}
      {editing && (
        <TakeEditDialog take={take} onClose={() => setEditing(false)} onSaved={(t) => { setTake(t); setEditing(false) }} />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Elimina contenuto"
          message={`Eliminare «${take.title}» con i suoi marker e commenti? Il file viene cancellato dal server.`}
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
