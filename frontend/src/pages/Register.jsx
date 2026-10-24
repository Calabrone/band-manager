import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Loader2, Music2 } from 'lucide-react'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'

const INPUT =
  'w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 text-base'

export default function Register() {
  const { token } = useParams()
  const { applySession } = useAuth()
  const navigate = useNavigate()
  const [invite, setInvite] = useState(null) // null = verifica in corso
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    client
      .get(`/auth/invite/${token}`)
      .then(({ data }) => setInvite(data))
      .catch(() => setInvite({ valid: false }))
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
      const { data } = await client.post('/auth/register', { token, username, email, password })
      applySession(data.token, data.user)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Errore nella registrazione')
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
          <h1 className="text-2xl font-bold text-white">Band Manager</h1>
          <p className="text-gray-400 text-sm mt-1">Crea il tuo account</p>
        </div>

        {invite === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
          </div>
        ) : !invite.valid ? (
          <div className="space-y-4 text-center">
            <p className="text-red-400 text-sm">
              Questo invito non è più valido: è scaduto, è già stato usato o è stato revocato.
              Chiedi all'admin un nuovo link.
            </p>
            <Link to="/login" className="text-sm text-brand-400">Vai al login</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                minLength={3}
                maxLength={30}
                className={INPUT}
                placeholder="3-30 caratteri"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className={INPUT}
                placeholder="serve per recuperare la password"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={6}
                className={INPUT}
                placeholder="almeno 6 caratteri"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Conferma password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
                className={INPUT}
              />
            </div>
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-base transition disabled:opacity-50"
            >
              {loading ? 'Creazione...' : 'Crea account'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
