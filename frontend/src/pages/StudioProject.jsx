import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Archive, ArchiveRestore, ArrowLeft, Circle, FileText, Layers, MapPin, Maximize2, MessageSquare, Music, Pencil, Rocket, Scissors, Trash2, Upload, Video } from 'lucide-react'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'
import BottomNav from '../components/BottomNav'
import CommentSection from '../components/CommentSection'
import ConfirmDialog from '../components/ConfirmDialog'
import LyricsView from '../components/LyricsView'
import { VideoSection } from '../components/SongMedia'
import Teleprompter from '../components/Teleprompter'
import Menu from '../components/ui/Menu'
import SwipeTabs from '../components/ui/SwipeTabs'
import Tabs from '../components/ui/Tabs'
import StatusStepper from '../components/studio/StatusStepper'
import { useOnboarding } from '../context/OnboardingContext'
import { trackStep } from '../lib/onboarding'
import TakeUpload from '../components/studio/TakeUpload'
import PromoteDialog from '../components/studio/PromoteDialog'
import {
  StatusBadge, btnPrimary, btnSecondary, errorText, formatDateTime, formatDuration, formatSize,
} from '../components/studio/ui'

const TAB_KEYS = ['contenuti', 'testo', 'video', 'commenti']

function readTab(pid) {
  try {
    const t = sessionStorage.getItem(`band_studio_tab_${pid}`)
    return TAB_KEYS.includes(t) ? t : 'contenuti'
  } catch {
    return 'contenuti'
  }
}

