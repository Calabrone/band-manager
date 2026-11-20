import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import client from '../api/client'
import BottomNav from '../components/BottomNav'
import { Field, btnPrimary, errorText, inputCls } from '../components/studio/ui'

export default function StudioProjectEdit() {
  const { pid } = useParams()
  const navigate = useNavigate()
  const editing = !!pid
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [bpm, setBpm] = useState('')
  const [musicKey, setMusicKey] = useState('')
  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!editing) return
    client.get(`/studio/projects/${pid}`).then(({ data }) => {
      setTitle(data.title)
      setDescription(data.description ?? '')
      setBpm(data.bpm ? String(data.bpm) : '')
      setMusicKey(data.music_key ?? '')
    }).catch((err) => setError(errorText(err, 'Brano non trovato'))).finally(() => setLoading(false))
  }, [editing, pid])

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const body = {
      title,
      description: description.trim() || null,
      bpm: bpm.trim() ? Number(bpm) : null,
      music_key: musicKey.trim() || null,
    }
    try {
      const { data } = editing ? await client.put(`/studio/projects/${pid}`, body) : await client.post('/studio/projects', body)
      navigate(`/studio/${data.id}`, { replace: true })
    } catch (err) {
      setError(errorText(err, 'Salvataggio non riuscito'))
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="flex items-center gap-3 px-4 py-3 bg-gray-950 border-b border-gray-800 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="p-1 text-gray-400 hover:text-gray-200">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-white">{editing ? 'Modifica brano di prova' : 'Nuovo brano di prova'}</h1>
      </header>

      {loading ? (
        <p className="text-center text-sm text-gray-600 py-16">Caricamento…</p>
      ) : (
        <form onSubmit={submit} className="p-4 space-y-4 max-w-md mx-auto">
          <Field label="Titolo provvisorio">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required autoFocus={!editing}
                   className={inputCls} placeholder="es. Pezzo nuovo in Mi" />
          </Field>
          <Field label="Descrizione (facoltativa)" hint="Idea del brano, riferimenti, cosa serve da ciascuno.">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={5}
                      className={inputCls} />
          </Field>
          <div className="flex gap-3">
            <Field label="BPM (facoltativo)" hint="Usato dal conteggio del player.">
              <input type="number" inputMode="numeric" min={40} max={300} value={bpm} onChange={(e) => setBpm(e.target.value)}
                     className={inputCls} placeholder="100" />
            </Field>
            <Field label="Tonalità (facoltativa)">
              <input value={musicKey} onChange={(e) => setMusicKey(e.target.value)} maxLength={20} className={inputCls}
                     placeholder="Em" />
            </Field>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={saving || !title.trim()} className={`${btnPrimary} w-full py-3`}>
            {saving ? 'Salvataggio…' : editing ? 'Salva' : 'Crea brano di prova'}
          </button>
        </form>
      )}
      <BottomNav />
    </div>
  )
}
