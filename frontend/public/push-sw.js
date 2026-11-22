/* Notifiche push (spec .kiro/specs/push-notifications/).
 * Importato dal service worker generato da vite-plugin-pwa (workbox.importScripts).
 * Non conosce il base path della build: usa lo scope della registrazione (es. https://…/band/). */

const scope = self.registration.scope

/** URL assoluto dell'app per una route interna ("/songs/4?focus=…") con il parametro n=<id notifica>. */
function appUrl(route, nid) {
  const url = new URL(String(route || '/').replace(/^\/+/, ''), scope)
  if (nid) url.searchParams.set('n', String(nid))
  return url.href
}

self.addEventListener('push', (event) => {
  let m = {}
  try {
    m = event.data ? event.data.json() : {}
  } catch {
    m = { body: event.data ? event.data.text() : '' }
  }
  const tasks = [
    self.registration.showNotification(m.title || 'Band Manager', {
      body: m.body || '',
      tag: m.tag || undefined,
      renotify: Boolean(m.tag && m.renotify),
      icon: scope + 'icon-192.png',
      badge: scope + 'badge-96.png',
      lang: 'it',
      data: { url: m.url || '/notifications', nid: m.nid || null },
    }),
    // La campanella delle finestre aperte si aggiorna subito
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      list.forEach((c) => c.postMessage({ type: 'band:notify' }))
    }),
  ]
  if (typeof m.unread === 'number' && self.navigator.setAppBadge) {
    tasks.push((m.unread > 0 ? self.navigator.setAppBadge(m.unread) : self.navigator.clearAppBadge()).catch(() => {}))
  }
  event.waitUntil(Promise.all(tasks))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const { url, nid } = event.notification.data || {}
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const win = list.find((c) => c.url.startsWith(scope))
      if (win) {
        // Navigazione interna (niente ricarica): la gestisce NotificationContext
        win.postMessage({ type: 'band:open', url, nid })
        return win.focus()
      }
      return self.clients.openWindow(appUrl(url, nid))
    }),
  )
})
