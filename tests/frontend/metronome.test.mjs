// Test del metronomo. Esecuzione: node --test tests/frontend/metronome.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { BPM_MAX, BPM_MIN, beatTimesInWindow, clampBpm, tapTempo } from '../../frontend/src/lib/metronome.js'
import { DEFAULT_BPM, clickFrequency } from '../../frontend/src/lib/countin.js'

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`)

test('clampBpm: limiti, arrotondamento e valori non validi', () => {
  assert.equal(clampBpm(120), 120)
  assert.equal(clampBpm(120.6), 121)
  assert.equal(clampBpm(10), BPM_MIN)
  assert.equal(clampBpm(999), BPM_MAX)
  assert.equal(clampBpm('90'), 90)
  assert.equal(clampBpm(''), DEFAULT_BPM)
  assert.equal(clampBpm(NaN), DEFAULT_BPM)
  assert.equal(clampBpm(undefined), DEFAULT_BPM)
  assert.equal(clampBpm(-5), DEFAULT_BPM)
})

test('beatTimesInWindow: click a passo 60/bpm dentro la finestra', () => {
  const beats = beatTimesInWindow(10, 120, 10, 11.01) // passo 0,5 s
  assert.deepEqual(beats.map((b) => b.index), [0, 1, 2])
  near(beats[2].time, 11)
})

test('beatTimesInWindow: finestra semiaperta, nessun click doppio tra finestre contigue', () => {
  const a = beatTimesInWindow(0, 60, 0, 2) // click a 0 e 1
  const b = beatTimesInWindow(0, 60, 2, 4) // click a 2 e 3
  assert.deepEqual(a.map((x) => x.index), [0, 1])
  assert.deepEqual(b.map((x) => x.index), [2, 3])
})

test('beatTimesInWindow: origine nel futuro, finestra prima dell\'origine = vuota', () => {
  assert.deepEqual(beatTimesInWindow(5, 100, 0, 4.9), [])
  const beats = beatTimesInWindow(5, 100, 4.9, 5.1)
  assert.equal(beats.length, 1)
  assert.equal(beats[0].index, 0)
  near(beats[0].time, 5)
})

test('beatTimesInWindow: finestra che parte a metà passo salta al click successivo', () => {
  const beats = beatTimesInWindow(0, 120, 0.7, 1.3) // click a 0,5 / 1,0 / 1,5
  assert.deepEqual(beats.map((b) => b.index), [2])
})

test('accento sul primo tempo di ogni battuta', () => {
  const beats = beatTimesInWindow(0, 120, 0, 2.01)
  const freqs = beats.map((b) => clickFrequency(b.index, 3))
  assert.deepEqual(freqs, [1000, 800, 800, 1000, 800])
})

test('tapTempo: meno di due tocchi → nessun BPM', () => {
  const r = tapTempo([], 1000)
  assert.equal(r.bpm, null)
  assert.deepEqual(r.taps, [1000])
})

test('tapTempo: media degli intervalli', () => {
  let r = tapTempo([], 0)
  r = tapTempo(r.taps, 500)
  assert.equal(r.bpm, 120)
  r = tapTempo(r.taps, 1000)
  r = tapTempo(r.taps, 1500)
  assert.equal(r.bpm, 120)
})

test('tapTempo: dopo una pausa oltre 2 s si riparte da zero', () => {
  let r = tapTempo([], 0)
  r = tapTempo(r.taps, 500)
  r = tapTempo(r.taps, 5000)
  assert.equal(r.bpm, null)
  assert.deepEqual(r.taps, [5000])
})

test('tapTempo: tiene solo gli ultimi 5 tocchi e rispetta i limiti', () => {
  let r = { taps: [], bpm: null }
  for (let i = 0; i < 10; i++) r = tapTempo(r.taps, i * 1000) // 60 BPM
  assert.equal(r.taps.length, 5)
  assert.equal(r.bpm, 60)
  r = { taps: [], bpm: null }
  for (let i = 0; i < 4; i++) r = tapTempo(r.taps, i * 50) // 1200 BPM → limite
  assert.equal(r.bpm, BPM_MAX)
})
