// Verifica end-to-end dei temi: Chrome headless a 360×780 (touch), pilotato via CDP, nessuna dipendenza (Node >= 22).
//
// Contro un sito locale (Docker, deploy/local) o l'ambiente di prova; NON lanciarlo sul sito di produzione.
//   ADMIN_PASSWORD=... [ADMIN_USER=admin] [E2E_SITE=http://localhost:8080/band] [CHROME_PATH=...] [E2E_SHOTS=cartella]
//     node tests/e2e/theme.e2e.mjs
// Con E2E_SHOTS salva le schermate delle pagine principali in tre temi (verifica visiva).
// Crea brano, brano di prova e un membro propri e li elimina alla fine; riporta il tema dell'admin a com'era.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SITE = (process.env.E2E_SITE || 'http://localhost:8080/band').replace(/\/$/, '')
const API = `${SITE}/api`
const CHROME = process.env.CHROME_PATH || 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const SHOTS = process.env.E2E_SHOTS
if (!ADMIN_PASSWORD) {
  console.error("Imposta ADMIN_PASSWORD (password dell'admin del sito di prova)")
  process.exit(2)
}
const PORT = 9334
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

function wavBuffer(seconds = 3) {
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
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
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
  await sleep(400)
}
const click = (selector) => evaluate(`(() => { const el = document.querySelector(${q(selector)}); if (!el) return false; el.click(); return true })()`)

