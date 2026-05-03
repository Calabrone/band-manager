import { useEffect, useState, useCallback } from 'react'
import { LogOut, RefreshCw } from 'lucide-react'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'
import CategoryTabs from '../components/CategoryTabs'
import SongCard from '../components/SongCard'
import BottomNav from '../components/BottomNav'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Songs() {
  const { user, logout } = useAuth()
  const [songs, setSongs] = useState([])
  const [activeCategory, setActiveCategory] = useState('proposta')
  const [loading, setLoading] = useState(true)
  const [toDelete, setToDelete] = useState(null)

  const fetchSongs = useCallback(async () => {
    try {
      const { data } = await client.get('/songs')
      setSongs(data)
    } catch {
      // silently ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSongs()
    // Polling ogni 5s per aggiornare lo stato di validazione
    const interval = setInterval(fetchSongs, 5000)
    return () => clearInterval(interval)
  }, [fetchSongs])

  const filtered = songs.filter((s) => s.category === activeCategory)
  const counts = {
    proposta: songs.filter((s) => s.category === 'proposta').length,
    da_provare: songs.filter((s) => s.category === 'da_provare').length,
    in_scaletta: songs.filter((s) => s.category === 'in_scaletta').length,
  }

  async function handleDelete() {
    if (!toDelete) return
    try {
      await client.delete(`/songs/${toDelete.id}`)
      setSongs((prev) => prev.filter((s) => s.id !== toDelete.id))
    } catch {
      // silently ignore
    } finally {
      setToDelete(null)
    }
  }

  async function handleCategoryChange(song, newCategory) {
    try {
      const { data } = await client.put(`/songs/${song.id}/category`, { category: newCategory })
      setSongs((prev) => prev.map((s) => (s.id === data.id ? data : s)))
    } catch {
      // silently ignore
    }
  }

  return (
    <div className="min-h-screen flex flex-col pb-20">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 bg-gray-950 border-b border-gray-800">
        <h1 className="text-lg font-bold text-white">Repertorio</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">{user?.username}</span>
          <button onClick={logout} className="p-2 text-gray-400 hover:text-gray-200">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <CategoryTabs active={activeCategory} counts={counts} onChange={setActiveCategory} />

      {/* List */}
      <div className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-6 h-6 text-gray-600 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-600">
            <p className="text-sm">Nessun brano in questa categoria</p>
          </div>
        ) : (
          filtered.map((song) => (
            <SongCard
              key={song.id}
              song={song}
              onDelete={setToDelete}
              onCategoryChange={handleCategoryChange}
            />
          ))
        )}
      </div>

      <BottomNav />

      {toDelete && (
        <ConfirmDialog
          title="Elimina brano"
          message={`Eliminare "${toDelete.title}" di ${toDelete.artist}?`}
          onConfirm={handleDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  )
}