function TakeRow({ take, baseTitle, onOpen }) {
  const Icon = take.kind === 'video' ? Video : Music
  const trimmed = take.trim_start_ms !== null
  return (
    <div onClick={onOpen} className="flex items-start gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800 active:bg-gray-800 cursor-pointer select-none">
      <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center flex-shrink-0">
        <Icon className="w-5 h-5 text-gray-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-medium text-sm truncate">{take.title}</p>
        <p className="text-xs text-gray-500">
          {take.username} · {formatDuration(take.duration_ms)} · {formatSize(take.size)}
        </p>
        {take.description && <p className="text-xs text-gray-400 truncate mt-0.5">{take.description}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-gray-500">
          {take.base_take_id && (
            <span className="flex items-center gap-1 text-purple-300">
              <Layers className="w-3 h-3" />
              sopra a «{baseTitle ?? '…'}»
            </span>
          )}
          {trimmed && (
            <span className="flex items-center gap-1">
              <Scissors className="w-3 h-3" />
              taglio impostato
            </span>
          )}
          {take.marker_count > 0 && (
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{take.marker_count}</span>
          )}
          {take.comment_count > 0 && (
            <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" />{take.comment_count}</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function StudioProject() {
  const { pid } = useParams()
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const [project, setProject] = useState(null)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [tab, setTab] = useState(() => readTab(pid))
  const [counts, setCounts] = useState({ video: null, comment: null })
  const { setCtx } = useOnboarding()

  useEffect(() => {
    try {
      sessionStorage.setItem(`band_studio_tab_${pid}`, tab)
    } catch {
      // storage non disponibile
    }
  }, [pid, tab])

  // Conteggi delle schede Video e Commenti noti subito (le sezioni si montano solo quando la scheda e' attiva)
  useEffect(() => {
    let cancelled = false
    Promise.all([client.get(`/studio/projects/${pid}/videos`), client.get(`/studio/projects/${pid}/comments`)])
      .then(([v, c]) => !cancelled && setCounts({ video: v.data.length, comment: c.data.length }))
      .catch(() => {})
    return () => { cancelled = true }
  }, [pid])

  const load = useCallback(async () => {
    try {
      const { data } = await client.get(`/studio/projects/${pid}`)
      setProject(data)
      setCtx({ lastProjectId: data.id, lastTakeId: data.takes[0]?.id ?? null })
    } catch (err) {
      if (err?.response?.status === 404) setNotFound(true)
      else setError(errorText(err, 'Impossibile caricare il brano'))
    }
  }, [pid, setCtx])

  useEffect(() => {
    load()
  }, [load])

  if (notFound) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-gray-500">
        <p className="text-sm">Brano di prova non trovato</p>
        <Link to="/studio" className="text-sm text-purple-400">Torna alle prove</Link>
      </div>
    )
  }
  if (!project) {
    return <p className="text-center text-sm text-gray-600 py-16">{error || 'Caricamento…'}</p>
  }

  const canManage = project.created_by_id === user?.id || isAdmin()
  const titles = Object.fromEntries(project.takes.map((t) => [t.id, t.title]))

  async function changeStatus(status) {
    setError('')
    try {
      const { data } = await client.put(`/studio/projects/${pid}/status`, { status })
      setProject((p) => ({ ...p, ...data }))
      trackStep('status')
    } catch (err) {
      setError(errorText(err, 'Cambio di stato non riuscito'))
    }
  }

  async function doDelete() {
    setConfirmDelete(false)
    try {
      await client.delete(`/studio/projects/${pid}`)
      navigate('/studio', { replace: true })
    } catch (err) {
      setError(errorText(err, 'Eliminazione non riuscita'))
    }
  }

  const archived = project.status === 'archiviato'
  const canChangeStatus = canManage && project.status !== 'promosso' && !archived
  const menuItems = [
    { icon: Pencil, label: 'Modifica', onClick: () => navigate(`/studio/${pid}/edit`), hidden: !canManage },
    { icon: Archive, label: 'Archivia', onClick: () => changeStatus('archiviato'), hidden: !canChangeStatus },
    { icon: ArchiveRestore, label: 'Ripristina', onClick: () => changeStatus('idea'), hidden: !(canManage && archived) },
    { icon: Trash2, label: 'Elimina', onClick: () => setConfirmDelete(true), danger: true, hidden: !canManage },
  ]
  const tabs = [
    { key: 'contenuti', label: 'Contenuti', count: project.takes.length },
    { key: 'testo', label: 'Testo' },
    { key: 'video', label: 'Video', count: counts.video },
    { key: 'commenti', label: 'Commenti', count: counts.comment },
  ]

  return (
    <div className="min-h-screen pb-6 max-w-2xl mx-auto w-full">
      <header className="flex items-center gap-2 px-4 py-3 bg-gray-950 border-b border-gray-800 sticky top-0 z-20">
        <button onClick={() => navigate('/studio')} className="p-1 -ml-1 text-gray-400 hover:text-gray-200" aria-label="Indietro">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="flex-1 min-w-0 text-base font-semibold text-white truncate">{project.title}</h1>
        <Menu items={menuItems} />
      </header>

      <div className="p-4 space-y-3">
        {canChangeStatus ? (
          <StatusStepper status={project.status} canManage onChange={changeStatus} />
        ) : (
          <div className="flex items-center gap-2">
            <StatusBadge status={project.status} />
          </div>
        )}
        <p className="text-xs text-gray-500">
          {[project.bpm && `${project.bpm} BPM`, project.music_key].filter(Boolean).join(' · ')}
          {(project.bpm || project.music_key) && ' · '}
          <span className="text-gray-300">{project.created_by}</span> · {formatDateTime(project.created_at)}
        </p>
        {project.description && <p className="text-sm text-gray-300 whitespace-pre-wrap">{project.description}</p>}

        {project.status === 'promosso' && project.song_id && (
          <Link to={`/songs/${project.song_id}`} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-purple-900/30 text-sm text-purple-200">
            <Rocket className="w-4 h-4" />
            Promosso: vai al brano nella lista
          </Link>
        )}
        {canManage && project.status === 'pronto' && (
          <button onClick={() => setPromoting(true)} className={`${btnPrimary} w-full`}>
            <Rocket className="w-4 h-4" />
            Promuovi a brano della band
          </button>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      <Tabs items={tabs} value={tab} onChange={setTab} stickyClass="top-[57px]" ariaLabel="Sezioni del brano di prova" />

      <SwipeTabs keys={TAB_KEYS} active={tab} onChange={setTab}>
        {tab === 'contenuti' && (
          <>
            <div data-tour="add-take" className="grid grid-cols-2 gap-2 px-4 py-3">
              <button onClick={() => navigate(`/studio/${pid}/record`)} className={`${btnSecondary} py-3`}>
                <Circle className="w-4 h-4 text-red-400 fill-current" />
                Registra
              </button>
              <button onClick={() => setUploading(true)} className={`${btnSecondary} py-3`}>
                <Upload className="w-4 h-4" />
                Carica file
              </button>
            </div>
            {project.takes.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-600 italic">
                Nessun contenuto ancora. Registra o carica un file audio o video per iniziare.
              </p>
            ) : (
              project.takes.map((t) => (
                <TakeRow key={t.id} take={t} baseTitle={titles[t.base_take_id]} onOpen={() => navigate(`/studio/${pid}/takes/${t.id}`)} />
              ))
            )}
          </>
        )}

        {tab === 'testo' && (
          <div className="px-4 pt-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-sm font-semibold text-gray-300">Testo</h2>
              {project.lyrics && (
                <div className="flex items-center gap-2">
                  <button onClick={() => navigate(`/studio/${pid}/lyrics`)}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 text-gray-200 text-xs font-medium">
                    <FileText className="w-4 h-4" />
                    Modifica testo
                  </button>
                  <button onClick={() => { setFullscreen(true); trackStep('prompter') }}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold">
                    <Maximize2 className="w-4 h-4" />
                    Schermo intero
                  </button>
                </div>
              )}
            </div>
            {project.lyrics ? (
              <LyricsView text={project.lyrics} fontSize={15} className="text-gray-300 font-sans" />
            ) : (
              <>
                <p className="text-sm text-gray-500 italic mb-3">Nessun testo ancora.</p>
                <button onClick={() => navigate(`/studio/${pid}/lyrics`)}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-200 text-sm font-medium">
                  <FileText className="w-4 h-4" />
                  Aggiungi testo
                </button>
                <p className="text-xs text-gray-500 mt-2">Puoi scriverlo, incollarlo o leggerlo da una foto, con gli accordi.</p>
              </>
            )}
          </div>
        )}

        {tab === 'video' && (
          <div className="pt-4">
            <VideoSection basePath={`/studio/projects/${pid}`} onCount={(n) => setCounts((c) => ({ ...c, video: n }))} />
          </div>
        )}

        {tab === 'commenti' && (
          <div className="pb-4">
            <CommentSection basePath={`/studio/projects/${pid}`} onCount={(n) => setCounts((c) => ({ ...c, comment: n }))} />
          </div>
        )}
      </SwipeTabs>

      {fullscreen && project.lyrics && (
        <Teleprompter song={{ id: pid, title: project.title, lyrics: project.lyrics }} storageId={`p${pid}`} onClose={() => setFullscreen(false)} />
      )}
      {uploading && (
        <TakeUpload
          projectId={pid}
          onClose={() => setUploading(false)}
          onUploaded={(take) => {
            setUploading(false)
            trackStep('take')
            navigate(`/studio/${pid}/takes/${take.id}`, { state: { justUploaded: true } })
          }}
        />
      )}
      {promoting && (
        <PromoteDialog project={project} onClose={() => setPromoting(false)} onPromoted={(songId) => navigate(`/songs/${songId}`)} />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Elimina brano di prova"
          message={
            project.takes.length > 0
              ? `Eliminare «${project.title}»? Si perdono ${project.takes.length} ${project.takes.length === 1 ? 'contenuto' : 'contenuti'} con i loro file, marker e commenti.`
              : `Eliminare «${project.title}»?`
          }
          onConfirm={doDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      <BottomNav />
    </div>
  )
}
