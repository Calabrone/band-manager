import { useEffect, useState } from 'react'
import { Check, Loader2, Video, X } from 'lucide-react'
import client from '../api/client'

function formatDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Per i brani senza copertina ufficiale: sceglie da quale video di prova prendere la miniatura.
 * `song.cover_video_id` null = automatico (il video più recente).
 */
export default function CoverPicker({ song, onChanged, onClose }) {
  const [videos, setVideos] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    client.get(`/songs/${song.id}/videos`)
      .then(({ data }) => { if (!cancelled) setVideos(data.filter((v) => v.cover_thumb)) })
      .catch(() => { if (!cancelled) setVideos([]) })
    return () => { cancelled = true }
  }, [song.id])

  async function choose(videoId) {
    setSaving(true)
    setError('')
    try {
      const { data } = await client.put(`/songs/${song.id}/cover`, { video_id: videoId })
      onChanged(data)
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Salvataggio non riuscito')
      setSaving(false)
    }
  }

  // Quale video è in uso adesso: quello scelto, altrimenti il primo (il più recente)
  const activeId = song.cover_video_id ?? videos?.[0]?.id

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-2xl">
        <div className="flex items-center justify-between px-5 pt-4">
          <h3 className="text-white font-semibold text-base">Scegli la copertina</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {videos === null && <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />}
          {videos?.length === 0 && (
            <p className="text-sm text-gray-400">
              Nessun video con una miniatura. Aggiungi un video delle prove: la sua miniatura diventa la copertina.
            </p>
          )}
          {videos?.length > 0 && (
            <>
              <p className="text-xs text-gray-500">
                Il brano non ha una copertina ufficiale: scegli da quale video prenderla.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {videos.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    disabled={saving}
                    onClick={() => choose(v.id)}
                    className={`text-left rounded-xl overflow-hidden border disabled:opacity-50 ${
                      v.id === activeId ? 'border-brand-500' : 'border-gray-700 hover:border-gray-500'
                    }`}
                  >
                    <div className="relative aspect-video bg-gray-800 flex items-center justify-center">
                      <img
                        src={v.cover_thumb}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                      />
                      <Video className="absolute w-6 h-6 text-gray-600 -z-0" />
                      {v.id === activeId && (
                        <span className="absolute top-1 right-1 p-0.5 rounded-full bg-brand-600">
                          <Check className="w-3 h-3 text-white" />
                        </span>
                      )}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="text-xs text-white truncate">{v.title}</p>
                      <p className="text-[10px] text-gray-500">{formatDate(v.recorded_on)}</p>
                    </div>
                  </button>
                ))}
              </div>
              {song.cover_video_id !== null && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => choose(null)}
                  className="text-xs text-brand-400 hover:text-brand-300 disabled:opacity-50"
                >
                  Torna all'automatica (video più recente)
                </button>
              )}
            </>
          )}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  )
}
