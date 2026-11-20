import { useEffect, useState } from 'react'
import { Rocket } from 'lucide-react'
import client from '../../api/client'
import { CATEGORY_OPTIONS, Field, Modal, btnPrimary, btnSecondary, errorText, inputCls } from './ui'

/** Sposta un brano di prova "Pronto" nelle sezioni delle cover: titolo definitivo, artista e sezione. */
export default function PromoteDialog({ project, onClose, onPromoted }) {
  const [title, setTitle] = useState(project.title)
  const [artist, setArtist] = useState('')
  const [category, setCategory] = useState('da_provare')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // L'artista parte dal nome della band impostato dall'admin
  useEffect(() => {
    client.get('/config').then(({ data }) => setArtist((prev) => prev || data.band_name || '')).catch(() => {})
  }, [])

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const { data } = await client.post(`/studio/projects/${project.id}/promote`, { title, artist, category })
      onPromoted(data.song_id)
    } catch (err) {
      setError(errorText(err, 'Promozione non riuscita'))
      setSaving(false)
    }
  }

  return (
    <Modal title="Promuovi a brano della band" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-gray-400">
          Crea il brano nella lista principale (come inedito). I contenuti restano qui, e dalla scheda del brano si arriva al materiale delle prove.
        </p>
        <Field label="Titolo definitivo">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required className={inputCls} />
        </Field>
        <Field label="Artista" hint="Il nome della band, se il brano è vostro.">
          <input value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={150} required className={inputCls} />
        </Field>
        <Field label="Sezione">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </Field>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={saving} className={`${btnSecondary} flex-1`}>Annulla</button>
          <button type="submit" disabled={saving || !title.trim() || !artist.trim()} className={`${btnPrimary} flex-1`}>
            <Rocket className="w-4 h-4" />
            Promuovi
          </button>
        </div>
      </form>
    </Modal>
  )
}
