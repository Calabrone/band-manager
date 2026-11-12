// Testo dei brani con accordi in linea (formato ChordPro): "[Am]Quando sei [G]qui".
// L'accordo tra quadre precede la sillaba su cui cade. Una riga fatta solo di "[testo]" che non è
// un accordo è un titolo di sezione ("[Ritornello]"). Nessuna dipendenza: testato con node --test.

const CHORD_RE =
  /^[A-G][#b]?(?:maj|min|m|M|dim|aug|sus|add|\+)?\d{0,2}(?:(?:sus|add|maj|b|#|\+|-)\d{1,2})*(?:\/[A-G][#b]?)?$/

const ITALIAN = { do: 'C', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B' }
const ITALIAN_RE = /^(sol|do|re|mi|fa|la|si)/i
const TAG_RE = /\[([^\[\]]*)\]/g

export function isChord(s) {
  return typeof s === 'string' && CHORD_RE.test(s)
}

function englishRoot(part) {
  const m = ITALIAN_RE.exec(part)
  return m ? ITALIAN[m[1].toLowerCase()] + part.slice(m[1].length) : part
}

/** Accordo in notazione anglosassone ("Lam" → "Am", "Sol/Si" → "G/B", "A-7" → "Am7"), o null se non lo è. */
export function normalizeChord(raw) {
  if (typeof raw !== 'string') return null
  let s = raw.trim().replace(/♯/g, '#').replace(/♭/g, 'b')
  if (s === '') return null
  // "-" subito dopo la nota (e l'alterazione) indica il minore: "A-7" → "Am7"
  s = s.replace(/^([A-G][#b]?)-/, '$1m')
  if (isChord(s)) return s
  let [main, bass] = s.split('/')
  if (s.split('/').length > 2) return null
  main = englishRoot(main)
  main = main.charAt(0).toUpperCase() + main.slice(1)
  main = main.replace(/^([A-G][#b]?)-/, '$1m')
  let out = main
  if (bass !== undefined) {
    bass = englishRoot(bass)
    out += '/' + bass.charAt(0).toUpperCase() + bass.slice(1)
  }
  return isChord(out) ? out : null
}

function parseLine(raw) {
  // Spezza la riga in testo e accordi, ricordando dove sta ogni accordo nel sorgente
  const tokens = []
  let last = 0
  for (const m of raw.matchAll(TAG_RE)) {
    if (!isChord(m[1])) continue
    if (m.index > last) tokens.push({ text: raw.slice(last, m.index), at: last })
    tokens.push({ chord: m[1], start: m.index, end: m.index + m[0].length })
    last = m.index + m[0].length
  }
  if (last < raw.length) tokens.push({ text: raw.slice(last), at: last })

  const words = []
  let word = null
  let pending = null
  const standalone = (c) => ({ srcStart: c.start, parts: [{ chord: c.chord, chordSrc: [c.start, c.end], text: '' }] })
  const closeWord = () => {
    if (word) words.push(word)
    word = null
  }
  const flushPending = () => {
    if (!pending) return
    if (word) word.parts.push({ chord: pending.chord, chordSrc: [pending.start, pending.end], text: '' })
    else words.push(standalone(pending))
    pending = null
  }

  for (const t of tokens) {
    if (t.chord) {
      flushPending()
      pending = t
      continue
    }
    for (let i = 0; i < t.text.length; i++) {
      const ch = t.text[i]
      if (/\s/.test(ch)) {
        flushPending()
        closeWord()
        continue
      }
      if (!word) {
        word = { srcStart: pending ? pending.start : t.at + i, parts: [] }
      }
      if (pending || word.parts.length === 0) {
        word.parts.push({
          chord: pending ? pending.chord : null,
          chordSrc: pending ? [pending.start, pending.end] : null,
          text: '',
        })
        pending = null
      }
      word.parts[word.parts.length - 1].text += ch
    }
  }
  flushPending()
  closeWord()
  return {
    type: 'line',
    words,
    hasChords: words.some((w) => w.parts.some((p) => p.chord)),
    hasText: words.some((w) => w.parts.some((p) => p.text !== '')),
  }
}

/** Righe del testo: { type: 'empty' } | { type: 'section', label } | { type: 'line', words, hasChords, hasText }. */
export function parse(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((raw) => {
      const t = raw.trim()
      if (t === '') return { type: 'empty' }
      const sec = /^\[([^\[\]]+)\]$/.exec(t)
      if (sec && !isChord(sec[1])) return { type: 'section', label: sec[1].trim() }
      return parseLine(raw)
    })
}

export function hasChords(text) {
  return parse(text).some((l) => l.type === 'line' && l.hasChords)
}

/** Solo le parole: via gli accordi e le righe di soli accordi; le sezioni restano. */
export function stripChords(text) {
  const out = []
  for (const l of parse(text)) {
    if (l.type === 'empty') out.push('')
    else if (l.type === 'section') out.push(`[${l.label}]`)
    else if (l.hasText) {
      out.push(
        l.words
          .map((w) => w.parts.map((p) => p.text).join(''))
          .filter((w) => w !== '')
          .join(' ')
      )
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Accordi distinti nell'ordine in cui compaiono. */
export function usedChords(text) {
  const seen = []
  for (const l of parse(text)) {
    if (l.type !== 'line') continue
    for (const w of l.words) for (const p of w.parts) if (p.chord && !seen.includes(p.chord)) seen.push(p.chord)
  }
  return seen
}

/**
 * Mette, cambia o toglie (chord = null) l'accordo su una parola. wordIndex/partIndex sono gli indici
 * restituiti da parse() per quella riga. Ritorna il nuovo testo.
 */
export function setChord(text, lineIndex, wordIndex, chord, partIndex = 0) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const raw = lines[lineIndex]
  if (raw === undefined) return text
  const parsed = parse(raw)[0]
  if (parsed.type !== 'line') return text
  const word = parsed.words[wordIndex]
  const part = word?.parts[partIndex]
  if (!part) return text
  const tag = chord ? `[${chord}]` : ''
  let next
  if (part.chordSrc) {
    next = raw.slice(0, part.chordSrc[0]) + tag + raw.slice(part.chordSrc[1])
    // Tolto un accordo isolato: non lasciare spazi doppi o in coda
    if (!chord && part.text === '') next = next.replace(/ {2,}/g, ' ').replace(/\s+$/, '')
  } else {
    next = raw.slice(0, word.srcStart) + tag + raw.slice(word.srcStart)
  }
  lines[lineIndex] = next
  return lines.join('\n')
}

/** Porta in notazione anglosassone gli accordi tra quadre scritti all'italiana ("[Lam]" → "[Am]"). */
export function normalizeText(text) {
  return String(text ?? '').replace(TAG_RE, (all, inner) => {
    if (isChord(inner)) return all
    // Solo ciò che ha l'aspetto di un accordo: "[La]" maiuscolo sì, "[la la la]" o "[Ritornello]" no
    if (!/^[A-Z]/.test(inner.trim()) || /\s/.test(inner.trim())) return all
    const c = normalizeChord(inner)
    return c ? `[${c}]` : all
  })
}

// Riga di soli accordi senza quadre ("Am      G    F"), come nei fogli con gli accordi sopra il testo
function chordSheetLine(raw) {
  if (/[\[\]]/.test(raw)) return null
  const found = []
  for (const m of raw.matchAll(/\S+/g)) {
    if (!/^[A-Z]/.test(m[0])) return null
    const chord = normalizeChord(m[0])
    if (!chord) return null
    found.push({ chord, col: m.index })
  }
  return found.length ? found : null
}

export function hasChordSheetLines(text) {
  return String(text ?? '').split(/\r?\n/).some((l) => chordSheetLine(l) !== null)
}

/**
 * Converte il formato "accordi sulla riga sopra" in accordi in linea: ogni accordo finisce nella riga
 * di testo sottostante, alla stessa colonna. Le righe di soli accordi senza testo sotto diventano "[Am] [G]".
 */
export function fromChordSheet(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const chords = chordSheetLine(lines[i])
    if (!chords) {
      out.push(lines[i])
      continue
    }
    const below = lines[i + 1]
    const belowIsLyrics =
      below !== undefined && below.trim() !== '' && chordSheetLine(below) === null && !/^\s*\[[^\[\]]+\]\s*$/.test(below)
    if (!belowIsLyrics) {
      out.push(chords.map((c) => `[${c.chord}]`).join(' '))
      continue
    }
    let merged = below
    for (const c of [...chords].reverse()) {
      if (merged.length < c.col) merged = merged.padEnd(c.col, ' ')
      merged = merged.slice(0, c.col) + `[${c.chord}]` + merged.slice(c.col)
    }
    out.push(merged.replace(/\s+$/, ''))
    i++
  }
  return out.join('\n')
}
