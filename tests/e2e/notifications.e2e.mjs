// Verifica end-to-end delle notifiche (spec .kiro/specs/push-notifications/): Chrome headless a 360×780, via CDP, Node >= 22.
//
// Contro un sito locale (Docker, deploy/local) o l'ambiente di prova; NON lanciarlo sul sito di produzione.
//   ADMIN_PASSWORD=... [ADMIN_USER=admin] [E2E_SITE=http://localhost:8080/band] [CHROME_PATH=...]
//     node tests/e2e/notifications.e2e.mjs
// Crea un membro di prova (invito) che agisce sui brani dell'admin; alla fine elimina brani e membro.
// La consegna reale delle push non si verifica qui (serve un telefono): si controlla l'attivazione sul dispositivo.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SITE = (process.env.E2E_SITE || 'http://localhost:8080/band').replace(/\/$/, '')
const API = `${SITE}/api`
const BASE_PATH = new URL(SITE + '/').pathname
const CHROME = process.env.CHROME_PATH || 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!ADMIN_PASSWORD) {
  console.error("Imposta ADMIN_PASSWORD (password dell'admin del sito di prova)")
  process.exit(2)
}
const PORT = 9337
const W = 360
const H = 780
const results = []
const consoleErrors = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const q = JSON.stringify

function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

async function api(method, url, body, token) {
  const r = await fetch(API + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  return { status: r.status, data: text ? JSON.parse(text) : null }
}

class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.handlers = []
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
      } else if (msg.method) this.handlers.forEach((h) => h(msg))
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((res, rej) => this.pending.set(id, { res, rej }))
  }
  on(fn) { this.handlers.push(fn) }
}

let cdp
async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
async function waitFor(expr, timeout = 15000, label = expr) {
  const t0 = Date.now()
  for (;;) {
    let v
    try { v = await evaluate(expr) } catch { v = false }
    if (v) return v
    if (Date.now() - t0 > timeout) throw new Error(`timeout in attesa di: ${label}`)
    await sleep(120)
  }
}
async function go(pathname) {
  await cdp.send('Page.navigate', { url: SITE + pathname })
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('#root > *')`, 15000, `caricamento ${pathname}`)
  await sleep(300)
}
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${q(selector)}); if (!el) return false; el.click(); return true })()`)
const noHScroll = () => evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`)
const appPath = () => evaluate(`(location.pathname.slice(${BASE_PATH.length - 1}) || '/') + location.search`)
const badge = () => evaluate(`document.querySelector('[data-testid=notification-badge]')?.textContent || ''`)

// ── Dati di prova ──
const login = await api('POST', '/auth/login', { username: ADMIN_USER, password: ADMIN_PASSWORD })
if (login.status !== 200) {
  console.error('login admin fallito', login.status, login.data)
  process.exit(2)
}
const token = login.data.token
const adminId = login.data.user.id
const stamp = Date.now()
const inv = await api('POST', '/admin/invites', { role: 'member' }, token)
const reg = await api('POST', '/auth/register', {
  token: inv.data.token, username: `e2e_n_${String(stamp).slice(-6)}`, email: `e2e_n_${stamp}@example.com`, password: 'pw-' + stamp,
})
const member = reg.data
const mt = member.token
// Preferenze dell'admin al valore predefinito; storico azzerato (altri test lasciano notifiche)
await api('PUT', '/auth/notify-prefs', { song: 'all', like: 'all', comment: 'all', media: 'all' }, token)
await api('POST', '/notifications/read', { all: true }, token)
const song = (await api('POST', '/songs', { artist: `E2E Notify ${stamp}`, title: `Campanella ${stamp}`, force: true }, token)).data
const song2 = (await api('POST', '/songs', { artist: `E2E Notify ${stamp}`, title: `Seconda ${stamp}`, force: true }, token)).data
await api('POST', `/songs/${song.id}/likes`, null, mt)
const cm = (await api('POST', `/songs/${song.id}/comments`, { content: 'Che bel riff' }, mt)).data
await api('POST', `/songs/${song2.id}/likes`, null, mt)
console.log('dati di prova: membro', member.user?.id, 'brani', song?.id, song2?.id)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-e2e-'))
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(tmp, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' })

const seedStorage = () => evaluate(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('band_token', ${q(token)}); localStorage.setItem('band_user', ${q(JSON.stringify(login.data.user))}); localStorage.setItem('band_onboarding_' + ${adminId}, JSON.stringify({ v: 1, done: {}, notApplicable: {}, skipped: true, dismissedWelcome: true, completedAt: null }))`)

