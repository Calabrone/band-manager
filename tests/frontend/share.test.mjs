// Test dei link di condivisione. Esecuzione: node --test tests/frontend/share.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSharePath, shareUrl, parseFocus, focusKey, parseTime, parseLoop, pickKey, safeNext, shareText, STRIP_PARAMS,
} from '../../frontend/src/lib/share.js'

test('buildSharePath ordina le chiavi e omette i vuoti', () => {
  assert.equal(buildSharePath('/studio/3/takes/9', { b: 5000, a: 1000 }), '/studio/3/takes/9?a=1000&b=5000')
  assert.equal(buildSharePath('/songs/1', { focus: null, t: undefined, x: '' }), '/songs/1')
  assert.equal(buildSharePath('/songs/1'), '/songs/1')
  assert.equal(buildSharePath('/', { cat: 'da provare' }), '/?cat=da%20provare')
})

test('shareUrl con base /band/ e /band-test/', () => {
  assert.equal(shareUrl('/songs/4', { focus: 'comment-2' }, { origin: 'https://www.motorn.it', base: '/band/' }),
    'https://www.motorn.it/band/songs/4?focus=comment-2')
  assert.equal(shareUrl('/', { cat: 'proposta' }, { origin: 'https://www.motorn.it/', base: '/band-test' }),
    'https://www.motorn.it/band-test/?cat=proposta')
  assert.equal(shareUrl('/studio', {}, { origin: 'http://localhost:5173', base: '/' }), 'http://localhost:5173/studio')
})

test('parseFocus: elementi, sezioni e valori malformati', () => {
  assert.deepEqual(parseFocus('comment-12'), { kind: 'comment', id: 12 })
  assert.deepEqual(parseFocus('take-3'), { kind: 'take', id: 3 })
  assert.deepEqual(parseFocus('lyrics'), { kind: 'lyrics' })
  for (const bad of ['comment-', 'comment-0', 'comment-abc', 'evil-3', '', null, undefined, 'comment-1-2', '<x>']) {
    assert.equal(parseFocus(bad), null, String(bad))
  }
  assert.equal(focusKey({ kind: 'marker', id: 5 }), 'marker-5')
  assert.equal(focusKey({ kind: 'comments' }), 'comments')
  assert.equal(focusKey(null), null)
})

test('parseTime e parseLoop', () => {
  assert.equal(parseTime('2000'), 2000)
  assert.equal(parseTime('0'), 0)
  for (const bad of ['-1', '1.5', 'abc', '', null, '1e3']) assert.equal(parseTime(bad), null, String(bad))
  assert.deepEqual(parseLoop('1000', '3000'), { a: 1000, b: 3000 })
  assert.equal(parseLoop('3000', '1000'), null)
  assert.equal(parseLoop('1000', '1000'), null)
  assert.equal(parseLoop('1000', null), null)
})

test('pickKey accetta solo chiavi note', () => {
  assert.equal(pickKey('commenti', ['contenuti', 'commenti']), 'commenti')
  assert.equal(pickKey('altro', ['contenuti']), null)
  assert.equal(pickKey(null, ['contenuti']), null)
})

test('safeNext: solo percorsi interni', () => {
  assert.equal(safeNext('/songs/3?focus=comment-1'), '/songs/3?focus=comment-1')
  assert.equal(safeNext('/studio/2/takes/5?a=1&b=9'), '/studio/2/takes/5?a=1&b=9')
  assert.equal(safeNext('/?cat=proposta'), '/?cat=proposta')
  for (const bad of ['//evil.com', 'https://x.it', '/\\evil.com', 'javascript:alert(1)', '/javascript:alert(1)',
    '/login', '/login?next=/x', '', null, 'songs/3', '/a\nb', '/a\\b']) {
    assert.equal(safeNext(bad), null, String(bad))
  }
  // ':' nella query è lecito
  assert.equal(safeNext('/songs/1?x=a:b'), '/songs/1?x=a:b')
})

test('shareText: testi con e senza nome del gruppo', () => {
  assert.equal(shareText('song', { title: 'Wish', artist: 'Pink Floyd' }), '«Wish» – Pink Floyd')
  assert.equal(shareText('song', { title: 'Wish', artist: 'Pink Floyd', bandName: 'I Motorn' }), '«Wish» – Pink Floyd · I Motorn')
  assert.equal(shareText('section', { label: 'Proposta' }), 'Repertorio · Proposta')
  assert.equal(shareText('audio', { title: 'Wish', artist: 'PF', item: 'Prova 1' }), '«Wish» – PF · audio «Prova 1»')
  assert.equal(shareText('take', { title: 'Idea', item: 'Basso', time: 83000 }), '«Basso» (brano di prova «Idea») da 1:23')
  assert.equal(shareText('take', { title: 'Idea', item: 'Basso', loop: { a: 83000, b: 105000 } }),
    '«Basso» (brano di prova «Idea») loop 1:23–1:45')
  assert.equal(shareText('take', { title: 'Idea', item: 'Basso' }), '«Basso» (brano di prova «Idea»)')
  assert.equal(shareText('marker', { title: 'Basso', item: 'Rit', time: 5000 }), 'Marker «Rit» a 0:05 in «Basso»')
  assert.equal(shareText('comment', { title: 'Wish', author: 'gigi' }), 'Commento di gigi su «Wish»')
})

test('STRIP_PARAMS non contiene i parametri di vista', () => {
  assert.deepEqual(STRIP_PARAMS, ['focus', 't', 'a', 'b'])
})
