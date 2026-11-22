import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellRing, Send, Share, SquarePlus } from 'lucide-react'
import client from '../api/client'
import AppHeader from '../components/ui/AppHeader'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { currentSubscription, currentSupport, disablePush, enablePush } from '../lib/push'

const CATEGORIES = [
  { key: 'song', label: 'Nuovi brani', hint: 'Brani in repertorio, brani di prova, promozioni', options: ['all', 'off'] },
  { key: 'like', label: 'Mi piace', hint: 'Like ai brani', options: ['all', 'mine', 'off'] },
  { key: 'comment', label: 'Commenti', hint: 'Su brani, brani di prova e contenuti delle prove', options: ['all', 'mine', 'off'] },
  { key: 'media', label: 'Video, audio e prove', hint: 'Link video, audio e nuovi contenuti delle prove', options: ['all', 'mine', 'off'] },
]
const OPTION_LABEL = { all: 'Tutti', mine: 'Solo i miei', off: 'Nessuno' }
const DEFAULT_PREFS = { song: 'all', like: 'all', comment: 'all', media: 'all' }

function Choice({ name, options, value, onChange }) {
  return (
    <div role="radiogroup" aria-label={name} className="flex p-1 rounded-xl bg-gray-800">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          data-option={o}
          onClick={() => onChange(o)}
          className={`flex-1 min-w-0 px-2 py-1.5 rounded-lg text-sm font-medium truncate transition-colors ${
            value === o ? 'bg-brand-600 text-on-accent' : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {OPTION_LABEL[o]}
        </button>
      ))}
    </div>
  )
}

function DeviceSwitch({ on, busy, onToggle }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={busy}
      onClick={onToggle}
      data-testid="push-switch"
      className={`relative w-12 h-7 rounded-full flex-shrink-0 transition-colors disabled:opacity-50 ${on ? 'bg-brand-600' : 'bg-gray-700'}`}
    >
      <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-on-solid transition-transform ${on ? 'translate-x-5' : ''}`} />
      <span className="sr-only">Notifiche push su questo dispositivo</span>
    </button>
  )
}

function SupportNote({ support }) {
  if (support === 'ios-install') {
    return (
      <div className="mt-3 rounded-xl bg-amber-900/30 border border-amber-800 px-3 py-2.5 text-sm text-amber-200 space-y-1.5" data-testid="push-ios">
        <p>Su iPhone e iPad le notifiche arrivano solo se l&apos;app è nella schermata Home (iOS 16.4 o successivo):</p>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            in Safari tocca <Share className="inline w-4 h-4 -mt-0.5" aria-label="Condividi" /> Condividi;
          </li>
          <li>
            scegli <SquarePlus className="inline w-4 h-4 -mt-0.5" aria-hidden /> «Aggiungi alla schermata Home»;
          </li>
          <li>apri l&apos;app dall&apos;icona e torna qui.</li>
        </ol>
      </div>
    )
  }
  if (support === 'denied') {
    return (
      <p className="mt-3 rounded-xl bg-amber-900/30 border border-amber-800 px-3 py-2.5 text-sm text-amber-200" data-testid="push-denied">
        Le notifiche sono bloccate per questo sito. Riattivale dalle impostazioni del browser (icona accanto all&apos;indirizzo, oppure
        Impostazioni → Notifiche), poi torna qui.
      </p>
    )
  }
  if (support === 'unsupported') {
    return (
      <p className="mt-3 text-sm text-gray-500" data-testid="push-unsupported">
        Questo browser non supporta le notifiche push. Le novità restano visibili nella campanella.
      </p>
    )
  }
  return null
}

/** Profilo → Notifiche (R4): push del dispositivo e preferenze per categoria. */
export default function NotificationSettings() {
  const navigate = useNavigate()
  const { user, updateUser } = useAuth()
  const { showToast } = useToast()
  const [support, setSupport] = useState(currentSupport)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(true)
  const [prefs, setPrefs] = useState({ ...DEFAULT_PREFS, ...(user?.notify_prefs || {}) })

  useEffect(() => {
    let alive = true
    currentSubscription()
      .then((sub) => alive && setSubscribed(Boolean(sub) && Notification.permission === 'granted'))
      .catch(() => {})
      .finally(() => alive && setBusy(false))
    // Preferenze aggiornate dal server (potrebbero essere cambiate da un altro dispositivo)
    client
      .get('/auth/me')
      .then(({ data }) => {
        if (!alive) return
        updateUser(data)
        setPrefs({ ...DEFAULT_PREFS, ...(data.notify_prefs || {}) })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggle() {
    setBusy(true)
    try {
      if (subscribed) {
        await disablePush(client)
        setSubscribed(false)
        showToast('Notifiche disattivate su questo dispositivo')
      } else {
        await enablePush(client)
        setSubscribed(true)
        showToast('Notifiche attivate')
      }
    } catch (err) {
      if (err.message === 'denied') setSupport('denied')
      else showToast(err.response?.data?.detail || err.message || 'Operazione non riuscita')
    } finally {
      setBusy(false)
    }
  }

  async function changePref(key, value) {
    const before = prefs
    setPrefs({ ...prefs, [key]: value })
    try {
      const { data } = await client.put('/auth/notify-prefs', { [key]: value })
      setPrefs(data.notify_prefs)
      updateUser({ ...user, notify_prefs: data.notify_prefs })
    } catch {
      setPrefs(before)
      showToast('Preferenza non salvata, riprova')
    }
  }

  async function sendTest() {
    try {
      await client.post('/push/test')
      showToast('Notifica di prova inviata')
    } catch (err) {
      showToast(err.response?.data?.detail || 'Invio non riuscito')
    }
  }

  return (
    <div className="min-h-screen pb-24">
      <AppHeader title="Notifiche" sticky bell={false} onBack={() => navigate(-1)} />

      <div className="p-4 space-y-6 max-w-2xl mx-auto">
        <section className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-3">
          <div className="flex items-center gap-3">
            <BellRing className="w-5 h-5 text-brand-400 flex-shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-white font-medium">Notifiche push su questo dispositivo</span>
              <span className="block text-gray-500 text-sm">Arrivano anche con l&apos;app chiusa</span>
            </span>
            {support === 'ok' && <DeviceSwitch on={subscribed} busy={busy} onToggle={toggle} />}
          </div>
          <SupportNote support={support} />
          {support === 'ok' && subscribed && (
            <button
              onClick={sendTest}
              data-testid="push-test"
              className="mt-3 flex items-center gap-2 text-sm text-brand-400 hover:text-brand-300"
            >
              <Send className="w-4 h-4" />
              Invia notifica di prova
            </button>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-gray-300">Cosa notificare</h2>
          <p className="text-gray-500 text-sm mb-3">Vale per tutti i tuoi dispositivi e per la campanella. «Solo i miei» = brani che hai proposto e contenuti che hai creato.</p>
          <div className="space-y-4">
            {CATEGORIES.map((c) => (
              <div key={c.key} data-pref={c.key}>
                <p className="text-white text-sm font-medium">{c.label}</p>
                <p className="text-gray-500 text-xs mb-1.5">{c.hint}</p>
                <Choice name={c.label} options={c.options} value={prefs[c.key]} onChange={(v) => changePref(c.key, v)} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
