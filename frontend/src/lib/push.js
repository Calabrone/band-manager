// Notifiche push del dispositivo (spec .kiro/specs/push-notifications/).
// Le funzioni pure (urlB64ToUint8Array, pushSupport, detectEnv) sono testate con node --test.

/** Chiave VAPID base64url → Uint8Array per pushManager.subscribe. */
export function urlB64ToUint8Array(s) {
  const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Uint8Array/ArrayBuffer → base64url (per confrontare la chiave della sottoscrizione con quella del server). */
export function bytesToUrlB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Stato delle push su questo dispositivo:
 *   'ok'          si possono attivare (o sono attive)
 *   'ios-install' iPhone/iPad da Safari: serve l'app nella schermata Home (iOS ≥ 16.4)
 *   'denied'      permesso negato nelle impostazioni del browser
 *   'unsupported' browser senza Push API
 */
export function pushSupport({ hasSW, hasPush, hasNotification, isIOS, standalone, permission }) {
  if (isIOS && !standalone) return 'ios-install'
  if (!hasSW || !hasPush || !hasNotification) return 'unsupported'
  if (permission === 'denied') return 'denied'
  return 'ok'
}

/** Ambiente reale del browser per pushSupport. */
export function detectEnv(win = globalThis) {
  const nav = win.navigator || {}
  const ua = nav.userAgent || ''
  // iPadOS si presenta come Mac: lo tradisce il touch
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1)
  const standalone = Boolean(win.matchMedia?.('(display-mode: standalone)').matches || nav.standalone)
  return {
    hasSW: 'serviceWorker' in nav,
    hasPush: 'PushManager' in win,
    hasNotification: 'Notification' in win,
    isIOS,
    standalone,
    permission: win.Notification ? win.Notification.permission : 'default',
  }
}

export function currentSupport() {
  return pushSupport(detectEnv())
}

async function registration() {
  if (!('serviceWorker' in navigator)) return null
  // In sviluppo (vite dev) non c'è service worker: ready non si risolverebbe mai
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
  ])
  return reg
}

export async function currentSubscription() {
  const reg = await registration()
  return reg ? reg.pushManager.getSubscription() : null
}

function subscriptionBody(sub) {
  const json = sub.toJSON()
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }
}

/** Chiede il permesso (va chiamata da un gesto dell'utente), sottoscrive e registra sul server. */
export async function enablePush(client) {
  if (currentSupport() !== 'ok') throw new Error('Notifiche non disponibili su questo dispositivo')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error(permission === 'denied' ? 'denied' : 'Permesso non concesso')
  const reg = await registration()
  if (!reg) throw new Error('Service worker non attivo: ricarica la pagina e riprova')
  const { data } = await client.get('/push/key')
  let sub = await reg.pushManager.getSubscription()
  if (sub && !sameKey(sub, data.public_key)) {
    await sub.unsubscribe()
    sub = null
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(data.public_key) })
  }
  await client.post('/push/subscriptions', subscriptionBody(sub))
  return sub
}

function sameKey(sub, publicKey) {
  const k = sub.options?.applicationServerKey
  return !k || bytesToUrlB64(k) === publicKey
}

/** Toglie la sottoscrizione dal server e dal browser. Non lancia errori (si usa anche al logout). */
export async function disablePush(client) {
  try {
    const sub = await currentSubscription()
    if (!sub) return
    await client.delete('/push/subscriptions', { data: { endpoint: sub.endpoint } }).catch(() => {})
    await sub.unsubscribe().catch(() => {})
  } catch {
    // nessun service worker o push non supportate: niente da togliere
  }
}

/**
 * All'avvio con utente autenticato: se il dispositivo ha già una sottoscrizione la ri-registra
 * (endpoint ruotato, cambio utente sul dispositivo, chiave VAPID cambiata).
 */
export async function syncPush(client) {
  try {
    if (currentSupport() !== 'ok' || Notification.permission !== 'granted') return
    const sub = await currentSubscription()
    if (!sub) return
    const { data } = await client.get('/push/key')
    if (!sameKey(sub, data.public_key)) {
      await sub.unsubscribe()
      await enablePush(client)
      return
    }
    await client.post('/push/subscriptions', subscriptionBody(sub))
  } catch {
    // best effort
  }
}
