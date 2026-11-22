import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, LogOut, Palette } from 'lucide-react'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'
import AppHeader from '../components/ui/AppHeader'
import HelpButton from '../components/onboarding/HelpButton'
import { VERSION } from '../version'
import { useTheme } from '../context/ThemeContext'
import { PRESETS } from '../lib/themePresets'

const INPUT =
  'w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 text-base'

function AccountForm() {
  const { user, updateUser } = useAuth()
  const [username, setUsername] = useState(user?.username || '')
  const [email, setEmail] = useState(user?.email || '')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)
    try {
      const { data } = await client.put('/auth/profile', { username, email })
      updateUser(data)
      setSuccess(true)
    } catch (err) {
      setError(err.response?.data?.detail || 'Errore nel salvataggio')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-300 mb-3">Account</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          maxLength={30}
          autoComplete="username"
          placeholder="Username"
          className={INPUT}
        />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          placeholder="Email (per il recupero password)"
          className={INPUT}
        />
        {!user?.email && (
          <p className="text-yellow-400 text-xs">
            Aggiungi la tua email: senza non puoi recuperare la password da solo.
          </p>
        )}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {success && <p className="text-green-400 text-sm">Dati aggiornati</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-on-accent font-medium text-sm disabled:opacity-50"
        >
          {loading ? 'Salvataggio...' : 'Salva dati'}
        </button>
      </form>
    </div>
  )
}

export default function Profile() {
  const navigate = useNavigate()
  const { user, logout, applySession } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const forced = Boolean(user?.must_change_password)
  const { theme } = useTheme()
  const themeName = theme.preset === 'auto' ? 'Automatico' : PRESETS[theme.preset]?.label
  const customized = Boolean(theme.accent || theme.tint || theme.contrast !== 'normal' || theme.font !== 'system' || theme.scale !== 100 || theme.radius !== 'soft')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess(false)
    if (newPassword !== confirm) {
      setError('Le password non coincidono')
      return
    }
    if (newPassword.length < 6) {
      setError('La nuova password deve essere di almeno 6 caratteri')
      return
    }
    setLoading(true)
    try {
      const { data } = await client.put('/auth/password', { current_password: currentPassword, new_password: newPassword })
      // Il vecchio token non e' piu' valido: si usa quello nuovo
      applySession(data.token, data.user)
      setSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirm('')
      if (forced) navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Errore nel cambio password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen pb-24">
      <AppHeader title="Profilo" sticky onBack={forced ? undefined : () => navigate(-1)} actions={forced ? undefined : <HelpButton />} />

      <div className="p-4 space-y-6">
        {forced && (
          <div className="rounded-xl bg-yellow-900/30 border border-yellow-800 px-4 py-3">
            <p className="text-yellow-300 text-sm">
              Stai usando la password di default: scegline una nuova per continuare.
            </p>
          </div>
        )}

        <div className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-3">
          <p className="text-white font-medium">{user?.username}</p>
          <p className="text-gray-500 text-sm capitalize">{user?.role}</p>
        </div>

        {!forced && (
          <button
            onClick={() => navigate('/profile/appearance')}
            data-testid="open-appearance"
            className="flex items-center gap-3 w-full rounded-xl bg-gray-900 border border-gray-800 px-4 py-3 text-left hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          >
            <Palette className="w-5 h-5 text-brand-400 flex-shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-white font-medium">Aspetto</span>
              <span className="block text-gray-500 text-sm truncate">{themeName}{customized ? ', personalizzato' : ''}</span>
            </span>
            <ChevronRight className="w-5 h-5 text-gray-500 flex-shrink-0" />
          </button>
        )}

        {!forced && <AccountForm />}

        {/* Change password */}
        <div>
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Cambia password</h2>
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="Password attuale"
              className={INPUT}
            />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="Nuova password"
              className={INPUT}
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              autoComplete="new-password"
              placeholder="Conferma nuova password"
              className={INPUT}
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && <p className="text-green-400 text-sm">Password aggiornata con successo</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-on-accent font-medium text-sm disabled:opacity-50"
            >
              {loading ? 'Salvataggio...' : 'Aggiorna password'}
            </button>
          </form>
        </div>

        {/* Logout */}
        <button
          onClick={() => { logout(); navigate('/login') }}
          className="flex items-center gap-2 w-full px-4 py-3 rounded-xl border border-red-800 text-red-400 hover:bg-red-950 text-sm font-medium"
        >
          <LogOut className="w-4 h-4" />
          Esci
        </button>

        <p className="text-center text-xs text-gray-600">Versione {VERSION}</p>
      </div>
    </div>
  )
}
