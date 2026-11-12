// Test del formato accordi del frontend. Esecuzione: node --test tests/frontend/chordpro.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fromChordSheet,
  hasChordSheetLines,
  hasChords,
  isChord,
  normalizeChord,
  normalizeText,
  parse,
  setChord,
  stripChords,
  usedChords,
} from '../../frontend/src/lib/chordpro.js'

const wordsOf = (line) => line.words.map((w) => w.parts.map((p) => [p.chord, p.text]))

test('isChord riconosce gli accordi in notazione anglosassone', () => {
  for (const c of ['A', 'Am', 'F#m7', 'Bb', 'Cadd9', 'G7sus4', 'D/F#', 'Cmaj7', 'Cm7b5', 'Edim', 'Gaug', 'C7#9', 'Asus', 'E5', 'G+']) {
    assert.equal(isChord(c), true, c)
  }
})

test('isChord rifiuta le sezioni e il testo', () => {
  for (const c of ['Coro', 'Bridge', 'Chorus', 'Strofa 1', 'Intro', 'Do', 'H', 'am', '', 'A B', 'Ritornello']) {
    assert.equal(isChord(c), false, c)
  }
})

test('normalizeChord converte dalla notazione italiana', () => {
  const cases = {
    Lam: 'Am', 'La-': 'Am', Do7: 'C7', Sol: 'G', 'Sol/Si': 'G/B', Mim7: 'Em7', Sib: 'Bb', 'Fa#m': 'F#m',
    Rem: 'Dm', 'DO': 'C', 'A-7': 'Am7', 'Re♯': 'D#', 'Mi♭': 'Eb', Fa: 'F', Fadd9: 'Fadd9', ' Am ': 'Am', c: 'C',
  }
  for (const [input, expected] of Object.entries(cases)) {
    assert.equal(normalizeChord(input), expected, input)
  }
})

test('normalizeChord restituisce null per ciò che non è un accordo', () => {
  for (const c of ['Coro', 'ciao', '', 'Sol/Si/Re', 'Xm']) assert.equal(normalizeChord(c), null, c)
})

test('parse: accordo a inizio parola', () => {
  const [line] = parse('[Am]Quando sei [G]qui')
  assert.equal(line.type, 'line')
  assert.equal(line.hasChords, true)
  assert.deepEqual(wordsOf(line), [[['Am', 'Quando']], [[null, 'sei']], [['G', 'qui']]])
})

test('parse: accordo a metà parola divide la parola in due parti', () => {
  const [line] = parse('pa[E]reti')
  assert.deepEqual(wordsOf(line), [[[null, 'pa'], ['E', 'reti']]])
})

test('parse: sezione, riga vuota, riga di soli accordi', () => {
  const lines = parse('[Ritornello]\n\n[Am] [G] [F]\ntesto')
  assert.deepEqual(lines[0], { type: 'section', label: 'Ritornello' })
  assert.deepEqual(lines[1], { type: 'empty' })
  assert.equal(lines[2].hasText, false)
  assert.deepEqual(wordsOf(lines[2]), [[['Am', '']], [['G', '']], [['F', '']]])
  assert.equal(lines[3].hasChords, false)
})

test('parse: una riga con un solo accordo tra quadre non è una sezione', () => {
  const [line] = parse('[Am]')
  assert.equal(line.type, 'line')
  assert.deepEqual(wordsOf(line), [[['Am', '']]])
})

test('parse: quadre che non sono accordi restano testo', () => {
  const [line] = parse('canta [x2] ancora')
  assert.equal(line.hasChords, false)
  assert.deepEqual(wordsOf(line), [[[null, 'canta']], [[null, '[x2]']], [[null, 'ancora']]])
})

test('parse: accordo a fine riga e accordi consecutivi', () => {
  assert.deepEqual(wordsOf(parse('fine [G]')[0]), [[[null, 'fine']], [['G', '']]])
  assert.deepEqual(wordsOf(parse('[Am][G]via')[0]), [[['Am', '']], [['G', 'via']]])
})

test('setChord aggiunge, sostituisce e toglie', () => {
  const text = 'prima riga\nQuando sei qui'
  const added = setChord(text, 1, 1, 'Am')
  assert.equal(added, 'prima riga\nQuando [Am]sei qui')
  const replaced = setChord(added, 1, 1, 'F#m')
  assert.equal(replaced, 'prima riga\nQuando [F#m]sei qui')
  assert.equal(setChord(replaced, 1, 1, null), text)
})

test('setChord su un accordo a metà parola e su uno isolato', () => {
  assert.equal(setChord('pa[E]reti', 0, 0, 'A', 1), 'pa[A]reti')
  assert.equal(setChord('pa[E]reti', 0, 0, null, 1), 'pareti')
  assert.equal(setChord('pa[E]reti', 0, 0, 'C'), '[C]pa[E]reti')
  assert.equal(setChord('[Am] [G] [F]', 0, 1, null), '[Am] [F]')
  assert.equal(setChord('fine [G]', 0, 1, null), 'fine')
})

test('setChord ignora indici inesistenti e sezioni', () => {
  assert.equal(setChord('ciao', 5, 0, 'A'), 'ciao')
  assert.equal(setChord('ciao', 0, 9, 'A'), 'ciao')
  assert.equal(setChord('[Ritornello]', 0, 0, 'A'), '[Ritornello]')
})

test('stripChords toglie accordi e righe di soli accordi, tiene le sezioni', () => {
  const text = '[Intro]\n[Am] [G]\n\n[Strofa 1]\n[Am]Quando sei [G]qui\npa[E]reti'
  assert.equal(stripChords(text), '[Intro]\n\n[Strofa 1]\nQuando sei qui\npareti')
})

test('hasChords e usedChords', () => {
  assert.equal(hasChords('solo testo\n[Ritornello]'), false)
  assert.equal(hasChords('un [C]accordo'), true)
  assert.deepEqual(usedChords('[Am]a [G]b\n[Am]c [F]d'), ['Am', 'G', 'F'])
})

test('normalizeText converte gli accordi italiani tra quadre senza toccare le sezioni', () => {
  assert.equal(normalizeText('[Lam]Quando [Sol7]sei\n[Ritornello]\n[la la la]'), '[Am]Quando [G7]sei\n[Ritornello]\n[la la la]')
})

test('fromChordSheet porta in linea gli accordi scritti sulla riga sopra', () => {
  const sheet = ['Am      G', 'Quando sei qui', '', 'Lam  Sol', '', 'C', 'ok'].join('\n')
  assert.equal(hasChordSheetLines(sheet), true)
  assert.equal(fromChordSheet(sheet), ['[Am]Quando s[G]ei qui', '', '[Am] [G]', '', '[C]ok'].join('\n'))
})

test('fromChordSheet: accordo oltre la fine della riga, testo normale intatto', () => {
  assert.equal(fromChordSheet('C         G\nciao'), '[C]ciao      [G]')
  const plain = 'la la la\nQuando sei qui\n[Am]già in linea'
  assert.equal(hasChordSheetLines(plain), false)
  assert.equal(fromChordSheet(plain), plain)
})
