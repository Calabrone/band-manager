// Verifica end-to-end dei link condivisi (spec .kiro/specs/share-links/): Chrome headless a 360×780, via CDP, Node >= 22.
//
// Contro un sito locale (Docker, deploy/local) o l'ambiente di prova; NON lanciarlo sul sito di produzione.
//   ADMIN_PASSWORD=... [ADMIN_USER=admin] [E2E_SITE=http://localhost:8080/band] [CHROME_PATH=...]
//     node tests/e2e/share.e2e.mjs
// Crea brano (con commento), brano di prova (con commento) e un contenuto audio, e li elimina alla fine.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SITE = (process.env.E2E_SITE || 'http://localhost:8080/band').replace(/\/$/, '')
const API = `${SITE}/api`
const BASE_PATH = new URL(SITE + '/').pathname // es. /band/
const CHROME = process.env.CHROME_PATH || 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!ADMIN_PASSWORD) {
  console.error("Imposta ADMIN_PASSWORD (password dell'admin del sito di prova)")
  process.exit(2)
}
const PORT = 9335
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
  const isForm = body instanceof FormData
  const r = await fetch(API + url, {
    method,
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  })
  const text = await r.text()
  return { status: r.status, data: text ? JSON.parse(text) : null }
}

function wavBuffer(seconds = 6) {
  const sr = 8000
  const n = sr * seconds
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 330 * (i / sr)) * 16000), 44 + i * 2)
  return buf
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
const selectedTab = () => evaluate(`[...document.querySelectorAll('[role=tab][aria-selected=true]')].map(t => t.textContent.trim()).join('|')`)
// Attende che un elemento abbia (o abbia avuto) l'evidenza share-flash
const flashed = (shareId) => {
  const sel = q(`[data-share-id="${shareId}"]`)
  return waitFor(
    `(() => { const el = document.querySelector(${sel}); return !!el && (el.classList.contains('share-flash') || window.__flashed.includes(${q(shareId)})) })()`,
    8000, `evidenza ${shareId}`)
}

