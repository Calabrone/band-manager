// Citazioni di marker e istanti nei commenti dei contenuti della Sala prove.
// Nel testo salvato: [[m:123]] = marker 123, [[t:45200]] = istante 45200 ms.
// Il server non le interpreta: si analizzano qui, e un token malformato resta testo normale.
// Funzioni pure, nessuna dipendenza: testate con node --test.

const REF_RE = /\[\[([mt]):(\d{1,9})\]\]/g

export const markerToken = (id) => `[[m:${id}]]`
export const timeToken = (ms) => `[[t:${Math.max(0, Math.round(ms))}]]`

/** Spezza il testo in parti: { type: 'text', text } | { type: 'marker', id } | { type: 'time', ms }. */
export function parseRefs(text) {
  const parts = []
  if (typeof text !== 'string' || text === '') return parts
  let last = 0
  for (const m of text.matchAll(REF_RE)) {
    if (m.index > last) parts.push({ type: 'text', text: text.slice(last, m.index) })
    const n = Number(m[2])
    parts.push(m[1] === 'm' ? { type: 'marker', id: n } : { type: 'time', ms: n })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) })
  return parts
}

/** Inserisce `token` alla posizione `cursor`, con uno spazio di separazione dove serve. */
export function insertRef(text, cursor, token) {
  const pos = Math.min(Math.max(Number.isInteger(cursor) ? cursor : text.length, 0), text.length)
  const before = text.slice(0, pos)
  const after = text.slice(pos)
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : ''
  const trail = after === '' || !/^\s/.test(after) ? ' ' : ''
  const inserted = lead + token + trail
  return { text: before + inserted + after, cursor: before.length + inserted.length }
}

/** Id dei marker citati in un testo, senza ripetizioni. */
export function citedMarkerIds(text) {
  return [...new Set(parseRefs(text).filter((p) => p.type === 'marker').map((p) => p.id))]
}

/** Per ogni marker, gli id dei commenti che lo citano (in ordine): Map<markerId, commentId[]>. */
export function citations(comments) {
  const map = new Map()
  for (const c of comments) {
    for (const id of citedMarkerIds(c.content)) {
      if (!map.has(id)) map.set(id, [])
      map.get(id).push(c.id)
    }
  }
  return map
}
