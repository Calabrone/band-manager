import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Save, Trash2, Eye, EyeOff } from 'lucide-react'
import client from '../api/client'
import ConfirmDialog from '../components/ConfirmDialog'

function UsersTab() {
  const [users, setUsers] = useState([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('member')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [toDelete, setToDelete] = useState(null)

  useEffect(() => {
    client.get('/admin/users').then(({ data }) => setUsers(data))
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await client.post('/admin/users', { username, password, role })
      setUsers((prev) => [...prev, data])
      setUsername('')
      setPassword('')
      setRole('member')
    } catch (err) {
      setError(err.response?.data?.detail || 'Errore nella creazione')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!toDelete) return
    try {
      await client.delete(`/admin/users/${toDelete.id}`)
      setUsers((prev) => prev.filter((u) => u.id !== toDelete.id))
    } catch {
      // ignore
    } finally {
      setToDelete(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* User list */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Membri ({users.length})</h2>
        <div className="rounded-xl overflow-hidden border border-gray-800">
          {users.map((u, i) => (
            <div
              key={u.id}
              className={`flex items-center justify-between px-4 py-3 ${
                i > 0 ? 'border-t border-gray-800' : ''
              } bg-gray-900`}
            >
              <div>
                <p className="text-white text-sm font-medium">{u.username}</p>
                <p className="text-gray-500 text-xs capitalize">{u.role}</p>
              </div>
              <button
                onClick={() => setToDelete(u)}
                className="p-2 text-gray-500 hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Add user form */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">Nuovo membro</h2>
        <form onSubmit={handleCreate} className="space-y-3">
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            placeholder="Username"
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 text-base"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="Password"
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 text-base"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-brand-500 text-base"
          >
            <option value="member">Membro</option>
            <option value="admin">Admin</option>
          </select>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            {loading ? 'Creazione...' : 'Crea membro'}
          </button>
        </form>
      </div>

      {toDelete && (
        <ConfirmDialog
          title="Elimina utente"
          message={`Eliminare l'utente "${toDelete.username}"?`}
          onConfirm={handleDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  )
}

function SettingField({ label, hint, settingKey, initialMasked }) {
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [currentMasked, setCurrentMasked] = useState(initialMasked || 'Non configurata')

  useEffect(() => {
    setCurrentMasked(initialMasked || 'Non configurata')
  }, [initialMasked])

  async function handleSave() {
    if (!value.trim()) return
    setSaving(true)
    try {
      const { data } = await client.put('/admin/settings', { key: settingKey, value })
      setCurrentMasked(data.value_masked || 'Non configurata')
      setValue('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {hint && <p className="text-xs text-gray-500 mb-1">{hint}</p>}
      <p className="text-xs text-gray-500 mb-2">
        Attuale: <span className="font-mono text-gray-400">{currentMasked}</span>
      </p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Nuovo valore..."
            className="w-full px-4 py-3 pr-10 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => setShow(!show)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500"
          >
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !value.trim()}
          className={`px-4 py-3 rounded-xl flex items-center gap-1.5 text-sm font-medium transition disabled:opacity-50 ${
            saved ? 'bg-green-700 text-white' : 'bg-brand-600 hover:bg-brand-700 text-white'
          }`}
        >
          <Save className="w-4 h-4" />
          {saved ? 'Salvata ✓' : saving ? '...' : 'Salva'}
        </button>
      </div>
    </div>
  )
}

function SettingsTab() {
  const [settings, setSettings] = useState([])

  useEffect(() => {
    client.get('/admin/settings').then(({ data }) => setSettings(data))
  }, [])

  const masked = Object.fromEntries(settings.map((s) => [s.key, s.value_masked]))

  return (
    <div className="space-y-6">
      <SettingField
        label="Groq API Key"
        hint="Trovala su console.groq.com → API Keys"
        settingKey="groq_api_key"
        initialMasked={masked.groq_api_key}
      />
      <SettingField
        label="LyricsGenius Access Token"
        hint="Vai su genius.com/api-clients → crea un'app → copia il campo «Client Access Token»"
        settingKey="genius_api_key"
        initialMasked={masked.genius_api_key}
      />
      <p className="text-xs text-gray-500 pt-2 border-t border-gray-800">
        Le chiavi sono salvate sul server e non vengono mai inviate al browser.
      </p>
    </div>
  )
}

export default function Admin() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('users')

  return (
    <div className="min-h-screen pb-8">
      <header className="flex items-center gap-3 px-4 py-3 bg-gray-950 border-b border-gray-800 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="p-1 text-gray-400 hover:text-gray-200">
          <ArrowLeft className="w-6 h-6" />
        </button>
        <h1 className="text-base font-semibold text-white">Admin</h1>
      </header>

      <div className="flex border-b border-gray-800">
        {['users', 'settings'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === t
                ? 'text-brand-400 border-b-2 border-brand-500'
                : 'text-gray-400'
            }`}
          >
            {t === 'users' ? 'Utenti' : 'Impostazioni'}
          </button>
        ))}
      </div>

      <div className="p-4">
        {tab === 'users' ? <UsersTab /> : <SettingsTab />}
      </div>
    </div>
  )
}
