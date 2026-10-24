import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Music2 } from 'lucide-react'
import client from '../api/client'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await client.post('/auth/forgot', { email })
      setSent(true)
    } catch (err) {
      setError(err.response?.data?.detail || 'Errore nella richiesta')
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
          <h1 className="text-2xl font-bold text-white">Recupero password</h1>
        </div>

        {sent ? (
          <p className="text-gray-300 text-sm text-center">
            Se l'email corrisponde a un account, ti abbiamo inviato un link per scegliere una nuova
            password (valido 1 ora). Controlla anche la cartella spam. Se non hai un'email associata,
            chiedi all'admin un link di reset.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-gray-400 text-sm">
              Inserisci l'email che hai indicato in registrazione: ti mandiamo un link per reimpostare la password.
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 text-base"
              placeholder="la tua email"
            />
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-base transition disabled:opacity-50"
            >
              {loading ? 'Invio...' : 'Invia link'}
            </button>
          </form>
        )}

        <p className="text-center mt-6">
          <Link to="/login" className="text-sm text-gray-400 hover:text-brand-400">Torna al login</Link>
        </p>
      </div>
    </div>
  )
}
