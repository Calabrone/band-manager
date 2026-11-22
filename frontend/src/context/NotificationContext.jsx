import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import client from '../api/client'
import { useAuth } from './AuthContext'
import { syncPush } from '../lib/push'

const POLL_MS = 60000

const NotificationContext = createContext({ unread: 0, refresh: async () => {}, setUnread: () => {}, markRead: async () => {} })

function setBadge(n) {
  try {
    if (n > 0) navigator.setAppBadge?.(n)?.catch?.(() => {})
    else navigator.clearAppBadge?.()?.catch?.(() => {})
  } catch {
    // Badging API assente
  }
}

/**
 * Conteggio delle notifiche non lette (campanella): all'avvio, al ritorno in primo piano, ogni 60 s con la
 * pagina visibile e subito quando il service worker riceve una push. Gestisce anche l'apertura da una push
 * (messaggio band:open oppure parametro ?n=<id> nell'URL) segnando la notifica come letta.
 */
export function NotificationProvider({ children }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [unread, setUnreadState] = useState(0)
  const active = Boolean(user?.id) && !user?.must_change_password
  const activeRef = useRef(active)
  activeRef.current = active

  const setUnread = useCallback((n) => {
    setUnreadState(n)
    setBadge(n)
  }, [])

  const refresh = useCallback(async () => {
    if (!activeRef.current) return
    try {
      const { data } = await client.get('/notifications/unread')
      setUnread(data.unread)
    } catch {
      // rete assente: si riprova al prossimo giro
    }
  }, [setUnread])

  const markRead = useCallback(async (ids) => {
    try {
      const { data } = await client.post('/notifications/read', Array.isArray(ids) ? { ids } : { all: true })
      setUnread(data.unread)
    } catch {
      // non bloccante
    }
  }, [setUnread])

  // Avvio, primo piano, intervallo
  useEffect(() => {
    if (!active) {
      setUnreadState(0)
      return undefined
    }
    refresh()
    syncPush(client)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, POLL_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [active, user?.id, refresh])

  // Messaggi dal service worker
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined
    const onMessage = (e) => {
      const m = e.data || {}
      if (m.type === 'band:notify') refresh()
      if (m.type === 'band:open' && m.url) {
        if (m.nid) markRead([m.nid])
        navigate(m.url)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [navigate, refresh, markRead])

  // App aperta da una push (openWindow): ?n=<id> → letta, poi il parametro sparisce
  useEffect(() => {
    if (!active) return
    const params = new URLSearchParams(location.search)
    const n = Number(params.get('n'))
    if (!params.has('n')) return
    params.delete('n')
    const qs = params.toString()
    navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '' }, { replace: true })
    if (Number.isInteger(n) && n > 0) markRead([n])
  }, [active, location.pathname, location.search, navigate, markRead])

  return (
    <NotificationContext.Provider value={{ unread, refresh, setUnread, markRead }}>
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  return useContext(NotificationContext)
}
