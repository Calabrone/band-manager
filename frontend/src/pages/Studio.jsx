import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AudioLines, Plus, RefreshCw } from 'lucide-react'
import client from '../api/client'
import BottomNav from '../components/BottomNav'
import { StatusBadge, STATUS, formatSize, timeAgo } from '../components/studio/ui'

const FILTERS = [
  { key: 'attivi', label: 'Attivi' },
  ...['idea', 'lavorazione', 'pronto', 'promosso', 'archiviato'].map((key) => ({ key, label: STATUS[key].label })),
]

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
      <div className="flex items-center gap-2 mt-1.5 text-xs text-gray-500">
        <StatusBadge status={project.status} />
        <span>{n === 0 ? 'nessun contenuto' : n === 1 ? '1 contenuto' : `${n} contenuti`}</span>
        <span>· {project.created_by}</span>
        {project.bpm && <span>· {project.bpm} BPM</span>}
        {project.music_key && <span>· {project.music_key}</span>}
      </div>
    </div>
  )
}

export default function Studio() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState(() => {
    try {
      return sessionStorage.getItem('band_studio_filter') || 'attivi'
    } catch {
      return 'attivi'
    }
  })
  const [projects, setProjects] = useState([])
  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const params = filter === 'attivi' ? {} : { status: filter }
      const [list, use] = await Promise.all([client.get('/studio/projects', { params }), client.get('/studio/usage')])
      setProjects(list.data)
      setUsage(use.data)
      setError('')
    } catch {
      setError('Impossibile caricare i brani di prova')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  useEffect(() => {
    try {
      sessionStorage.setItem('band_studio_filter', filter)
    } catch {
      // storage non disponibile
    }
  }, [filter])

  return (
    <div className="min-h-screen flex flex-col pb-20">
      <header className="flex items-center justify-between px-4 py-3 bg-gray-950 border-b border-gray-800">
        <h1 className="text-lg font-bold text-white flex items-center gap-2">
          <AudioLines className="w-5 h-5 text-purple-400" />
          Prove
        </h1>
        <Link to="/studio/new" className="flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300">
          <Plus className="w-4 h-4" />
          Nuovo brano
        </Link>
      </header>

      <div className="flex gap-2 px-4 py-2 overflow-x-auto bg-gray-950 border-b border-gray-800 sticky top-0 z-10">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded-full text-xs whitespace-nowrap transition-colors ${
              filter === f.key ? 'bg-brand-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-6 h-6 text-gray-600 animate-spin" />
          </div>
        ) : error ? (
          <p className="text-center text-sm text-red-400 py-16">{error}</p>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center text-gray-600">
            <p className="text-sm">
              {filter === 'attivi'
                ? 'Nessun brano di prova. Creane uno con un titolo provvisorio e carica i primi contenuti.'
                : 'Nessun brano in questo stato'}
            </p>
          </div>
        ) : (
          projects.map((p) => <ProjectCard key={p.id} project={p} onOpen={() => navigate(`/studio/${p.id}`)} />)
        )}
      </div>

      {usage && (
        <p className="px-4 py-3 text-[11px] text-gray-600 text-center">
          Spazio usato dalle prove: {formatSize(usage.bytes)} in {usage.count} {usage.count === 1 ? 'contenuto' : 'contenuti'}
        </p>
      )}

      <BottomNav />
    </div>
  )
}
