import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AudioLines, Plus, RefreshCw } from 'lucide-react'
import client from '../api/client'
import BottomNav from '../components/BottomNav'
import AppHeader from '../components/ui/AppHeader'
import Fab from '../components/ui/Fab'
import Segmented from '../components/ui/Segmented'
import SwipeTabs from '../components/ui/SwipeTabs'
import HelpButton from '../components/onboarding/HelpButton'
import { useOnboarding } from '../context/OnboardingContext'
import { StatusBadge, STATUS, btnPrimary, formatSize, timeAgo } from '../components/studio/ui'
import { SEGMENTS, countBySegment, groupByStatus, inSegment, migrateFilter } from '../lib/studioGroups'

const ALL_STATUSES = 'idea,lavorazione,pronto,promosso,archiviato'
const SEGMENT_KEYS = SEGMENTS.map((s) => s.key)

function ProjectCard({ project, onOpen }) {
  const n = project.take_count
  return (
    <div
      onClick={onOpen}
      className="px-4 py-3 bg-gray-900 border-b border-gray-800 active:bg-gray-800 cursor-pointer select-none"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-white font-medium text-sm truncate">{project.title}</p>
        <span className="text-[11px] text-gray-500 whitespace-nowrap mt-0.5">{timeAgo(project.last_activity_at)}</span>
      </div>
      {project.description && <p className="text-gray-400 text-xs truncate mt-0.5">{project.description}</p>}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-xs text-gray-500">
        <StatusBadge status={project.status} />
        <span>{n === 0 ? 'nessun contenuto' : n === 1 ? '1 contenuto' : `${n} contenuti`}</span>
        <span>· {project.created_by}</span>
        {project.bpm && <span>· {project.bpm} BPM</span>}
        {project.music_key && <span>· {project.music_key}</span>}
      </div>
    </div>
  )
}

function EmptyState({ segment }) {
  if (segment === 'inCorso') {
    return (
      <div className="flex flex-col items-center justify-center py-14 px-8 text-center">
        <p className="text-sm text-gray-500 mb-4">
          Nessun brano di prova in corso. Creane uno con un titolo provvisorio e carica i primi contenuti.
        </p>
        <Link to="/studio/new" className={btnPrimary}>
          <Plus className="w-4 h-4" />
          Crea il primo brano di prova
        </Link>
      </div>
    )
  }
  return (
    <p className="text-center text-sm text-gray-600 py-16 px-8">
      {segment === 'promossi' ? 'Nessun brano promosso' : 'Nessun brano archiviato'}
    </p>
  )
}

export default function Studio() {
  const navigate = useNavigate()
  const { setCtx } = useOnboarding()
  const [segment, setSegment] = useState(() => {
    try {
      return migrateFilter(sessionStorage.getItem('band_studio_filter') || 'attivi')
    } catch {
      return 'inCorso'
    }
  })
  const [projects, setProjects] = useState([])
  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [list, use] = await Promise.all([
        client.get('/studio/projects', { params: { status: ALL_STATUSES } }),
        client.get('/studio/usage'),
      ])
      setProjects(list.data)
      setUsage(use.data)
      setError('')
    } catch {
      setError('Impossibile caricare i brani di prova')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    try {
      sessionStorage.setItem('band_studio_filter', segment)
    } catch {
      // storage non disponibile
    }
  }, [segment])

  // Per la guida: un brano di prova da aprire quando manca un riferimento
  useEffect(() => {
    if (projects.length) setCtx({ lastProjectId: projects[0].id }, { ifMissing: true })
  }, [projects, setCtx])

  const counts = useMemo(() => countBySegment(projects), [projects])
  const options = SEGMENTS.map((s) => ({ key: s.key, label: s.label, count: counts[s.key] }))
  const items = inSegment(projects, segment)

  return (
    <div className="min-h-screen flex flex-col pb-20 max-w-2xl mx-auto w-full">
      <AppHeader
        title="Prove"
        icon={AudioLines}
        iconClass="text-purple-400"
        sticky
        actions={
          <>
            <Link
              to="/studio/new"
              data-tour="new-project"
              className="hidden sm:flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300 px-2"
            >
              <Plus className="w-4 h-4" />
              Nuovo brano
            </Link>
            <HelpButton />
          </>
        }
      />

      <div className="px-4 py-2 bg-gray-950 border-b border-gray-800 sticky top-[57px] z-10">
        <Segmented options={options} value={segment} onChange={setSegment} />
      </div>

      <SwipeTabs keys={SEGMENT_KEYS} active={segment} onChange={setSegment} className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-6 h-6 text-gray-600 animate-spin" />
          </div>
        ) : error ? (
          <p className="text-center text-sm text-red-400 py-16">{error}</p>
        ) : items.length === 0 ? (
          <EmptyState segment={segment} />
        ) : segment === 'inCorso' ? (
          groupByStatus(items).map((g) => (
            <section key={g.status} data-group={g.status}>
              <h2 className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 bg-gray-950">
                {STATUS[g.status].label} · {g.items.length}
              </h2>
              {g.items.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={() => navigate(`/studio/${p.id}`)} />
              ))}
            </section>
          ))
        ) : (
          items.map((p) => <ProjectCard key={p.id} project={p} onOpen={() => navigate(`/studio/${p.id}`)} />)
        )}

        {usage && !loading && (
          <p className="px-4 py-3 text-[11px] text-gray-600 text-center">
            Spazio usato dalle prove: {formatSize(usage.bytes)} in {usage.count} {usage.count === 1 ? 'contenuto' : 'contenuti'}
          </p>
        )}
      </SwipeTabs>

      <div className="sm:hidden">
        <Fab to="/studio/new" label="Nuovo brano di prova" tour="new-project" />
      </div>
      <BottomNav />
    </div>
  )
}
