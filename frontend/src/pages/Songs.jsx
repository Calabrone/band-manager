import { useEffect, useState, useCallback } from 'react'
import { LogOut, RefreshCw } from 'lucide-react'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'
import CategoryTabs, { CATEGORIES } from '../components/CategoryTabs'
import AppHeader from '../components/ui/AppHeader'
import SwipeTabs from '../components/ui/SwipeTabs'
import HelpButton from '../components/onboarding/HelpButton'
import { useOnboarding } from '../context/OnboardingContext'
import { trackStep } from '../lib/onboarding'
import SongCard from '../components/SongCard'
import BottomNav from '../components/BottomNav'
import ConfirmDialog from '../components/ConfirmDialog'

export default function Songs() {
  const { user, logout } = useAuth()
  const { setCtx } = useOnboarding()
  const [songs, setSongs] = useState([])
  const [activeCategory, setActiveCategory] = useState(() => {
    try {
      return sessionStorage.getItem('band_category') || 'proposta'
    } catch {
      return 'proposta'
    }
  })
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

  // Ricordata per preselezionare la sezione quando si aggiunge un brano
  useEffect(() => {
    try {
      sessionStorage.setItem('band_category', activeCategory)
    } catch {
      // storage non disponibile
    }
  }, [activeCategory])

  // Per la guida: un brano qualunque da aprire quando manca un riferimento
  useEffect(() => {
    if (songs.length) setCtx({ lastSongId: songs[0].id }, { ifMissing: true })
  }, [songs, setCtx])

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
      trackStep('move')
    } catch {
      // silently ignore
    }
  }

  return (
    <div className="min-h-screen flex flex-col pb-20">
      <AppHeader
        title="Repertorio"
        actions={
          <>
            <span className="text-sm text-gray-400 max-w-[96px] truncate">{user?.username}</span>
            <HelpButton />
            <button onClick={logout} className="p-2 text-gray-400 hover:text-gray-200" aria-label="Esci">
              <LogOut className="w-5 h-5" />
            </button>
          </>
        }
      />

      <CategoryTabs active={activeCategory} counts={counts} onChange={setActiveCategory} />

      {/* List */}
      <SwipeTabs
        keys={CATEGORIES.map((c) => c.key)}
        active={activeCategory}
        onChange={setActiveCategory}
        onSwipe={() => trackStep('swipe')}
        tour="song-list"
        className="flex-1"
      >
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw className="w-6 h-6 text-gray-600 animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-600">
            <p className="text-sm">Nessun brano in questa categoria</p>
          </div>
        ) : (
          filtered.map((song, i) => (
            <SongCard
              key={song.id}
              song={song}
              tourMenu={i === 0}
              onDelete={setToDelete}
              onCategoryChange={handleCategoryChange}
            />
          ))
        )}
      </SwipeTabs>

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