// Luminanza relativa di un colore CSS "rgb(r, g, b)"
const LUM = `(c) => { const [r, g, b] = c.match(/[\\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }`
const bgLum = (selector) => evaluate(`(${LUM})(getComputedStyle(document.querySelector(${q(selector)})).backgroundColor)`)
const noHScroll = () => evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`)

async function screenshot(name) {
  if (!SHOTS) return
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'))
}

// ── Dati di prova ──
const login = await api('POST', '/auth/login', { username: ADMIN_USER, password: ADMIN_PASSWORD })
if (login.status !== 200) {
  console.error('login admin fallito', login.status, login.data)
  process.exit(2)
}
const token = login.data.token
const originalTheme = login.data.user.theme ?? null
await api('PUT', '/auth/theme', { theme: null }, token)
const stamp = Date.now()
const song = (await api('POST', '/songs', { artist: `E2E Tema ${stamp}`, title: `Prova colori ${stamp}`, force: true }, token)).data
const proj = (await api('POST', '/studio/projects', { title: `E2E tema ${stamp}`, bpm: 96 }, token)).data
const form = new FormData()
form.append('file', new Blob([wavBuffer()], { type: 'audio/wav' }), 'tema.wav')
form.append('kind', 'audio')
form.append('title', 'Giro di prova')
form.append('duration_ms', '3000')
form.append('peaks', JSON.stringify(Array.from({ length: 300 }, (_, i) => 60 + Math.round(120 * Math.abs(Math.sin(i / 9))))))
const take = (await api('POST', `/studio/projects/${proj.id}/takes`, form, token)).data
// Un secondo utente, senza tema, per lo stesso dispositivo
const inv = (await api('POST', '/admin/invites', { role: 'member' }, token)).data
const memberName = `tema${String(stamp).slice(-8)}`
const reg = await api('POST', '/auth/register', { token: inv.token, username: memberName, email: `${memberName}@example.com`, password: 'provatema1' })
const member = reg.data
console.log('dati di prova: brano', song?.id, 'progetto', proj?.id, 'contenuto', take?.id, 'membro', member?.user?.id)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-e2e-'))
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(tmp, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' })

const PAGES = () => [
  ['repertorio', '/'],
  ['brano', `/songs/${song.id}`],
  ['testo', `/songs/${song.id}/lyrics`],
  ['prove', '/studio'],
  ['progetto', `/studio/${proj.id}`],
  ['player', `/studio/${proj.id}/takes/${take.id}`],
  ['registra', `/studio/${proj.id}/record`],
  ['profilo', '/profile'],
  ['aspetto', '/profile/appearance'],
  ['admin', '/admin'],
]

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
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  // Modo del tema già applicato quando il DOM è pronto (prima di React): verifica dell'avvio senza lampi
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `document.addEventListener('DOMContentLoaded', () => { window.__modeAtDCL = document.documentElement.dataset.mode; window.__bgAtDCL = document.documentElement.style.getPropertyValue('--gray-950') })`,
  })
  await go('/login')
  await evaluate(`localStorage.clear(); localStorage.setItem('band_token', ${q(token)}); localStorage.setItem('band_user', ${q(JSON.stringify({ ...login.data.user, theme: null }))}); localStorage.setItem('band_onboarding_' + ${login.data.user.id}, JSON.stringify({ v: 1, done: {}, notApplicable: {}, skipped: true, dismissedWelcome: true, completedAt: null }))`)

  // T1 predefinito = Sala prove
  await go('/')
  check('predefinito: Sala prove scuro', (await evaluate(`document.documentElement.dataset.theme`)) === 'sala' && (await bgLum('body')) < 0.02)
  check('predefinito: sfondo identico a prima (#030712)', (await evaluate(`getComputedStyle(document.body).backgroundColor`)) === 'rgb(3, 7, 18)')
  if (SHOTS) for (const [name, p] of PAGES()) { await go(p); await screenshot(`sala-${name}`) }

  // T2 pagina Aspetto da Profilo
  await go('/profile')
  check('profilo: voce Aspetto con il nome del tema', (await evaluate(`document.querySelector('[data-testid=open-appearance]')?.innerText || ''`)).includes('Sala prove'))
  await click('[data-testid=open-appearance]')
  await waitFor(`location.pathname.endsWith('/profile/appearance')`, 5000, 'apertura Aspetto')
  const tiles = await evaluate(`[...document.querySelectorAll('[data-testid=preset-gallery] [role=radio]')].map(e => e.dataset.preset)`)
  check('aspetto: 6 temi + Automatico', tiles.join(',') === 'sala,palco,valvole,mezzanotte,spartito,giorno,auto', tiles.join(','))
  const tileLum = await evaluate(`(${LUM})(getComputedStyle(document.querySelector('[data-preset=spartito] > div')).backgroundColor)`)
  check('aspetto: la miniatura di Spartito è chiara anche dentro un tema scuro', tileLum > 0.7, tileLum.toFixed(2))
  check('aspetto: nessuno scorrimento orizzontale a 360 px', await noHScroll())

  // T3 scelta di un tema chiaro
  await click('[data-preset=spartito]')
  await sleep(200)
  check('tema chiaro: <html> in modo chiaro', (await evaluate(`document.documentElement.dataset.mode`)) === 'light')
  check('tema chiaro: sfondo della pagina chiaro', (await bgLum('body')) > 0.8)
  const textC = await evaluate(`(() => { const L = ${LUM}; const a = L(getComputedStyle(document.querySelector('h1')).color); const b = L(getComputedStyle(document.body).backgroundColor); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) })()`)
  check('tema chiaro: titolo leggibile (contrasto ≥ 7)', textC >= 7, textC.toFixed(1))
  check('tema chiaro: meta theme-color aggiornato', (await evaluate(`document.querySelector('meta[name=theme-color]').content`)) === '#f2f3f0')
  await waitFor(`!!document.querySelector('[data-testid=theme-saved]')`, 5000, 'salvataggio automatico')
  check('salvataggio: tema salvato sul server', (await api('GET', '/auth/me', null, token)).data.theme?.preset === 'spartito')

  // T4 tastiera: frecce nella galleria
  await evaluate(`document.querySelector('[data-preset=spartito]').focus()`)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await sleep(200)
  check('tastiera: freccia destra seleziona il tema successivo', (await evaluate(`document.documentElement.dataset.theme`)) === 'giorno')
  check('tastiera: il focus segue la selezione', await evaluate(`document.activeElement?.dataset.preset === 'giorno'`))
  await click('[data-preset=spartito]')

  // T5 barra in basso e forma d'onda nel tema chiaro
  await go('/')
  check('tema chiaro: barra in basso chiara', (await bgLum('nav')) > 0.8)
  await go(`/studio/${proj.id}/takes/${take.id}`)
  await waitFor(`(() => { const c = document.querySelector('canvas'); if (!c) return false; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 200) return true; return false })()`, 15000, 'forma d\'onda disegnata')
  const px = await evaluate(`(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(2, 2, 1, 1).data; return [d[0], d[1], d[2]] })()`)
  check('player: lo sfondo della forma d\'onda segue il tema chiaro', px.every((v) => v > 220), px.join(','))

  // T6 testo «Molto grande»: nessuno scorrimento orizzontale
  await go('/profile/appearance')
  await click('[data-testid=scale-group] [data-value="125"]')
  await sleep(200)
  check('dimensione: la radice scala al 125%', (await evaluate(`getComputedStyle(document.documentElement).fontSize`)) === '20px')
  const overflow = []
  for (const [name, p] of PAGES()) {
    await go(p)
    if (!(await noHScroll())) overflow.push(name)
  }
  check('dimensione 125%: nessuna pagina scorre in orizzontale a 360 px', overflow.length === 0, overflow.join(', '))
  if (SHOTS) for (const [name, p] of PAGES()) { await go(p); await screenshot(`spartito-xl-${name}`) }
  await go('/profile/appearance')
  await click('[data-testid=scale-group] [data-value="100"]')
  await sleep(1200)

  // T7 ricarica: tema applicato prima di React
  await go('/')
  check('ricarica: modo chiaro già applicato al DOMContentLoaded', (await evaluate(`window.__modeAtDCL`)) === 'light')

  // T8 nuovo dispositivo: nessuna cache, utente senza tema in memoria → tema dal server
  await evaluate(`localStorage.removeItem('band_theme'); localStorage.removeItem('band_theme_css'); localStorage.setItem('band_user', ${q(JSON.stringify({ ...login.data.user, theme: null }))})`)
  await go('/')
  await waitFor(`document.documentElement.dataset.theme === 'spartito'`, 8000, 'tema dal server')
  check('nuovo dispositivo: il tema arriva dal profilo sul server', true)

  // T9 personalizzazione: accento e tema scuro, persistenza
  await go('/profile/appearance')
  await click('[data-preset=palco]')
  await click('[data-testid=accent-group] [aria-label="Verde acqua"]')
  await click('[data-testid=font-group] [data-value="atkinson"]')
  await waitFor(`!!document.querySelector('[data-testid=theme-saved]')`, 5000, 'salvataggio')
  await sleep(300)
  const saved = (await api('GET', '/auth/me', null, token)).data.theme
  check('personalizzazione: preset, accento e carattere salvati', saved.preset === 'palco' && saved.accent === '#14b8a6' && saved.font === 'atkinson', JSON.stringify(saved))
  check('personalizzazione: il carattere scelto è applicato', (await evaluate(`getComputedStyle(document.body).fontFamily`)).includes('Atkinson'))
  if (SHOTS) for (const [name, p] of PAGES()) { await go(p); await screenshot(`palco-${name}`) }

  // T10 Automatico segue il sistema
  await go('/profile/appearance')
  await click('[data-preset=auto]')
  await sleep(200)
  check('automatico: sistema scuro → Sala prove', (await evaluate(`document.documentElement.dataset.theme`)) === 'sala')
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
  await sleep(300)
  check('automatico: sistema chiaro → Giorno, senza ricaricare', (await evaluate(`document.documentElement.dataset.theme`)) === 'giorno')
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
  await sleep(1200)

  // T11 altro utente sullo stesso dispositivo, senza tema → predefinito
  if (member?.token) {
    await evaluate(`localStorage.setItem('band_token', ${q(member.token)}); localStorage.setItem('band_user', ${q(JSON.stringify(member.user))}); localStorage.setItem('band_onboarding_' + ${member.user.id}, JSON.stringify({ v: 1, done: {}, notApplicable: {}, skipped: true, dismissedWelcome: true, completedAt: null }))`)
    await go('/')
    await waitFor(`document.documentElement.dataset.theme === 'sala'`, 8000, 'tema predefinito per il secondo utente')
    check('altro utente senza tema: parte da Sala prove', true)
  } else {
    check('altro utente senza tema: registrazione del membro di prova', false, JSON.stringify(reg.data))
  }
} catch (err) {
  check('ESECUZIONE', false, err.message)
} finally {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' })
  else chrome.kill()
  await api('PUT', '/auth/theme', { theme: originalTheme }, token)
  if (song?.id) await api('DELETE', `/songs/${song.id}`, null, token)
  if (proj?.id) await api('DELETE', `/studio/projects/${proj.id}`, null, token)
  if (member?.user?.id) await api('DELETE', `/admin/users/${member.user.id}`, null, token)
  await sleep(1500)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* profilo ancora in uso */ }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} verifiche superate`)
  const errs = [...new Set(consoleErrors)]
  console.log(errs.length ? `Errori del browser (${errs.length}):\n  ${errs.join('\n  ')}` : 'Nessun errore nella console del browser')
  if (SHOTS) console.log(`Schermate in ${SHOTS}`)
  process.exit(failed.length ? 1 : 0)
}
