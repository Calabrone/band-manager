import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Guitar, Music, Pencil, RefreshCw, Youtube } from 'lucide-react'
import client from '../api/client'

const CATEGORY_LABELS = {
  proposta: 'Proposta',
  da_provare: 'Da Provare',
  in_scaletta: 'In Scaletta',
}

const CATEGORY_COLORS = {
  proposta: 'bg-yellow-900/40 text-yellow-300',
  da_provare: 'bg-blue-900/40 text-blue-300',
  in_scaletta: 'bg-green-900/40 text-green-300',
}

export default function SongDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [song, setSong] = useState(null)
  const [loading, setLoading] = useState(true)
  const [enriching, setEnriching] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data } = await client.get(`/songs/${id}`)
        if (!cancelled) setSong(data)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  async function handleEnrich() {
    setEnriching(true)
    try {
      await client.post(`/songs/${id}/enrich`)
      // Poll until validated
      const poll = setInterval(async () => {
        const { data } = await client.get(`/songs/${id}`)
        if (data.validated || data.validation_error) {
          setSong(data)
          setEnriching(false)
          clearInterval(poll)
        }
      }, 2000)
    } catch {
      setEnriching(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-gray-600 animate-spin" />
      </div>
    )
  }

  if (!song) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        Brano non trovato
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-gray-950/95 backdrop-blur border-b border-gray-800">
        <button onClick={() => navigate(-1)} className="p-1 text-gray-400 hover:text-gray-200">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-semibold text-white truncate">{song.title}</h1>
          <p className="text-xs text-gray-400 truncate">{song.artist}</p>
        </div>
        <button
          onClick={() => navigate(`/songs/${id}/edit`)}
          className="p-2 text-gray-400 hover:text-gray-200"
        >
          <Pencil className="w-5 h-5" />
        </button>
      </div>

      {/* Cover + meta */}
      <div className="flex gap-4 p-4">
        <div className="w-24 h-24 rounded-xl overflow-hidden flex-shrink-0 bg-gray-800 flex items-center justify-center">
          {song.cover_url ? (
            <img src={song.cover_url} alt={song.title} className="w-full h-full object-cover" />
          ) : (
            <Music className="w-8 h-8 text-gray-600" />
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
          <span className={`self-start text-xs px-2 py-0.5 rounded-full ${CATEGORY_COLORS[song.category]}`}>
            {CATEGORY_LABELS[song.category]}
          </span>
          <p className="text-xs text-gray-400">
            Proposto da <span className="text-gray-200">{song.proposed_by_username}</span>
          </p>
          <p className="text-xs text-gray-400">
            Modificato da <span className="text-gray-200">{song.last_modified_by_username}</span>
          </p>
          {!song.validated && !song.validation_error && (
            <span className="flex items-center gap-1 text-xs text-yellow-400">
              <RefreshCw className="w-3 h-3 animate-spin" /> Validazione in corso...
            </span>
          )}
          {song.validation_error && (
            <span className="text-xs text-red-400">{song.validation_error}</span>
          )}
        </div>
      </div>

      {/* Links */}
      {(song.youtube_url || song.chords_url) && (
        <div className="px-4 flex gap-3 mb-4">
          {song.youtube_url && (
            <a
              href={song.youtube_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-900/30 border border-red-800/50 text-red-300 text-sm"
            >
              <Youtube className="w-4 h-4" />
              YouTube Music
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {song.chords_url && (
            <a
              href={song.chords_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-900/30 border border-blue-800/50 text-blue-300 text-sm"
            >
              <Guitar className="w-4 h-4" />
              Accordi
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      )}

      {/* Re-enrich */}
      {(song.validation_error || (!song.lyrics && song.validated)) && (
        <div className="px-4 mb-4">
          <button
            onClick={handleEnrich}
            disabled={enriching}
            className="flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${enriching ? 'animate-spin' : ''}`} />
            {enriching ? 'Aggiornamento...' : 'Ricarica testi e accordi'}
          </button>
        </div>
      )}

      {/* Lyrics */}
      {song.lyrics ? (
        <div className="px-4">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Testo</h2>
          <pre className="whitespace-pre-wrap text-sm text-gray-300 font-sans leading-relaxed">
            {song.lyrics}
          </pre>
        </div>
      ) : song.validated ? (
        <p className="px-4 text-sm text-gray-500 italic">Testo non disponibile</p>
      ) : null}
    </div>
  )
}
