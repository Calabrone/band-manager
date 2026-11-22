// Tempo relativo e raggruppamento per giorno delle notifiche. Puro, testato con node --test.
// Le date del server sono UTC senza fuso ("2026-11-22T10:15:00.123456").

export function parseServerDate(s) {
  if (!s) return new Date(NaN)
  const iso = String(s).replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z')
}

const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']

/** «adesso», «5 min fa», «3 h fa», «ieri», «4 giorni fa», poi la data. */
export function timeAgo(date, now = new Date()) {
  const d = date instanceof Date ? date : parseServerDate(date)
  const sec = Math.round((now - d) / 1000)
  if (!Number.isFinite(sec)) return ''
  if (sec < 60) return 'adesso'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min fa`
  const h = Math.floor(min / 60)
  if (h < 24 && dayKey(d) === dayKey(now)) return `${h} h fa`
  const days = dayDiff(d, now)
  if (days === 1) return 'ieri'
  if (days < 7) return `${days} giorni fa`
  return `${d.getDate()} ${MESI[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}`
}

function dayKey(d) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayDiff(d, now) {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((b - a) / 86400000)
}

/** Etichetta del gruppo: «Oggi», «Ieri», «lunedì 16 novembre». */
export function dayLabel(date, now = new Date()) {
  const d = date instanceof Date ? date : parseServerDate(date)
  const days = dayDiff(d, now)
  if (days === 0) return 'Oggi'
  if (days === 1) return 'Ieri'
  const giorni = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']
  const mesi = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
  return `${giorni[d.getDay()]} ${d.getDate()} ${mesi[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ' ' + d.getFullYear() : ''}`
}

/** [{ label, items }] in ordine, raggruppando per giorno di updated_at. */
export function groupByDay(items, now = new Date()) {
  const groups = []
  for (const it of items) {
    const label = dayLabel(it.updated_at, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(it)
    else groups.push({ label, items: [it] })
  }
  return groups
}

/** Divide il testo della notifica in parti, marcando come titolo ciò che sta tra «». */
export function splitTitle(text) {
  const parts = []
  const re = /«([^»]*)»/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), title: false })
    parts.push({ text: m[1], title: true })
    last = re.lastIndex
  }
  if (last < text.length) parts.push({ text: text.slice(last), title: false })
  return parts
}
