// Verifica end-to-end della Sala prove: Chrome headless con microfono e fotocamera finti, pilotato via CDP
// (nessuna dipendenza: serve Node >= 22 per il WebSocket integrato, e Chrome installato).
//
// Contro un sito locale (Docker, deploy/local) o l'ambiente di prova; NON lanciarlo sul sito di produzione.
//   ADMIN_PASSWORD=... [ADMIN_USER=admin] [E2E_SITE=http://localhost:8081/band] [CHROME_PATH=...]
//     node tests/e2e/studio.e2e.mjs
// Crea un proprio brano di prova e lo elimina alla fine. Esce con codice 1 se una verifica fallisce.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SITE = (process.env.E2E_SITE || 'http://localhost:8081/band').replace(/\/$/, '')
const API = `${SITE}/api`
const CHROME = process.env.CHROME_PATH || 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
const ADMIN_USER = process.env.ADMIN_USER || 'admin'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!ADMIN_PASSWORD) {
  console.error("Imposta ADMIN_PASSWORD (password dell'admin del sito di prova)")
  process.exit(2)
}
const PORT = 9333
const results = []
const consoleErrors = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(name, ok, detail = '') {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

// ── Audio di prova: 4 s, 0,5 s di silenzio, poi un tono con andamento crescente ──
function makeWav(file, seconds = 4) {
  const sr = 22050
  const n = sr * seconds
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const amp = t < 0.5 ? 0 : 0.2 + 0.6 * ((t - 0.5) / (seconds - 0.5))
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * t) * amp * 32000), 44 + i * 2)
  }
  fs.writeFileSync(file, buf)
}

