// Test delle librerie pure della Sala prove. Esecuzione: node --test tests/frontend/studio.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clampLoop, moveHandle, loopFromTrim, wrapLoop, fullView, minSpan, zoomLevel, zoomAt, panView,
  followCursor, msToX, xToMs, formatTime, formatClock, MAX_ZOOM,
} from '../../frontend/src/lib/loop.js'
import { parseRefs, insertRef, markerToken, timeToken, citedMarkerIds, citations } from '../../frontend/src/lib/refs.js'
import { computePeaks, peaksForView, bucketMsFor } from '../../frontend/src/lib/peaks.js'
import { baseTimeFor, computeSync, estimateLatencyMs, clampOffset } from '../../frontend/src/lib/sync.js'
import { extOf, kindFor, STUDIO_EXTS } from '../../frontend/src/lib/probe.js'
import {
  pickMime, extForMime, bytesPerSecond, maxSeconds, limitState, levelPercent, recordingFileName,
} from '../../frontend/src/lib/recorder.js'
import { totalBeats, countInSeconds, clickTimes, clickFrequency } from '../../frontend/src/lib/countin.js'

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`)

// ── loop ────────────────────────────────────────────────────────────────────

test('clampLoop: dentro i limiti e con distanza minima', () => {
  assert.deepEqual(clampLoop(1000, 5000, 10000), { a: 1000, b: 5000 })
  assert.deepEqual(clampLoop(-50, 20000, 10000), { a: 0, b: 10000 })
  assert.deepEqual(clampLoop(5000, 1000, 10000), { a: 1000, b: 5000 })          // invertiti
  assert.deepEqual(clampLoop(1000, 1050, 10000), { a: 1000, b: 1200 })          // troppo corto
  assert.deepEqual(clampLoop(9900, 9950, 10000), { a: 9800, b: 10000 })         // corto in fondo
  assert.deepEqual(clampLoop(0, 100, 150), { a: 0, b: 150 })                    // contenuto più corto del minimo
  assert.deepEqual(clampLoop(NaN, NaN, 10000), { a: 0, b: 10000 })
  assert.deepEqual(clampLoop(1, 2, 0), { a: 0, b: 0 })
})

test('moveHandle: non scavalca l\'altra maniglia', () => {
  const loop = { a: 2000, b: 6000 }
  assert.deepEqual(moveHandle(loop, 'a', 1000, 10000), { a: 1000, b: 6000 })
  assert.deepEqual(moveHandle(loop, 'a', 9000, 10000), { a: 5800, b: 6000 })
  assert.deepEqual(moveHandle(loop, 'a', -300, 10000), { a: 0, b: 6000 })
  assert.deepEqual(moveHandle(loop, 'b', 8000, 10000), { a: 2000, b: 8000 })
  assert.deepEqual(moveHandle(loop, 'b', 1000, 10000), { a: 2000, b: 2200 })
  assert.deepEqual(moveHandle(loop, 'b', 99999, 10000), { a: 2000, b: 10000 })
  assert.deepEqual(moveHandle(loop, 'b', loop.b + 100, 10000), { a: 2000, b: 6100 })   // ritocco +0,1 s
})

test('loopFromTrim: il taglio attiva il loop, senza taglio è tutto il contenuto', () => {
  assert.deepEqual(loopFromTrim(4000, 21500, 30000), { a: 4000, b: 21500, active: true })
  assert.deepEqual(loopFromTrim(null, null, 30000), { a: 0, b: 30000, active: false })
  assert.deepEqual(loopFromTrim(4000, 99000, 30000), { a: 4000, b: 30000, active: true })   // oltre la durata: ridotto
})

test('wrapLoop: salta ad A solo se attivo e vicino a B', () => {
  const loop = { a: 2000, b: 6000, active: true }
  assert.equal(wrapLoop(3000, loop), null)
  assert.equal(wrapLoop(5975, loop), 2000)
  assert.equal(wrapLoop(6100, loop), 2000)
  assert.equal(wrapLoop(6100, { ...loop, active: false }), null)
  assert.equal(wrapLoop(6100, null), null)
})

test('zoomAt: tiene fermo il punto sotto il dito e rispetta i limiti', () => {
  const D = 60000
  const v1 = zoomAt(fullView(D), 4, 30000, D)
  near(v1.spanMs, 15000)
  near(v1.startMs, 22500)                                    // 30000 resta a metà della finestra
  const v2 = zoomAt(v1, 2, 22500, D)                         // ancora sul bordo sinistro
  near(v2.startMs, 22500)
  near(v2.spanMs, 7500)
  const max = zoomAt(fullView(D), 1000, 10000, D)
  near(max.spanMs, D / MAX_ZOOM)
  near(zoomLevel(max, D), MAX_ZOOM)
  const out = zoomAt(v1, 0.001, 30000, D)
  assert.deepEqual(out, { startMs: 0, spanMs: D })           // riduzione oltre il contenuto intero
  const edge = zoomAt(fullView(D), 8, 59000, D)
  assert.ok(edge.startMs + edge.spanMs <= D + 1e-9 && edge.startMs >= 0)
  assert.ok(minSpan(1000) >= 50 && minSpan(10) === 10)
})

test('panView e followCursor', () => {
  const D = 60000
  const v = { startMs: 10000, spanMs: 10000 }
  assert.deepEqual(panView(v, -50000, D), { startMs: 0, spanMs: 10000 })
  assert.deepEqual(panView(v, 99999, D), { startMs: 50000, spanMs: 10000 })
  assert.deepEqual(followCursor(v, 12000, D), v)                                  // dentro: nessuno spostamento
  assert.deepEqual(followCursor(v, 19500, D), { startMs: 18500, spanMs: 10000 })  // oltre il 90%
  assert.deepEqual(followCursor(v, 3000, D), { startMs: 2000, spanMs: 10000 })    // a sinistra
  assert.deepEqual(followCursor(fullView(D), 59000, D), fullView(D))              // tutto visibile
  assert.equal(followCursor({ startMs: 50000, spanMs: 10000 }, 59990, D).startMs, 50000)
})

test('msToX / xToMs sono l\'uno l\'inverso dell\'altro', () => {
  const view = { startMs: 20000, spanMs: 5000 }
  near(msToX(22500, view, 400), 200)
  near(xToMs(200, view, 400), 22500)
  for (const ms of [20000, 21234, 24999]) near(xToMs(msToX(ms, view, 731), view, 731), ms, 1e-6)
  assert.equal(xToMs(10, view, 0), 20000)
})

test('formatTime e formatClock', () => {
  assert.equal(formatTime(0), '0:00.0')
  assert.equal(formatTime(45200), '0:45.2')
  assert.equal(formatTime(125999), '2:05.9')
  assert.equal(formatTime(-5), '0:00.0')
  assert.equal(formatClock(45200), '0:45')
  assert.equal(formatClock(3725000), '62:05')
})

// ── citazioni ───────────────────────────────────────────────────────────────

test('parseRefs: marker, istanti e testo', () => {
  assert.deepEqual(parseRefs('Guarda [[m:12]] e [[t:45200]] ok'), [
    { type: 'text', text: 'Guarda ' }, { type: 'marker', id: 12 },
    { type: 'text', text: ' e ' }, { type: 'time', ms: 45200 }, { type: 'text', text: ' ok' },
  ])
  assert.deepEqual(parseRefs('[[m:1]][[m:2]]'), [{ type: 'marker', id: 1 }, { type: 'marker', id: 2 }])
  assert.deepEqual(parseRefs('solo testo'), [{ type: 'text', text: 'solo testo' }])
  assert.deepEqual(parseRefs(''), [])
  assert.deepEqual(parseRefs(null), [])
})

test('parseRefs: i token malformati restano testo', () => {
  for (const bad of ['[[m:abc]]', '[[m:]]', '[[x:1]]', '[[m:12', '[m:12]', '[[m:1234567890]]', '[[m: 1]]', '[[M:1]]']) {
    assert.deepEqual(parseRefs(bad), [{ type: 'text', text: bad }], bad)
  }
  assert.deepEqual(parseRefs('[[m:abc]] [[m:3]]'), [{ type: 'text', text: '[[m:abc]] ' }, { type: 'marker', id: 3 }])
})

test('insertRef inserisce il token con gli spazi giusti', () => {
  assert.deepEqual(insertRef('Qui', 3, '[[m:5]]'), { text: 'Qui [[m:5]] ', cursor: 12 })
  assert.deepEqual(insertRef('', 0, '[[t:9]]'), { text: '[[t:9]] ', cursor: 8 })
  assert.deepEqual(insertRef('ab cd', 3, '[[m:1]]'), { text: 'ab [[m:1]] cd', cursor: 11 })
  assert.deepEqual(insertRef('ab', undefined, '[[m:1]]'), { text: 'ab [[m:1]] ', cursor: 11 })
  assert.deepEqual(insertRef('ab', 99, '[[m:1]]').text, 'ab [[m:1]] ')
  assert.equal(markerToken(7), '[[m:7]]')
  assert.equal(timeToken(1234.6), '[[t:1235]]')
  assert.equal(timeToken(-3), '[[t:0]]')
})

test('citedMarkerIds e citations', () => {
  assert.deepEqual(citedMarkerIds('[[m:2]] [[m:2]] [[m:5]] [[t:1]]'), [2, 5])
  const map = citations([
    { id: 10, content: 'vedi [[m:2]]' }, { id: 11, content: 'niente' },
    { id: 12, content: '[[m:2]] e [[m:3]]' },
  ])
  assert.deepEqual(map.get(2), [10, 12])
  assert.deepEqual(map.get(3), [12])
  assert.equal(map.has(4), false)
})

// ── forma d'onda ────────────────────────────────────────────────────────────

test('computePeaks: bucket da 10 ms, normalizzati 0-255', () => {
  const sr = 1000                                     // 1 campione = 1 ms
  const ch = new Float32Array(1000)                   // 1 s → 100 bucket
  ch[5] = 0.25
  ch[505] = -0.5                                      // il massimo, in negativo
  const p = computePeaks([ch], sr)
  assert.equal(p.length, 100)
  assert.equal(p[0], 128)                             // 0.25/0.5 → 127.5 → 128
  assert.equal(p[50], 255)
  assert.equal(p[1], 0)
  assert.deepEqual(computePeaks([new Float32Array(500)], sr).every((v) => v === 0), true)   // silenzio
  assert.deepEqual(computePeaks([], sr), [])
  assert.deepEqual(computePeaks([ch], 0), [])
})

test('computePeaks: più canali (massimo tra i due) e tetto sul numero di picchi', () => {
  const l = new Float32Array(100)
  const r = new Float32Array(100)
  l[0] = 0.2
  r[0] = 0.4
  assert.equal(computePeaks([l, r], 1000)[0], 255)
  const long = new Float32Array(48000 * 400)          // 400 s a 48 kHz
  long[1] = 1
  const p = computePeaks([long], 48000)
  assert.ok(p.length <= 16000 && p.length > 15000, `lunghezza ${p.length}`)
  assert.equal(p[0], 255)
  near(bucketMsFor(400000), 25)
  assert.equal(bucketMsFor(1000), 10)
})

test('peaksForView: massimo per colonna e zoom', () => {
  const peaks = [0, 10, 200, 20, 30, 40, 50, 255]      // 8 bucket su 8000 ms → 1000 ms l'uno
  const all = peaksForView(peaks, 8000, { startMs: 0, spanMs: 8000 }, 4)
  assert.deepEqual(all, [10, 200, 40, 255])
  const zoom = peaksForView(peaks, 8000, { startMs: 2000, spanMs: 2000 }, 4)   // più colonne per bucket
  assert.deepEqual(zoom, [200, 200, 20, 20])
  assert.deepEqual(peaksForView(peaks, 8000, { startMs: 0, spanMs: 8000 }, 0), [])
  assert.deepEqual(peaksForView([], 8000, { startMs: 0, spanMs: 8000 }, 3), [0, 0, 0])
  assert.equal(peaksForView(peaks, 8000, { startMs: 7500, spanMs: 500 }, 2).length, 2)
})

// ── allineamento ────────────────────────────────────────────────────────────

test('baseTimeFor: senza loop', () => {
  const p = { sync_ms: 850, offset_ms: 40, base_start_ms: 4000 }
  assert.equal(baseTimeFor(500, p), null)                 // la base non è ancora partita
  assert.equal(baseTimeFor(890, p), 4000)                 // 890 − 850 − 40 = 0
  assert.equal(baseTimeFor(2890, p), 6000)
  assert.equal(baseTimeFor(2890, { ...p, offset_ms: -60 }), 6100)     // offset negativo: la base è "più avanti"
  assert.equal(baseTimeFor(100, { sync_ms: 0, offset_ms: 0, base_start_ms: 0 }), 100)
})

test('baseTimeFor: la base in loop riparte da A', () => {
  const p = { sync_ms: 1000, offset_ms: 0, base_start_ms: 4000, base_loop_start_ms: 4000, base_loop_end_ms: 9000 }
  assert.equal(baseTimeFor(1000, p), 4000)
  assert.equal(baseTimeFor(4000, p), 7000)
  assert.equal(baseTimeFor(6000, p), 4000)                        // 4000 + 5000 = 9000 = fine loop → torna ad A
  assert.equal(baseTimeFor(6500, p), 4500)
  assert.equal(baseTimeFor(1000 + 5000 * 3 + 250, p), 4250)       // dopo più giri
  const mid = { ...p, base_start_ms: 2000 }                       // partita prima di A: prima passata senza salti
  assert.equal(baseTimeFor(1000, mid), 2000)
  assert.equal(baseTimeFor(1000 + 7000, mid), 4000)               // 2000+7000 = 9000 → A
  const flat = { ...p, base_loop_end_ms: 4000 }                   // loop degenere: ignorato
  assert.equal(baseTimeFor(11000, flat), 14000)
})

test('computeSync, estimateLatencyMs, clampOffset', () => {
  assert.equal(computeSync(10, 10.85), 850)
  assert.equal(computeSync(10, 9), 0)
  assert.equal(estimateLatencyMs({ outputLatency: 0.045, inputLatency: 0.02 }), 65)
  assert.equal(estimateLatencyMs({ outputLatency: 0, baseLatency: 0.01, inputLatency: 0.005 }), 15)
  assert.equal(estimateLatencyMs({ outputLatency: 5 }), 2000)
  assert.equal(estimateLatencyMs({}), 0)
  assert.equal(estimateLatencyMs(), 0)
  assert.equal(clampOffset(5000), 2000)
  assert.equal(clampOffset(-5000), -2000)
  assert.equal(clampOffset(12.6), 13)
  assert.equal(clampOffset(NaN), 0)
})

// ── conteggio ───────────────────────────────────────────────────────────────

test('conteggio: battute, durata e click', () => {
  assert.equal(totalBeats(4, 1), 4)
  assert.equal(totalBeats(3, 2), 6)
  assert.equal(totalBeats(0, 0), 1)
  near(countInSeconds(120, 4, 1), 2)
  near(countInSeconds(100, 4, 2), 4.8)
  near(countInSeconds(0, 4, 1), 2.4)                      // bpm non valido → 100
  const t = clickTimes(10, 120, 4, 1)
  assert.equal(t.length, 4)
  near(t[0], 10)
  near(t[3], 11.5)
  assert.equal(clickFrequency(0, 4), 1000)
  assert.equal(clickFrequency(1, 4), 800)
  assert.equal(clickFrequency(4, 4), 1000)                // primo tempo della seconda battuta
  assert.equal(clickFrequency(3, 3), 1000)
})

// ── analisi dei file ────────────────────────────────────────────────────────

test('extOf', () => {
  assert.equal(extOf('Riff.M4A'), 'm4a')
  assert.equal(extOf('a.b.mp4'), 'mp4')
  assert.equal(extOf('senza'), '')
  assert.equal(extOf('.hidden'), 'hidden')
})

test("kindFor: dall'estensione, e per mp4/webm da ciò che il browser vede nel file", () => {
  assert.equal(kindFor('a.mp3', 'audio/mpeg', null), 'audio')
  assert.equal(kindFor('a.3gp', '', null), 'audio')
  assert.equal(kindFor('clip.MOV', 'video/quicktime', null), 'video')
  assert.equal(kindFor('clip.m4v', '', null), 'video')
  assert.equal(kindFor('x.mp4', '', true), 'video')
  assert.equal(kindFor('x.mp4', 'video/mp4', false), 'audio')          // mp4 con sola traccia audio
  assert.equal(kindFor('x.webm', 'audio/webm', null), 'audio')         // il browser non sa: vale il MIME
  assert.equal(kindFor('x.webm', '', null), 'video')
  assert.equal(kindFor('virus.exe', 'application/x-msdownload', null), null)
  assert.equal(kindFor('noext', 'audio/mpeg', null), null)
  assert.ok(STUDIO_EXTS.includes('mov') && STUDIO_EXTS.includes('m4a') && !STUDIO_EXTS.includes('exe'))
})

// ── registrazione ───────────────────────────────────────────────────────────

test("pickMime: preferisce mp4, poi webm; null se non c'è nulla", () => {
  const only = (...list) => (m) => list.includes(m)
  assert.equal(pickMime('video', only('video/mp4', 'video/webm')), 'video/mp4')
  assert.equal(pickMime('video', only('video/webm;codecs=vp9,opus', 'video/webm')), 'video/webm;codecs=vp9,opus')
  assert.equal(pickMime('video', only('video/webm')), 'video/webm')
  assert.equal(pickMime('audio', only('audio/mp4', 'audio/webm;codecs=opus')), 'audio/mp4')
  assert.equal(pickMime('audio', only('audio/webm;codecs=opus')), 'audio/webm;codecs=opus')
  assert.equal(pickMime('audio', only('video/mp4')), null)                 // un formato video non vale per l'audio
  assert.equal(pickMime('video', () => false), null)
})

test('extForMime: solo estensioni ammesse dal server', () => {
  assert.equal(extForMime('video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video'), 'mp4')
  assert.equal(extForMime('audio/mp4', 'audio'), 'm4a')
  assert.equal(extForMime('audio/webm;codecs=opus', 'audio'), 'webm')
  assert.equal(extForMime('video/webm', 'video'), 'webm')
  assert.equal(extForMime('audio/ogg;codecs=opus', 'audio'), 'ogg')
  assert.equal(extForMime('audio/ogg', 'video'), null)
  assert.equal(extForMime('', 'audio'), null)
  assert.equal(extForMime('application/x', 'audio'), null)
})

test("limiti di dimensione: avviso all'85%, stop al 95%", () => {
  const max = 128 * 1048576
  assert.equal(limitState(0, max), 'ok')
  assert.equal(limitState(max * 0.84, max), 'ok')
  assert.equal(limitState(max * 0.85, max), 'warn')
  assert.equal(limitState(max * 0.949, max), 'warn')
  assert.equal(limitState(max * 0.95, max), 'stop')
  assert.equal(limitState(max * 2, max), 'stop')
  assert.equal(limitState(1e12, 0), 'ok')                                  // limite sconosciuto: nessun blocco
  assert.equal(bytesPerSecond('audio'), 16000)
  assert.equal(bytesPerSecond('video'), 328500)
  assert.equal(maxSeconds('video', max), Math.floor((max * 0.95) / 328500))
  assert.ok(maxSeconds('video', max) > 350 && maxSeconds('video', max) < 450)   // ~6-7 minuti di video a 720p
  assert.equal(maxSeconds('audio', 0), null)
})

test('levelPercent: scala dB da −60 a 0', () => {
  assert.equal(levelPercent(0), 0)
  assert.equal(levelPercent(-1), 0)
  assert.equal(levelPercent(1), 1)
  assert.equal(levelPercent(2), 1)
  near(levelPercent(0.001), 0)                                             // −60 dB
  near(levelPercent(0.1), 2 / 3)                                           // −20 dB
  assert.ok(levelPercent(0.01) < levelPercent(0.05))
})

test('recordingFileName: nome file sicuro dal titolo', () => {
  assert.equal(recordingFileName('Riff chitarra strofa', 'm4a'), 'riff-chitarra-strofa.m4a')
  assert.equal(recordingFileName('  Città & Perché?! ', 'webm'), 'citta-perche.webm')
  assert.equal(recordingFileName('', 'mp4'), 'registrazione.mp4')
  assert.equal(recordingFileName('///', 'mp4'), 'registrazione.mp4')
  assert.equal(recordingFileName('a'.repeat(100), 'mp4'), `${'a'.repeat(40)}.mp4`)
  assert.equal(recordingFileName('../../etc/passwd', 'mp4'), 'etc-passwd.mp4')
})
