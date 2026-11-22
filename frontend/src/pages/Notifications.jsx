import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Settings2 } from 'lucide-react'
import client from '../api/client'
import AppHeader from '../components/ui/AppHeader'
import BottomNav from '../components/BottomNav'
import { userColor } from '../components/studio/ui'
import { useNotifications } from '../context/NotificationContext'
import { groupByDay, splitTitle, timeAgo } from '../lib/timeAgo'

const PAGE = 30

function NotificationText({ text }) {
  return (
    <>
      {splitTitle(text).map((p, i) =>
        p.title ? (
          <em key={i} className="not-italic font-semibold text-white">
            {p.text}
          </em>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}

function Avatar({ actor }) {
  const initial = (actor?.username || '?').slice(0, 1).toUpperCase()
  return (
    <span
      aria-hidden
      className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-on-solid"
      style={{ background: actor?.id ? userColor(actor.id) : 'rgb(var(--gray-600))' }}
    >
      {initial}
    </span>
  )
}

/** Storico delle notifiche (R2): per giorno, non lette evidenziate, apertura del contenuto. */
export default function Notifications() {
  const navigate = useNavigate()
  const { setUnread, markRead } = useNotifications()
  const [items, setItems] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(
    async (offset = 0) => {
      setLoading(true)
      setError('')
      try {
        const { data } = await client.get('/notifications', { params: { offset, limit: PAGE } })
        setItems((prev) => (offset === 0 ? data.items : [...prev, ...data.items]))
        setHasMore(data.has_more)
        setUnread(data.unread)
      } catch {
        setError('Impossibile caricare le notifiche')
      } finally {
        setLoading(false)
      }
    },
    [setUnread],
  )

  useEffect(() => {
    load(0)
  }, [load])

  function open(item) {
    if (!item.read) {
      setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, read: true } : x)))
      markRead([item.id])
    }
    navigate(item.url)
  }

  async function readAll() {
    setItems((prev) => prev.map((x) => ({ ...x, read: true })))
    await markRead()
  }

  const anyUnread = items.some((x) => !x.read)
  const groups = groupByDay(items)

  return (
    <div className="min-h-screen pb-24">
      <AppHeader
        title="Notifiche"
        icon={Bell}
        sticky
        bell={false}
        onBack={() => navigate(-1)}
        actions={
          <>
            {anyUnread && (
              <button
                onClick={readAll}
                data-testid="read-all"
                className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-sm text-brand-400 hover:bg-gray-900"
              >
                <CheckCheck className="w-4 h-4" />
                <span className="hidden min-[380px]:inline">Segna tutte come lette</span>
              </button>
            )}
            <button
              onClick={() => navigate('/profile/notifications')}
              aria-label="Impostazioni notifiche"
              className="p-2 rounded-full text-gray-400 hover:text-gray-200"
            >
              <Settings2 className="w-5 h-5" />
            </button>
          </>
        }
      />

      <div className="max-w-2xl mx-auto">
        {error && <p className="m-4 text-red-400 text-sm">{error}</p>}

        {!loading && !error && items.length === 0 && (
          <div className="px-6 py-16 text-center">
            <Bell className="w-10 h-10 mx-auto text-gray-600" />
            <p className="mt-3 text-gray-300 font-medium">Nessuna notifica</p>
            <p className="mt-1 text-gray-500 text-sm">Qui trovi brani, like, commenti e contenuti aggiunti dagli altri membri.</p>
          </div>
        )}

        {groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <h2 className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{g.label}</h2>
            <ul>
              {g.items.map((it) => (
                <li key={it.id}>
                  <button
                    onClick={() => open(it)}
                    data-testid="notification-item"
                    data-read={it.read ? '1' : '0'}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-gray-800/60 hover:bg-gray-900 focus:outline-none focus-visible:bg-gray-900 ${
                      it.read ? '' : 'bg-brand-900/30'
                    }`}
                  >
                    <Avatar actor={it.actors[0]} />
                    <span className="flex-1 min-w-0">
                      <span className={`block text-sm leading-snug ${it.read ? 'text-gray-300' : 'text-gray-100'}`}>
                        <NotificationText text={it.text} />
                      </span>
                      {it.excerpt && <span className="block mt-0.5 text-sm text-gray-500 truncate">“{it.excerpt}”</span>}
                      <span className="block mt-0.5 text-xs text-gray-500">{timeAgo(it.updated_at)}</span>
                    </span>
                    {!it.read && <span aria-label="Non letta" className="mt-1.5 w-2.5 h-2.5 rounded-full bg-brand-500 flex-shrink-0" />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {loading && <p className="p-4 text-center text-gray-500 text-sm">Caricamento…</p>}
        {!loading && hasMore && (
          <div className="p-4">
            <button
              onClick={() => load(items.length)}
              className="w-full py-2.5 rounded-xl bg-gray-900 border border-gray-800 text-sm text-gray-300 hover:bg-gray-800"
            >
              Carica altre
            </button>
          </div>
        )}
      </div>
      <BottomNav />
    </div>
  )
}
