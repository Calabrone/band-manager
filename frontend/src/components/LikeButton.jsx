import { useState, useEffect } from 'react'
import { Heart } from 'lucide-react'
import client from '../api/client'
import { trackStep } from '../lib/onboarding'

export default function LikeButton({ songId, compact = false, tour = false }) {
  const [likeData, setLikeData] = useState({ count: 0, liked: false })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    client.get(`/songs/${songId}/likes`).then(({ data }) => {
      if (!cancelled) setLikeData(data)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [songId])

  async function handleToggle(e) {
    e.stopPropagation()
    if (loading) return
    setLoading(true)
    try {
      const { data } = await client.post(`/songs/${songId}/likes`)
      setLikeData(data)
      if (data.liked) trackStep('like')
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      data-tour={tour ? 'like-btn' : undefined}
      onClick={handleToggle}
      disabled={loading}
      className={`flex items-center gap-1 transition-colors disabled:opacity-50
        ${likeData.liked ? 'text-red-400' : 'text-gray-500 hover:text-red-400'}
        ${compact ? 'text-xs' : 'text-sm'}`}
      aria-label={likeData.liked ? 'Rimuovi like' : 'Metti like'}
    >
      <Heart className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} ${likeData.liked ? 'fill-current' : ''}`} />
      <span>{likeData.count}</span>
    </button>
  )
}