// ── API ──
async function api(method, url, body, token) {
  const r = await fetch(API + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  return { status: r.status, data: text ? JSON.parse(text) : null }
}

// ── CDP ──
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
const q = JSON.stringify
const clickText = (text, tag = 'button') => evaluate(`(() => { const all = [...document.querySelectorAll(${q(tag)})].filter(e => !e.disabled); const el = all.find(e => e.textContent.trim() === ${q(text)}) || all.find(e => e.textContent.trim().includes(${q(text)})); if (!el) return false; el.click(); return true })()`)
const clickTitle = (title) => evaluate(`(() => { const el = [...document.querySelectorAll('button')].find(e => e.title === ${q(title)} && !e.disabled); if (!el) return false; el.click(); return true })()`)
const hasText = (text) => evaluate(`document.body.innerText.includes(${q(text)})`)
async function go(pathname) {
  await cdp.send('Page.navigate', { url: SITE + pathname })
  await sleep(500)
}
async function typeInto(selector, value) {
  await evaluate(`(() => { const el = document.querySelector(${q(selector)}); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${q(value)}); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
}
async function setFile(file) {
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' })
  await cdp.send('DOM.setFileInputFiles', { files: [file], nodeId })
}
const clock = () => evaluate(`(() => { const el = [...document.querySelectorAll('span')].find(e => /^\\d+:\\d\\d\\.\\d \\/ \\d+:\\d\\d\\.\\d$/.test(e.textContent.trim())); if (!el) return null; const [a, b] = el.textContent.split('/').map(s => { const [m, r] = s.trim().split(':'); return Number(m) * 60 + Number(r) }); return { pos: a, dur: b } })()`)
const lastTakeId = () => evaluate(`Number(location.pathname.split('/takes/')[1])`)

// ── Esecuzione ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-e2e-'))
const wav = path.join(tmp, 'riff.wav')
makeWav(wav)

const login = await api('POST', '/auth/login', { username: ADMIN_USER, password: ADMIN_PASSWORD })
const token = login.data.token
const proj = await api('POST', '/studio/projects', { title: `E2E ${Date.now()}`, bpm: 100 }, token)
const pid = proj.data.id
console.log('progetto di prova', pid)

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(tmp, 'profile')}`,
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  '--no-first-run', '--no-default-browser-check', '--window-size=430,1000', 'about:blank',
], { stdio: 'ignore' })

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
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') consoleErrors.push('log ' + m.params.entry.text + ' ' + (m.params.entry.url || ''))
  })
  for (const d of ['Page', 'Runtime', 'DOM', 'Log']) await cdp.send(`${d}.enable`)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('band_token', ${q(token)}); localStorage.setItem('band_user', ${q(JSON.stringify(login.data.user))});
      window.__osc = 0; const co = BaseAudioContext.prototype.createOscillator; BaseAudioContext.prototype.createOscillator = function () { window.__osc++; return co.call(this) };`,
  })

  // S1 elenco
  await go('/studio')
  await waitFor(`document.body.innerText.includes(${q(proj.data.title)})`, 10000, 'progetto in elenco')
  check('elenco: il brano di prova compare', true)
  check('barra: voce Prove', await hasText('Prove'))

  // S2 upload da file
  await go(`/studio/${pid}`)
  await waitFor(`document.body.innerText.includes('Carica file')`)
  await clickText('Carica file')
  await waitFor(`!!document.querySelector('input[type=file]')`)
  await setFile(wav)
  await waitFor(`document.body.innerText.includes('Audio ·')`, 10000, 'analisi del file')
  check('upload: file analizzato (tipo e durata)', true, await evaluate(`[...document.querySelectorAll('p')].find(p => p.textContent.startsWith('Audio'))?.textContent`))
  check('upload: titolo precompilato dal nome file', (await evaluate(`document.querySelector('input[maxlength="150"]')?.value`)) === 'riff')
  await clickText('Carica')
  await waitFor(`location.pathname.includes('/takes/')`, 20000, 'redirect alla pagina del contenuto')
  const tid = await lastTakeId()
  let take = (await api('GET', `/studio/takes/${tid}`, null, token)).data
  check('upload: contenuto creato con forma d\'onda e durata', take.has_peaks && Math.abs(take.duration_ms - 4000) < 300, `durata ${take.duration_ms}, picchi ${take.peaks?.length}`)

  // S3 player
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.title === 'Play' && !b.disabled)`, 15000, 'player pronto')
  check('player: pronto, durata mostrata', Math.abs((await clock()).dur - 4) < 0.4, JSON.stringify(await clock()))
  const painted = await evaluate(`(() => { const c = document.querySelector('canvas'); const g = c.getContext('2d'); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] > 150) n++ } return n })()`)
  check('timeline: forma d\'onda disegnata', painted > 100, `${painted} pixel chiari`)
  check('conteggio/volume/zoom visibili', (await hasText('Conteggio spento')) && (await hasText('×1.0')))

  await clickTitle('Play')
  await sleep(900)
  const playing = await clock()
  check('player: la riproduzione avanza', playing.pos > 0.4, `pos ${playing.pos}`)
  await clickTitle('Pausa')
  const pausedAt = (await clock()).pos
  await sleep(400)
  check('player: pausa ferma la posizione', Math.abs((await clock()).pos - pausedAt) < 0.15)

  // Tocco sulla timeline → salta a ~1,5 s
  const rect = await evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
  const mouse = (type, x, y) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  const seekX = rect.x + rect.w * (1.5 / 4)
  const seekY = rect.y + rect.h * 0.6
  await mouse('mousePressed', seekX, seekY); await mouse('mouseReleased', seekX, seekY)
  await sleep(300)
  const sought = (await clock()).pos
  check('timeline: un tocco sposta la posizione', Math.abs(sought - 1.5) < 0.25, `pos ${sought}`)

  // Loop A-B: A = inizio, B = qui (1,5 s)
  await clickText('B qui')
  await sleep(200)
  await clickTitle('Torna ad A')
  await clickTitle('Play')
  const samples = []
  for (let i = 0; i < 30; i++) { samples.push((await clock()).pos); await sleep(100) }
  const max = Math.max(...samples)
  const wrapped = samples.some((v, i) => i > 0 && v < samples[i - 1] - 0.5)
  check('loop A-B: non supera B e ricomincia da A', max <= 1.75 && wrapped, `max ${max.toFixed(2)} giri ${wrapped}`)
  await clickTitle('Pausa')

  // Marker dal pulsante
  await clickText('Marker qui')
  await waitFor(`!!document.querySelector('input[maxlength="80"]')`)
  await typeInto('input[maxlength="80"]', 'Nota errata')
  await clickText('Aggiungi')
  await waitFor(`document.body.innerText.includes('Nota errata')`, 8000, 'marker in elenco')
  const markers = (await api('GET', `/studio/takes/${tid}/markers`, null, token)).data
  check('marker: creato e visibile', markers.length === 1 && markers[0].label === 'Nota errata', JSON.stringify(markers.map((m) => m.time_ms)))
  check('marker: bandierina sulla timeline', await evaluate(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '⚑' && b.title.includes('Nota errata'))`))

  // Commento che cita il marker
  await clickText('Cita marker')
  await waitFor(`[...document.querySelectorAll('form li button')].some(b => b.textContent.includes('Nota errata'))`)
  await evaluate(`[...document.querySelectorAll('form li button')].find(b => b.textContent.includes('Nota errata')).click()`)
  await sleep(300)
  await typeInto('textarea[placeholder="Scrivi un commento…"]', await evaluate(`document.querySelector('textarea[placeholder="Scrivi un commento…"]').value + 'qui suona Fa#'`))
  await clickText('Invia')
  await waitFor(`!!document.querySelector('[id^="c-"]')`, 8000, 'commento pubblicato')
  const comments = (await api('GET', `/studio/takes/${tid}/comments`, null, token)).data
  check('commento: contiene il token del marker', comments.length === 1 && comments[0].content.includes(`[[m:${markers[0].id}]]`), comments[0]?.content)
  // clic sul link nel commento → salta al marker e parte
  await evaluate(`window.scrollTo(0, 0)`)
  await sleep(200)
  await evaluate(`[...document.querySelectorAll('[id^="c-"] button')].find(b => b.textContent.includes('Nota errata')).click()`)
  await sleep(500)
  const afterJump = await clock()
  check('commento: il link porta il player al marker', Math.abs(afterJump.pos - markers[0].time_ms / 1000) < 0.8, `pos ${afterJump.pos}, marker ${markers[0].time_ms / 1000}`)
  await clickTitle('Pausa')

  // Taglio predefinito
  await clickText('Tutto')
  const setPoint = async (label, frac) => {
    const x = rect.x + rect.w * frac
    await mouse('mousePressed', x, seekY); await mouse('mouseReleased', x, seekY)
    await sleep(250)
    await clickText(label)
    await sleep(150)
  }
  await setPoint('A qui', 0.2)
  await setPoint('B qui', 0.85)
  await clickText('Salva come taglio predefinito')
  await waitFor(`document.body.innerText.includes('Taglio salvato')`, 8000, 'conferma salvataggio taglio')
  take = (await api('GET', `/studio/takes/${tid}`, null, token)).data
  check('taglio: salvato sul server', take.trim_start_ms > 600 && take.trim_end_ms > take.trim_start_ms + 1500, `${take.trim_start_ms}–${take.trim_end_ms}`)
  await go(`/studio/${pid}/takes/${tid}`)
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.title === 'Play' && !b.disabled)`, 15000)
  await sleep(500)
  const reloaded = await evaluate(`[...document.querySelectorAll('span.font-mono')].map(e => e.textContent.trim()).join(' | ')`)
  const c2 = await clock()
  check('taglio: il player riparte dal taglio dell\'autore', Math.abs(c2.pos - take.trim_start_ms / 1000) < 0.3, `pos ${c2.pos}, ${reloaded}`)

  // Zoom, pressione lunga, conteggio
  const zoomLabel = () => evaluate(`[...document.querySelectorAll('span')].find(e => /^×\\d/.test(e.textContent.trim()))?.textContent.trim()`)
  await clickTitle('Ingrandisci')
  await sleep(250)
  check('zoom: il pulsante ingrandisce (×2)', (await zoomLabel()) === '×2.0', await zoomLabel())
  const wr = await evaluate(`(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height * 0.6 } })()`)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: wr.x, y: wr.y, deltaX: 0, deltaY: -250, modifiers: 2 })
  await sleep(300)
  const z2 = Number((await zoomLabel()).replace('×', ''))
  check('zoom: Ctrl+rotella ingrandisce ancora', z2 > 2.5, `×${z2}`)
  for (let i = 0; i < 10; i++) { await clickTitle('Riduci zoom'); await sleep(60) }
  await sleep(250)
  check('zoom: si torna a tutto il contenuto', (await zoomLabel()) === '×1.0', await zoomLabel())
  await mouse('mousePressed', wr.x, wr.y)
  await sleep(750)
  await mouse('mouseReleased', wr.x, wr.y)
  await waitFor(`document.body.innerText.includes('Nuovo marker a')`, 4000, 'dialogo marker da pressione lunga')
  check('timeline: pressione lunga apre il nuovo marker', true)
  await clickText('Annulla')
  await sleep(200)
  await clickText('Conteggio spento')
  check('conteggio: attivabile', await hasText('Conteggio attivo'))
  const before = (await clock()).pos
  await clickTitle('Play')
  await sleep(1100)
  const during = (await clock()).pos
  check('conteggio: durante i click la posizione resta ferma', Math.abs(during - before) < 0.15 && (await hasText('Conteggio…')), `da ${before} a ${during}`)
  await sleep(2700)
  const after = (await clock()).pos
  check('conteggio: poi la riproduzione parte', Math.abs(after - before) > 0.3, `pos ${after}`)
  await clickTitle('Pausa')
  await clickText('Conteggio attivo')

  // S5 registrazione audio
  await go(`/studio/${pid}/record`)
  await waitFor(`document.body.innerText.includes('Attiva il microfono')`)
  await clickText('Attiva il microfono')
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Registra') && !b.disabled && b.className.includes('red'))`, 10000, 'microfono attivo')
  check('registrazione: microfono finto attivato, limite mostrato', await hasText('Dimensione massima'))
  await clickText('Registra')
  await waitFor(`document.body.innerText.includes('Registrazione in corso')`, 8000)
  await sleep(2600)
  await clickText('Ferma')
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Salva')`, 20000, 'revisione')
  check('registrazione: revisione con player', await evaluate(`[...document.querySelectorAll('button')].some(b => b.title === 'Play')`))
  await clickText('Salva')
  await waitFor(`location.pathname.includes('/takes/')`, 25000, 'redirect dopo il salvataggio')
  const recId = await lastTakeId()
  const rec = (await api('GET', `/studio/takes/${recId}`, null, token)).data
  check('registrazione: salvata (audio, nell\'app, durata, picchi)', rec.kind === 'audio' && rec.recorded_in_app && rec.duration_ms > 2000 && rec.has_peaks, `${rec.mime} ${rec.duration_ms} ms ${rec.size} B`)
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.title === 'Play' && !b.disabled)`, 15000)
  check('registrazione: il file salvato si riproduce', true)

  // S6 sovraincisione sul contenuto caricato (con il taglio come loop)
  await go(`/studio/${pid}/takes/${tid}`)
  await waitFor(`document.body.innerText.includes('Registra sopra')`)
  await clickText('Registra sopra')
  await waitFor(`document.body.innerText.includes('Attiva il microfono')`)
  await clickText('Attiva il microfono')
  await waitFor(`document.querySelector('canvas') && [...document.querySelectorAll('button')].some(b => b.textContent.includes('Registra') && !b.disabled && b.className.includes('red'))`, 15000, 'base caricata e microfono attivo')
  check('sovraincisione: base caricata con loop sul taglio', await evaluate(`document.body.innerText.includes('in ripetizione da')`))
  await clickText('Registra')
  await waitFor(`document.body.innerText.includes('Registrazione in corso')`, 8000)
  await sleep(3200)
  await clickText('Ferma')
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Salva')`, 25000, 'revisione sovraincisione')
  check('sovraincisione: pannello di allineamento in revisione', (await hasText('Allineamento')) && (await hasText('Base: «')))
  await clickText('+20')
  await sleep(150)
  await clickText('+20')
  await clickText('Salva')
  await waitFor(`location.pathname.includes('/takes/')`, 25000)
  const overId = await lastTakeId()
  const over = (await api('GET', `/studio/takes/${overId}`, null, token)).data
  check('sovraincisione: base, sincronismo e loop salvati', over.base_take_id === tid && over.sync_ms >= 0 && over.base_loop_end_ms > over.base_loop_start_ms,
    `sync ${over.sync_ms}, offset ${over.offset_ms}, loop ${over.base_loop_start_ms}-${over.base_loop_end_ms}`)
  check('sovraincisione: offset regolato (+40) salvato', over.offset_ms >= 40, `offset ${over.offset_ms}`)
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.title === 'Play' && !b.disabled)`, 20000, 'player della sovraincisione')
  check('sovraincisione: il player mostra la base e il mixer', (await hasText('Base: «')) && (await hasText('Allineamento')))
  await clickTitle('Play')
  await sleep(1200)
  check('sovraincisione: riproduzione con due motori avanza', (await clock()).pos > 0.5)
  await clickTitle('Pausa')

  // S7 video
  await go(`/studio/${pid}/record`)
  await waitFor(`document.body.innerText.includes('Video + audio')`)
  await clickText('Video + audio')
  await clickText('Attiva fotocamera e microfono')
  await waitFor(`document.querySelector('video') && [...document.querySelectorAll('button')].some(b => b.textContent.includes('Registra') && !b.disabled && b.className.includes('red'))`, 15000, 'fotocamera attiva')
  await clickText('Registra')
  await waitFor(`document.body.innerText.includes('Registrazione in corso')`, 8000)
  await sleep(2600)
  await clickText('Ferma')
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Salva')`, 25000, 'revisione video')
  await clickText('Salva')
  await waitFor(`location.pathname.includes('/takes/')`, 30000)
  const vidId = await lastTakeId()
  const vid = (await api('GET', `/studio/takes/${vidId}`, null, token)).data
  check('video: registrato e salvato', vid.kind === 'video' && vid.recorded_in_app && vid.size > 1000, `${vid.mime} ${vid.duration_ms} ms ${vid.size} B`)
  await waitFor(`(document.querySelector('video')?.readyState ?? 0) >= 1`, 15000, 'metadati del video')
  const vinfo = await evaluate(`(() => { const v = document.querySelector('video'); return { d: v.duration, w: v.videoWidth, err: v.error && v.error.code } })()`)
  check('video: il file salvato si carica nel player', vinfo.w > 0 && !vinfo.err, JSON.stringify(vinfo))
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.title === 'Play' && !b.disabled)`, 15000)
  await clickTitle('Play')
  await sleep(1000)
  check('video: la riproduzione avanza', (await clock()).pos > 0.3, JSON.stringify(await clock()))

  // Elenco del progetto
  await go(`/studio/${pid}`)
  await waitFor(`document.body.innerText.includes('Contenuti (4)')`, 10000, 'quattro contenuti')
  check('progetto: quattro contenuti, sovraincisione etichettata', (await hasText('sopra a «riff»')) || (await hasText('sopra a')))

  // S8 controllo BPM: tasti +/−, slider, valore salvato
  const press = async (selector) => {
    const r = await evaluate(`(() => { const b = document.querySelector(${q(selector)}); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 })
    await sleep(120)
  }
  const bpmField = () => evaluate(`document.querySelector('input[aria-label="BPM"]')?.value`)
  await go(`/studio/${pid}/edit`)
  await waitFor(`!!document.querySelector('input[aria-label="BPM"]')`, 10000, 'controllo BPM')
  check('BPM: parte da quello del brano', (await bpmField()) === '100', await bpmField())
  await press('button[aria-label="Aumenta BPM"]')
  await press('button[aria-label="Aumenta BPM"]')
  await press('button[aria-label="Diminuisci BPM"]')
  check('BPM: i tasti + e − cambiano di uno', (await bpmField()) === '101', await bpmField())
  await evaluate(`(() => { const el = document.querySelector('input[type=range]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '140'); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(150)
  check('BPM: lo slider imposta il valore', (await bpmField()) === '140', await bpmField())
  await evaluate(`document.querySelector('input[aria-label="BPM"]').focus()`)
  await typeInto('input[aria-label="BPM"]', '999')
  await evaluate(`document.querySelector('input[aria-label="BPM"]').blur()`)
  await sleep(150)
  check('BPM: il campo riporta ai limiti (300)', (await bpmField()) === '300', await bpmField())
  await evaluate(`document.querySelector('input[aria-label="BPM"]').focus()`)
  await typeInto('input[aria-label="BPM"]', '101')
  await evaluate(`document.querySelector('input[aria-label="BPM"]').blur()`)
  await sleep(150)
  await clickText('Salva')
  await waitFor(`location.pathname.endsWith(${q('/studio/' + pid)})`, 10000, 'ritorno al brano dopo il salvataggio')
  check('BPM: salvato nel brano di prova', (await api('GET', `/studio/projects/${pid}`, null, token)).data.bpm === 101)

  // S9 registrazione con conteggio e metronomo
  await go(`/studio/${pid}/record`)
  await waitFor(`document.body.innerText.includes('Attiva il microfono')`)
  await clickText('Attiva il microfono')
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Registra') && !b.disabled && b.className.includes('red'))`, 10000, 'microfono attivo')
  check('tempo: pannello visibile anche senza base, BPM del brano', (await hasText('Tempo')) && (await bpmField()) === '101', await bpmField())
  check('tempo: nessun avviso cuffie finché conteggio e metronomo sono spenti', !(await hasText('senza cuffie il microfono registra anche il click')))
  const tick = (label) => evaluate(`(() => { const l = [...document.querySelectorAll('label')].find(e => e.textContent.includes(${q(label)})); const i = l?.querySelector('input'); if (!i) return false; if (!i.checked) i.click(); return i.checked })()`)
  await tick('Conteggio prima di partire')
  await tick('Metronomo durante la registrazione')
  await sleep(200)
  check('tempo: avviso cuffie con conteggio/metronomo attivi', await hasText('senza cuffie il microfono registra anche il click'))
  await press('button[aria-label="Aumenta BPM"]')
  await sleep(1300)
  const savedBpm = (await api('GET', `/studio/projects/${pid}`, null, token)).data.bpm
  check('tempo: il BPM cambiato in registrazione si salva nel brano (creatore/admin)', savedBpm === 102, `bpm ${savedBpm}`)
  await evaluate(`window.__osc = 0`)
  await clickText('Registra')
  await waitFor(`document.body.innerText.includes('Registrazione in corso')`, 8000)
  check('metronomo: indicatore con i BPM in registrazione', await hasText('Metronomo · 102 BPM'))
  await sleep(5200)
  const osc = await evaluate(`window.__osc`)
  check('metronomo: click di conteggio (4) e di metronomo programmati', osc >= 8, `${osc} click`)
  await clickText('Ferma')
  await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Salva')`, 20000, 'revisione con metronomo')
  const oscAfterStop = await evaluate(`window.__osc`)
  await sleep(800)
  check('metronomo: si ferma con la registrazione', (await evaluate(`window.__osc`)) - oscAfterStop <= 1, `+${(await evaluate(`window.__osc`)) - oscAfterStop}`)
  await clickText('Salva')
  await waitFor(`location.pathname.includes('/takes/')`, 25000)
  const metroTake = (await api('GET', `/studio/takes/${await lastTakeId()}`, null, token)).data
  const expectedMs = (0.25 + (4 * 60) / 102) * 1000
  check('conteggio: il taglio iniziale parte dalla fine del conteggio', metroTake.trim_start_ms !== null && Math.abs(metroTake.trim_start_ms - expectedMs) < 500 && metroTake.trim_end_ms > metroTake.trim_start_ms,
    `taglio ${metroTake.trim_start_ms}–${metroTake.trim_end_ms}, atteso ~${Math.round(expectedMs)}`)

  // S10 testo nel brano di prova
  await go(`/studio/${pid}`)
  await waitFor(`document.body.innerText.includes('Aggiungi testo')`, 10000, 'sezione testo')
  check('testo: sezioni Testo, Video prove e Commenti nel brano di prova', (await hasText('Video prove')) && (await hasText('Commenti')))
  await clickText('Aggiungi testo')
  await waitFor(`!!document.querySelector('textarea')`, 10000, 'editor del testo')
  await typeInto('textarea', '[Intro]\n[Am]Parole del pezzo [G]inedito')
  await clickText('Salva')
  await waitFor(`location.pathname.endsWith(${q('/studio/' + pid)})`, 10000, 'ritorno al brano dopo il testo')
  await waitFor(`document.body.innerText.includes('inedito')`, 8000, 'testo in pagina')
  const lyr = (await api('GET', `/studio/projects/${pid}`, null, token)).data.lyrics
  check('testo: salvato e mostrato con gli accordi', lyr.includes('[Am]Parole del pezzo') && (await hasText('Modifica testo')) && (await hasText('Schermo intero')))
  await clickText('Schermo intero')
  await waitFor(`document.body.innerText.includes('inedito') && !!document.querySelector('.fixed.inset-0')`, 6000, 'teleprompter')
  check('testo: lo schermo intero si apre', true)

  // S11 spostamento di una cover in Prove
  const song = await api('POST', '/songs', { artist: 'Artista E2E', title: `Cover E2E ${Date.now()}`, category: 'da_provare', force: true }, token)
  const sid = song.data.id
  await api('PUT', `/songs/${sid}/lyrics`, { lyrics: '[C]Testo della cover' }, token)
  await api('POST', `/songs/${sid}/comments`, { content: 'Commento da portare' }, token)
  const fd = new FormData()
  fd.append('title', 'Audio da portare'); fd.append('recorded_on', '2026-03-07')
  fd.append('file', new Blob([fs.readFileSync(wav)]), 'cover.wav')
  const aud = await fetch(`${API}/songs/${sid}/audios`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
  check('spostamento: audio di prova caricato sulla cover', aud.status === 201, String(aud.status))
  let movedPid = null
  try {
    await go(`/songs/${sid}`)
    await waitFor(`[...document.querySelectorAll('button')].some(b => b.title === 'Sposta in Prove')`, 10000, 'azione Sposta in Prove')
    await clickTitle('Sposta in Prove')
    await waitFor(`document.body.innerText.includes('Si perdono i like')`, 8000, 'riepilogo')
    check('spostamento: il riepilogo elenca ciò che viaggia', (await hasText('il testo, 1 commento, 1 audio')) , await evaluate(`document.body.innerText.slice(0, 400)`))
    await clickText('Sposta')
    await waitFor(`location.pathname.includes('/studio/') && !location.pathname.includes('/songs/')`, 15000, 'apertura del brano di prova')
    movedPid = Number(await evaluate(`location.pathname.split('/').pop()`))
    await waitFor(`document.body.innerText.includes('Commento da portare')`, 10000, 'commento portato')
    const movedProj = (await api('GET', `/studio/projects/${movedPid}`, null, token)).data
    check('spostamento: il brano di prova ha testo, commento e audio della cover', movedProj.lyrics === '[C]Testo della cover' && movedProj.takes.length === 1 && (await hasText('Audio da portare')), JSON.stringify({ lyrics: movedProj.lyrics, takes: movedProj.takes.length }))
    check('spostamento: la cover non esiste più', (await api('GET', `/songs/${sid}`, null, token)).status === 404)
  } finally {
    if (movedPid) await api('DELETE', `/studio/projects/${movedPid}`, null, token)
    await api('DELETE', `/songs/${sid}`, null, token)
  }
} catch (err) {
  check('ESECUZIONE', false, err.message)
} finally {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' })
  else chrome.kill()
  await api('DELETE', `/studio/projects/${pid}`, null, token)
  await sleep(1500)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* profilo ancora in uso: lo ripulisce il sistema */ }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} verifiche superate`)
  const errs = [...new Set(consoleErrors)]
  console.log(errs.length ? `Errori del browser (${errs.length}):\n  ${errs.join('\n  ')}` : 'Nessun errore nella console del browser')
  process.exit(failed.length ? 1 : 0)
}
