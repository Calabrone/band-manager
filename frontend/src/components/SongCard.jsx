import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreVertical, Music, Pencil, Trash2, ArrowRight, Loader2 } from 'lucide-react'

const CATEGORY_LABELS = {
  proposta: 'Proposta',
  da_provare: 'Da Provare',
  in_scaletta: 'In Scaletta',
}

const CATEGORY_NEXT = {
  proposta: 'da_provare',
  da_provare: 'in_scaletta',
  in_scaletta: null,
}

const CATEGORY_COLORS = {
  proposta: 'bg-yellow-900/40 text-yellow-300',
  da_provare: 'bg-blue-900/40 text-blue-300',
  in_scaletta: 'bg-green-900/40 text-green-300',
}

export default function SongCard({ song, onDelete, onCategoryChange }) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const nextCategory = CATEGORY_NEXT[song.category]

  function handleCardClick(e) {
    if (e.target.closest('[data-menu]')) return
    navigate(`/songs/${song.id}`)
  }

  function handleDelete(e) {
    e.stopPropagation()
    setMenuOpen(false)
    onDelete(song)
  }

  function handleEdit(e) {
    e.stopPropagation()
    setMenuOpen(false)
    navigate(`/songs/${song.id}/edit`)
  }

  function handlePromote(e) {
    e.stopPropagation()
    setMenuOpen(false)
    onCategoryChange(song, nextCategory)
  }

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 bg-gray-900 border-b border-gray-800 active:bg-gray-800 cursor-pointer select-none"
      onClick={handleCardClick}
    >
      {/* Cover */}
      <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-gray-800 flex items-center justify-center">
        {song.cover_url ? (
          <img src={song.cover_url} alt={song.title} className="w-full h-full object-cover" />
        ) : song.validated === false && !song.validation_error ? (
          <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
        ) : (
          <Music className="w-6 h-6 text-gray-600" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-white font-medium text-sm truncate">{song.title}</p>
        <p className="text-gray-400 text-xs truncate">{song.artist}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-xs px-2 py-0.5 rounded-full ${CATEGORY_COLORS[song.category]}`}>
            {CATEGORY_LABELS[song.category]}
          </span>
          {song.validation_error && (
            <span className="text-xs text-red-400">Errore</span>
          )}
        </div>
        <p className="text-gray-600 text-xs mt-0.5">
          {song.proposed_by_username}
        </p>
      </div>

      {/* Menu */}
      <div data-menu className="relative flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
          className="p-2 rounded-lg hover:bg-gray-700 text-gray-400"
        >
          <MoreVertical className="w-5 h-5" />
        </button>

        {menuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-8 z-30 bg-gray-800 border border-gray-700 rounded-xl shadow-xl min-w-[160px] overflow-hidden">
              {nextCategory && (
                <button
                  onClick={handlePromote}
                  className="flex items-center gap-2 w-full px-4 py-3 text-sm text-gray-200 hover:bg-gray-700"
                >
                  <ArrowRight className="w-4 h-4 text-brand-400" />
                  Sposta in {CATEGORY_LABELS[nextCategory]}
                </button>
              )}
              <button
                onClick={handleEdit}
                className="flex items-center gap-2 w-full px-4 py-3 text-sm text-gray-200 hover:bg-gray-700"
              >
                <Pencil className="w-4 h-4 text-blue-400" />
                Modifica
              </button>
              <button
                onClick={handleDelete}
                className="flex items-center gap-2 w-full px-4 py-3 text-sm text-red-400 hover:bg-gray-700"
              >
                <Trash2 className="w-4 h-4" />
                Elimina
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
