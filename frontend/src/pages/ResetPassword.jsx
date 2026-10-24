import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loader2, Music2 } from 'lucide-react'
import client from '../api/client'

const INPUT =
  'w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 text-base'

export default function ResetPassword() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [valid, setValid] = useState(null) // null = verifica in corso
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    client
      .get(`/auth/reset/${token}`)
      .then(({ data }) => setValid(data.valid))
      .catch(() => setValid(false))
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Le password non coincidono')
      return
    }
    setLoading(true)
    try {
      await client.post('/auth/reset', { token, new_password: password })
      setDone(true)
      setTimeout(() => navigate('/login'), 1500)
    } catch (err) {
      setError(err.response?.data?.detail || 'Errore nel reset')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gray-950">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-brand-600 flex items-center justify-center mb-4">
            <Music2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Nuova password</h1>
        </div>

        {valid === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
          </div>
        ) : !valid ? (
          <div className="space-y-4 text-center">
            <p className="text-red-400 text-sm">
              Questo link non è più valido: è scaduto o è già stato usato.
            </p>
            <Link to="/forgot" className="text-sm text-brand-400">Richiedine uno nuovo</Link>
          </div>
        ) : done ? (
          <p className="text-green-400 text-sm text-center">Password aggiornata. Ora puoi accedere.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={6}
              className={INPUT}
              placeholder="Nuova password (min 6 caratteri)"
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              className={INPUT}
              placeholder="Conferma password"
            />
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-base transition disabled:opacity-50"
            >
              {loading ? 'Salvataggio...' : 'Imposta password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