// ── Dati di prova ──
const login = await api('POST', '/auth/login', { username: ADMIN_USER, password: ADMIN_PASSWORD })
if (login.status !== 200) {
  console.error('login admin fallito', login.status, login.data)
  process.exit(2)
}
const token = login.data.token
const stamp = Date.now()
const song = (await api('POST', '/songs', { artist: `E2E Share ${stamp}`, title: `Link ${stamp}`, force: true }, token)).data
const songComment = (await api('POST', `/songs/${song.id}/comments`, { content: 'Commento da condividere' }, token)).data
const proj = (await api('POST', '/studio/projects', { title: `E2E share ${stamp}` }, token)).data
const projComment = (await api('POST', `/studio/projects/${proj.id}/comments`, { content: 'Commento del brano di prova' }, token)).data
const form = new FormData()
form.append('file', new Blob([wavBuffer()], { type: 'audio/wav' }), 'share.wav')
form.append('kind', 'audio')
form.append('title', 'Giro condiviso')
form.append('duration_ms', '6000')
form.append('peaks', JSON.stringify(Array.from({ length: 300 }, (_, i) => 60 + Math.round(120 * Math.abs(Math.sin(i / 9))))))
const take = (await api('POST', `/studio/projects/${proj.id}/takes`, form, token)).data
const marker = (await api('POST', `/studio/takes/${take.id}/markers`, { time_ms: 4000, label: 'Ritornello' }, token)).data
console.log('dati di prova: brano', song?.id, 'commento', songComment?.id, 'progetto', proj?.id, 'contenuto', take?.id, 'marker', marker?.id)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'share-e2e-'))
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(tmp, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' })

const seedStorage = () => evaluate(`localStorage.clear(); sessionStorage.clear(); localStorage.setItem('band_token', ${q(token)}); localStorage.setItem('band_user', ${q(JSON.stringify(login.data.user))}); localStorage.setItem('band_onboarding_' + ${login.data.user.id}, JSON.stringify({ v: 1, done: {}, notApplicable: {}, skipped: true, dismissedWelcome: true, completedAt: null }))`)

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
  // Niente pannello nativo; appunti intercettati (window.__copied), o rifiutati con window.__clipFail;
  // registro delle evidenze (la classe dura 2 s)
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      try { delete Navigator.prototype.share } catch {}
      Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: (t) => window.__clipFail ? Promise.reject(new Error('no')) : (window.__copied = t, Promise.resolve()),
      } })
      window.__flashed = []
      new MutationObserver((ms) => ms.forEach((m) => {
        if (m.target.classList?.contains('share-flash')) window.__flashed.push(m.target.dataset.shareId)
      })).observe(document, { attributes: true, attributeFilter: ['class'], subtree: true })
    `,
  })

  // 1. Link aperto senza login → login → ritorno al commento della cover
  await go('/login')
  await evaluate('localStorage.clear(); sessionStorage.clear()')
  await go(`/songs/${song.id}?focus=comment-${songComment.id}`)
  await waitFor(`location.pathname.endsWith('/login')`, 8000, 'redirect al login')
  const next = await evaluate(`new URLSearchParams(location.search).get('next')`)
  check('senza login: redirect a /login con next', next === `/songs/${song.id}?focus=comment-${songComment.id}`, next)
  await evaluate(`(() => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    set(document.querySelector('input[type=text]'), ${q(ADMIN_USER)})
    set(document.querySelector('input[type=password]'), ${q(ADMIN_PASSWORD)})
  })()`)
  await click('button[type=submit]')
  await waitFor(`location.pathname.endsWith('/songs/${song.id}')`, 10000, 'ritorno alla cover dopo il login')
  check('dopo il login: torna alla cover del link', true)
  await flashed(`comment-${songComment.id}`)
  check('commento della cover evidenziato', true)
  await waitFor(`!location.search.includes('focus')`, 5000, 'focus tolto dall\'URL')
  check('focus tolto dall\'URL', true)
  check('cover: nessuno scorrimento orizzontale', await noHScroll())
  // onboarding chiuso per le pagine successive
  await seedStorage()

  // 2. Next esterno ignorato
  await evaluate('localStorage.clear()')
  await go(`/login?next=${encodeURIComponent('//evil.example.com')}`)
  await evaluate(`(() => {
    const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
    set(document.querySelector('input[type=text]'), ${q(ADMIN_USER)})
    set(document.querySelector('input[type=password]'), ${q(ADMIN_PASSWORD)})
  })()`)
  await click('button[type=submit]')
  await waitFor(`!location.pathname.endsWith('/login')`, 10000, 'uscita dal login')
  const host = await evaluate('location.host')
  check('next esterno ignorato (resta nel sito)', host === new URL(SITE).host && (await appPath()) === '/', `${host} ${await appPath()}`)
  await seedStorage()

  // 3. Contenuto con loop A-B
  await go(`/studio/${proj.id}/takes/${take.id}?a=1000&b=3000`)
  await waitFor(`document.querySelector('[data-testid=loop-player]')?.dataset.status === 'ready'`, 20000, 'player pronto')
  const loopAttr = await evaluate(`document.querySelector('[data-testid=loop-player]').dataset.loop`)
  check('link con loop: loop A-B attivo 1–3 s', loopAttr === '1000-3000', loopAttr)
  const tLoop = await evaluate(`document.querySelector('[data-testid=player-time]').textContent`)
  check('link con loop: posizione in A', tLoop.startsWith('0:01.0'), tLoop)
  await waitFor(`!location.search.includes('a=')`, 5000, 'parametri a/b tolti')
  check('loop: parametri tolti dall\'URL', true)
  // condivisione del loop dal menu ⋮ → appunti
  await evaluate('window.__copied = null')
  await click('[aria-label="Altre azioni"]')
  await sleep(200)
  await evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(b => b.textContent.includes('loop'))?.click()`)
  await waitFor('window.__copied', 4000, 'link del loop copiato')
  const loopUrl = await evaluate('window.__copied')
  check('condividi loop: URL copiato', loopUrl === `${SITE}/studio/${proj.id}/takes/${take.id}?a=1000&b=3000`, loopUrl)
  const toast1 = await waitFor(`document.querySelector('[data-testid=toast]')?.textContent`, 3000, 'toast')
  check('condividi: toast «Link copiato»', toast1 === 'Link copiato', toast1)
  check('player: nessuno scorrimento orizzontale', await noHScroll())

  // 4. Contenuto da un istante
  await go(`/studio/${proj.id}/takes/${take.id}?t=2000`)
  await waitFor(`document.querySelector('[data-testid=loop-player]')?.dataset.status === 'ready'`, 20000, 'player pronto')
  await sleep(300)
  const tAt = await evaluate(`document.querySelector('[data-testid=player-time]').textContent`)
  check('link con istante: posizione 0:02', tAt.startsWith('0:02.0'), tAt)

  // 5. Marker del contenuto
  await go(`/studio/${proj.id}/takes/${take.id}?focus=marker-${marker.id}`)
  await waitFor(`document.querySelector('[data-testid=loop-player]')?.dataset.status === 'ready'`, 20000, 'player pronto')
  await flashed(`marker-${marker.id}`)
  await sleep(300)
  const tMk = await evaluate(`document.querySelector('[data-testid=player-time]').textContent`)
  check('link a un marker: evidenziato e player al suo istante', tMk.startsWith('0:04.0'), tMk)

  // 6. Scheda del brano di prova
  await go(`/studio/${proj.id}?tab=commenti`)
  await waitFor(`!!document.querySelector('[role=tab][aria-selected=true]')`, 8000, 'schede')
  check('link a una scheda del brano di prova', (await selectedTab()).startsWith('Commenti'), await selectedTab())
  await go(`/studio/${proj.id}?focus=comment-${projComment.id}`)
  await flashed(`comment-${projComment.id}`)
  check('commento del brano di prova: scheda Commenti ed evidenza', (await selectedTab()).startsWith('Commenti'))
  check('brano di prova: nessuno scorrimento orizzontale', await noHScroll())

  // 7. Sezione del repertorio e della Sala prove
  await go('/?cat=in_scaletta')
  await waitFor(`!!document.querySelector('[role=tab][aria-selected=true]')`, 8000, 'schede repertorio')
  check('link alla sezione del repertorio', (await selectedTab()).startsWith('In Scaletta'), await selectedTab())
  await evaluate('window.__copied = null')
  await click('[aria-label="Condividi questa sezione"]')
  await waitFor('window.__copied', 4000, 'link sezione copiato')
  check('condividi sezione: URL', (await evaluate('window.__copied')) === `${SITE}/?cat=in_scaletta`, await evaluate('window.__copied'))
  check('repertorio: nessuno scorrimento orizzontale', await noHScroll())
  await go('/studio?seg=archivio')
  await waitFor(`!!document.querySelector('[aria-label="Condividi questa sezione"]')`, 8000, 'Prove')
  await evaluate('window.__copied = null')
  await click('[aria-label="Condividi questa sezione"]')
  await waitFor('window.__copied', 4000, 'link segmento copiato')
  check('link alla sezione della Sala prove', (await evaluate('window.__copied')) === `${SITE}/studio?seg=archivio`, await evaluate('window.__copied'))

  // 8. Elemento non più disponibile
  await go(`/songs/${song.id}?focus=comment-999999`)
  const toast2 = await waitFor(`document.querySelector('[data-testid=toast]')?.textContent`, 8000, 'toast elemento mancante')
  check('elemento eliminato: avviso', toast2 === 'Elemento non più disponibile', toast2)

  // 9. Ultimo ripiego: appunti non disponibili → dialog con il link
  await go(`/songs/${song.id}`)
  await evaluate('window.__clipFail = true')
  await click('[aria-label="Condividi la cover"]')
  const fallback = await waitFor(`document.querySelector('[data-testid=share-fallback-url]')?.value`, 4000, 'dialog con il link')
  check('senza appunti: dialog con il link', fallback === `${SITE}/songs/${song.id}`, fallback)
} catch (err) {
  check('ESECUZIONE', false, err.message)
} finally {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' })
  else chrome.kill()
  if (song?.id) await api('DELETE', `/songs/${song.id}`, null, token)
  if (proj?.id) await api('DELETE', `/studio/projects/${proj.id}`, null, token)
  await sleep(1500)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* profilo ancora in uso */ }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} verifiche superate`)
  const errs = [...new Set(consoleErrors)]
  console.log(errs.length ? `Errori del browser (${errs.length}):\n  ${errs.join('\n  ')}` : 'Nessun errore nella console del browser')
  process.exit(failed.length ? 1 : 0)
}