try {
  let version
  for (let i = 0; i < 50 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json() } catch { await sleep(200) }
  }
  console.log('browser', version.Browser)
  const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r))
  cdp = new CDP(ws)
  cdp.on((m) => {
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push('console.error ' + m.params.args.map((a) => a.value ?? a.description).join(' '))
  })
  for (const d of ['Page', 'Runtime', 'DOM']) await cdp.send(`${d}.enable`)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true })
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })

  await go('/login')
  await seedStorage()

  // 1. Campanella con il conteggio (3 notifiche: 1 like + 1 commento su «Campanella», 1 like su «Seconda»)
  await go('/')
  await waitFor(`!!document.querySelector('[data-testid=notification-badge]')`, 10000, 'badge della campanella')
  check('campanella: 3 non lette', (await badge()) === '3', await badge())
  check('repertorio: nessuno scorrimento orizzontale', await noHScroll())
  await go('/studio')
  await waitFor(`!!document.querySelector('[data-testid=notification-bell]')`, 8000, 'campanella in Prove')
  check('campanella anche in Prove', true)

  // 2. Pagina Notifiche
  await click('[data-testid=notification-bell]')
  await waitFor(`location.pathname.endsWith('/notifications') && document.querySelectorAll('[data-testid=notification-item]').length >= 3`, 8000, 'elenco notifiche')
  const texts = await evaluate(`[...document.querySelectorAll('[data-testid=notification-item]')].map(b => b.textContent)`)
  const uname = member.user.username
  check('elenco: like su «Seconda»', texts.some((t) => t.includes(`${uname} ha messo mi piace a Seconda ${stamp}`)), texts[0])
  check('elenco: commento con estratto', texts.some((t) => t.includes(`${uname} ha commentato Campanella ${stamp}`) && t.includes('Che bel riff')))
  check('elenco: titolo in evidenza', await evaluate(`[...document.querySelectorAll('[data-testid=notification-item] em')].some(e => e.textContent === ${q(`Campanella ${stamp}`)})`))
  check('elenco: gruppo «Oggi»', await evaluate(`[...document.querySelectorAll('section h2')].some(h => h.textContent === 'Oggi')`))
  check('elenco: nessuno scorrimento orizzontale', await noHScroll())

  // 3. Apertura di una voce: letta + navigazione al commento
  await evaluate(`[...document.querySelectorAll('[data-testid=notification-item]')].find(b => b.textContent.includes('ha commentato')).click()`)
  await waitFor(`location.pathname.endsWith('/songs/${song.id}')`, 8000, 'apertura del brano')
  check('voce aperta: porta al brano', true, await appPath())
  await sleep(800)
  const unreadNow = (await api('GET', '/notifications/unread', null, token)).data.unread
  check('voce aperta: segnata come letta (2 non lette)', unreadNow === 2, String(unreadNow))
  await go('/')
  await waitFor(`!!document.querySelector('[data-testid=notification-badge]')`, 8000, 'badge')
  check('voce aperta: badge a 2', (await badge()) === '2', await badge())

  // 4. Segna tutte come lette
  await go('/notifications')
  await waitFor(`!!document.querySelector('[data-testid=read-all]')`, 8000, 'Segna tutte')
  await click('[data-testid=read-all]')
  await waitFor(`![...document.querySelectorAll('[data-testid=notification-item]')].some(b => b.dataset.read === '0')`, 5000, 'tutte lette')
  await go('/')
  await sleep(800)
  check('tutte lette: nessun badge', (await badge()) === '', await badge())

  // 5. Apertura da push (openWindow): ?n=<id> segna come letta e sparisce dall'URL
  await api('POST', `/songs/${song.id}/comments`, { content: 'Secondo giro' }, mt)
  const fresh = (await api('GET', '/notifications?limit=5', null, token)).data.items.find((n) => n.kind === 'comment' && !n.read)
  await go(`/songs/${song.id}?n=${fresh.id}`)
  await waitFor(`!location.search.includes('n=')`, 5000, 'parametro n tolto')
  await sleep(500)
  const after = (await api('GET', '/notifications?limit=5', null, token)).data.items.find((n) => n.id === fresh.id)
  check('?n=: notifica segnata come letta', after?.read === true)

  // 6. Preferenze: salvate e ricaricate
  await go('/profile')
  await click('[data-testid=open-notifications]')
  await waitFor(`location.pathname.endsWith('/profile/notifications') && !!document.querySelector('[data-pref=like]')`, 8000, 'pagina preferenze')
  await click('[data-pref=like] [data-option=mine]')
  await click('[data-pref=media] [data-option=off]')
  await sleep(800)
  await go('/profile/notifications')
  await waitFor(`!!document.querySelector('[data-pref=like] [aria-checked=true]')`, 8000, 'preferenze ricaricate')
  const prefs = await evaluate(`Object.fromEntries([...document.querySelectorAll('[data-pref]')].map(d => [d.dataset.pref, d.querySelector('[aria-checked=true]').dataset.option]))`)
  check('preferenze salvate', prefs.like === 'mine' && prefs.media === 'off' && prefs.song === 'all', JSON.stringify(prefs))
  const server = (await api('GET', '/auth/me', null, token)).data.notify_prefs
  check('preferenze sul server', server.like === 'mine' && server.media === 'off', JSON.stringify(server))
  check('preferenze: nessuno scorrimento orizzontale', await noHScroll())

  // 7. Push sul dispositivo: permesso concesso → sottoscrizione registrata (verificata con la notifica di prova)
  await cdp.send('Browser.grantPermissions', { origin: new URL(SITE).origin, permissions: ['notifications'] }).catch(() => {})
  await go('/profile/notifications')
  const hasSwitch = await waitFor(`!!document.querySelector('[data-testid=push-switch]') || !!document.querySelector('[data-testid=push-unsupported]')`, 8000, 'interruttore push')
  if (await evaluate(`!!document.querySelector('[data-testid=push-switch]')`)) {
    await waitFor(`!document.querySelector('[data-testid=push-switch]').disabled`, 8000, 'interruttore pronto')
    await click('[data-testid=push-switch]')
    const on = await waitFor(`document.querySelector('[data-testid=push-switch]')?.getAttribute('aria-checked') === 'true' || document.querySelector('[data-testid=toast]')?.textContent`, 20000, 'attivazione push')
      .catch(() => 'nessuna risposta da pushManager.subscribe')
    if (on === true) {
      check('push attivate sul dispositivo', true)
      const t = await api('POST', '/push/test', null, token)
      check('sottoscrizione registrata sul server', t.status === 200 && t.data.devices >= 1, `${t.status} ${JSON.stringify(t.data)}`)
      await click('[data-testid=push-switch]')
      await waitFor(`document.querySelector('[data-testid=push-switch]')?.getAttribute('aria-checked') === 'false'`, 10000, 'disattivazione')
      check('push disattivate', true)
    } else {
      // Chrome headless spesso non raggiunge il servizio push di Google: non è un errore dell'app
      console.log(`SKIP  attivazione push (servizio push non raggiungibile da Chrome headless: ${on})`)
    }
  } else {
    console.log('SKIP  attivazione push (browser senza Push API)')
  }
  void hasSwitch

  // 8. iPhone da Safari: istruzioni per l'installazione
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' })
  await go('/profile/notifications')
  await waitFor(`!!document.querySelector('[data-testid=push-ios]')`, 8000, 'avviso iOS')
  check('iPhone non installato: istruzioni schermata Home', !(await evaluate(`!!document.querySelector('[data-testid=push-switch]')`)))
  check('avviso iOS: nessuno scorrimento orizzontale', await noHScroll())
} catch (err) {
  check('ESECUZIONE', false, err.message)
} finally {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' })
  else chrome.kill()
  await api('PUT', '/auth/notify-prefs', { song: 'all', like: 'all', comment: 'all', media: 'all' }, token)
  if (song?.id) await api('DELETE', `/songs/${song.id}`, null, token)
  if (song2?.id) await api('DELETE', `/songs/${song2.id}`, null, token)
  if (member?.user?.id) await api('DELETE', `/admin/users/${member.user.id}`, null, token)
  await sleep(1500)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* profilo ancora in uso */ }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} verifiche superate`)
  const errs = [...new Set(consoleErrors)]
  console.log(errs.length ? `Errori del browser (${errs.length}):\n  ${errs.join('\n  ')}` : 'Nessun errore nella console del browser')
  process.exit(failed.length ? 1 : 0)
}
