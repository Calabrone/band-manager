// Test di raggruppamento Prove e riepiloghi. Esecuzione: node --test tests/frontend/studioGroups.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { countBySegment, groupByStatus, inSegment, migrateFilter, segmentOf } from '../../frontend/src/lib/studioGroups.js'
import { summarizeListening, summarizeTempo } from '../../frontend/src/lib/uiSummary.js'

const p = (id, status) => ({ id, status })
const sample = [p(1, 'idea'), p(2, 'pronto'), p(3, 'lavorazione'), p(4, 'idea'), p(5, 'promosso'), p(6, 'archiviato')]

test('segmentOf: stati -> segmenti', () => {
  assert.equal(segmentOf('idea'), 'inCorso')
  assert.equal(segmentOf('lavorazione'), 'inCorso')
  assert.equal(segmentOf('pronto'), 'inCorso')
  assert.equal(segmentOf('promosso'), 'promossi')
  assert.equal(segmentOf('archiviato'), 'archivio')
})

test('countBySegment e inSegment', () => {
  assert.deepEqual(countBySegment(sample), { inCorso: 4, promossi: 1, archivio: 1 })
  assert.deepEqual(inSegment(sample, 'promossi').map((x) => x.id), [5])
  assert.deepEqual(countBySegment([]), { inCorso: 0, promossi: 0, archivio: 0 })
})

test('groupByStatus: ordine pronto > lavorazione > idea, senza sezioni vuote', () => {
  const g = groupByStatus(inSegment(sample, 'inCorso'))
  assert.deepEqual(g.map((x) => x.status), ['pronto', 'lavorazione', 'idea'])
  assert.deepEqual(g[2].items.map((x) => x.id), [1, 4])
  assert.deepEqual(groupByStatus([p(1, 'idea')]).map((x) => x.status), ['idea'])
  assert.deepEqual(groupByStatus([]), [])
})

test('migrateFilter: vecchi valori del filtro -> segmento', () => {
  assert.equal(migrateFilter('attivi'), 'inCorso')
  assert.equal(migrateFilter('idea'), 'inCorso')
  assert.equal(migrateFilter('pronto'), 'inCorso')
  assert.equal(migrateFilter('promosso'), 'promossi')
  assert.equal(migrateFilter('archiviato'), 'archivio')
  assert.equal(migrateFilter('promossi'), 'promossi')
  assert.equal(migrateFilter('boh'), 'inCorso')
})

test('summarizeListening', () => {
  assert.equal(summarizeListening({ volume: 0.8, countIn: false }), 'Volume 80% · conteggio spento')
  assert.equal(
    summarizeListening({ volume: 1, countIn: true, baseVolume: 0.5, offsetMs: 40 }),
    'Volume 100% · conteggio attivo · base 50% · latenza +40 ms',
  )
  assert.equal(summarizeListening({ volume: 1, countIn: false, offsetMs: -20 }), 'Volume 100% · conteggio spento · latenza -20 ms')
})

test('summarizeTempo', () => {
  assert.equal(summarizeTempo({ bpm: 110, countIn: false, metronome: false }), '110 BPM · conteggio no · metronomo no')
  assert.equal(summarizeTempo({ bpm: 90, countIn: true, metronome: true }), '90 BPM · conteggio sì · metronomo sì')
})
