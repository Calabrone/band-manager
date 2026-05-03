import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle, Loader2, XCircle } from 'lucide-react'
import client from '../api/client'

export default function AddEditSong() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)

  const [artist, setArtist] = useState('')
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('proposta')
  const [submitting, setSubmitting] = useState(false)
  const [validating, setValidating] = useState(false)
  const [validationStatus, setValidationStatus] = useState(null) // 'ok' | 'error' | null
  const [validationMsg, setValidationMsg] = useState('')
  const [error, setError] = useState('')
  const pollRef = useRef(null)

  useEffect(() => {
    if (isEdit) {
      client.get(`/songs/${id}`).then(({ data }) => {
        setArtist(data.artist)
        setTitle(data.title)
        setCategory(data.category)
      })
    }
  }, [id, isEdit])

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => () => stopPolling(), [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      if (isEdit) {
        await client.put(`/songs/${id}`, { artist, title, category })
        navigate(`/songs/${id}`)
      } else {
        setValidating(true)
        setValidationStatus(null)
        const { data: created } = await client.post('/songs', { artist, title })

        // Poll until validated or error
        pollRef.current = setInterval(async () => {
          try {
            const { data } = await client.get(`/songs/${created.id}`)
            if (data.validated) {
              stopPolling()
              setValidating(false)
              setValidationStatus('ok')
              setTimeout(() => navigate(`/songs/${data.id}`), 800)
            } else if (data.validation_error) {
              stopPolling()
              setValidating(false)
              setValidationStatus('error')
              setValidationMsg(data.validation_error)
            }
          } catch {
            stopPolling()
            setValidating(false)
          }
        }, 2000)
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Errore durante il salvataggio')
      setValidating(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen pb-8">
      <header className="flex items-center gap-3 px-4 py-3 bg-gray-950 border-b border-gray-800 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="p-1 text-gray-400 hover:text-gray-200">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-white">
          {isEdit ? 'Modifica brano' : 'Aggiungi brano'}
        </h1>
      </header>

      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Artista</label>
          <input
            type="text"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            required
            disabled={validating}
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 text-base disabled:opacity-50"
            placeholder="es. Radiohead"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Titolo</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            disabled={validating}
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 text-base disabled:opacity-50"
            placeholder="es. Creep"
          />
        </div>

        {isEdit && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Categoria</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-brand-500 text-base"
            >
              <option value="proposta">Proposta</option>
              <option value="da_provare">Da Provare</option>
              <option value="in_scaletta">In Scaletta</option>
            </select>
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {/* Validation feedback */}
        {validating && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-800 border border-gray-700">
            <Loader2 className="w-5 h-5 text-brand-400 animate-spin flex-shrink-0" />
            <div>
              <p className="text-white text-sm font-medium">Validazione in corso...</p>
              <p className="text-gray-400 text-xs mt-0.5">
                Sto cercando il brano e scaricando testi e accordi
              </p>
            </div>
          </div>
        )}

        {validationStatus === 'ok' && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-green-900/30 border border-green-800">
            <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0" />
            <p className="text-green-300 text-sm font-medium">Brano trovato! Apertura...</p>
          </div>
        )}

        {validationStatus === 'error' && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-red-900/30 border border-red-800">
            <XCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 text-sm font-medium">Brano non trovato</p>
              <p className="text-red-400 text-xs mt-0.5">{validationMsg}</p>
              <button
                type="button"
                onClick={() => setValidationStatus(null)}
                className="text-xs text-brand-400 mt-2 underline"
              >
                Riprova con dati diversi
              </button>
            </div>
          </div>
        )}

        {!validating && validationStatus !== 'ok' && (
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-base transition disabled:opacity-50"
          >
            {isEdit ? 'Salva modifiche' : 'Aggiungi brano'}
          </button>
        )}
      </form>
    </div>
  )
}
