// Link diretti per la condivisione (spec .kiro/specs/share-links/).
// Modulo puro: niente DOM, niente React; testato con node --test.

import { formatClock } from './loop.js'

/** Parametri "di un colpo": tolti dall'URL dopo l'apertura del link. */
export const STRIP_PARAMS = ['focus', 't', 'a', 'b']

const FOCUS_KINDS_WITH_ID = ['audio', 'video', 'comment', 'take', 'marker']
const FOCUS_SECTIONS = ['lyrics', 'media', 'comments']

/** Path interno + query ordinata; omette valori null/undefined/''. */
export function buildSharePath(path, params = {}) {
  const keys = Object.keys(params)
    .filter((k) => params[k] !== null && params[k] !== undefined && params[k] !== '')
    .sort()
  if (!keys.length) return path
  const qs = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(params[k]))}`).join('&')
  return `${path}?${qs}`
}

/** URL assoluto. base = import.meta.env.BASE_URL (es. '/band/'), con o senza '/' finale. */
export function shareUrl(path, params, { origin, base = '/' }) {
  const b = base.endsWith('/') ? base : base + '/'
  const rel = buildSharePath(path, params).replace(/^\/+/, '')
  return origin.replace(/\/+$/, '') + b + rel
}

/** 'comment-12' → { kind:'comment', id:12 }; 'lyrics' → { kind:'lyrics' }; altro → null */
export function parseFocus(value) {
  if (typeof value !== 'string' || !value) return null
  if (FOCUS_SECTIONS.includes(value)) return { kind: value }
  const m = /^([a-z]+)-(\d{1,10})$/.exec(value)
  if (!m || !FOCUS_KINDS_WITH_ID.includes(m[1])) return null
  const id = Number(m[2])
  return id > 0 ? { kind: m[1], id } : null
}

/** Valore di data-share-id per un focus. */
export function focusKey(focus) {
  if (!focus) return null
  return focus.id ? `${focus.kind}-${focus.id}` : focus.kind
}

/** Millisecondi interi ≥ 0, altrimenti null. */
export function parseTime(value) {
  if (value === null || value === undefined || value === '') return null
  if (!/^\d{1,9}$/.test(String(value))) return null
  return Number(value)
}

/** { a, b } se entrambi validi e b > a, altrimenti null. */
export function parseLoop(a, b) {
  const pa = parseTime(a)
  const pb = parseTime(b)
  if (pa === null || pb === null || pb <= pa) return null
  return { a: pa, b: pb }
}

/** value se compreso in allowed, altrimenti null. */
export function pickKey(value, allowed) {
  return typeof value === 'string' && allowed.includes(value) ? value : null
}

/**
 * Destinazione dopo il login: solo percorsi interni dell'app.
 * Rifiuta '//host', '/\\host', schemi (javascript:, https:), caratteri di controllo e /login.
 */
export function safeNext(value) {
  if (typeof value !== 'string' || !value) return null
  if (value.length > 2000) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//') || value.startsWith('/\\')) return null
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null
  const pathOnly = value.split(/[?#]/)[0]
  if (pathOnly.includes(':')) return null
  if (pathOnly === '/login' || pathOnly.startsWith('/login/')) return null
  return value
}

const q = (s) => `«${s}»`

/**
 * Testo descrittivo per la condivisione. Solo dati già visibili ai membri.
 * kind: section | studioSection | song | songPart | audio | video | comment |
 *       project | projectTab | take | marker | takeComment
 */
export function shareText(kind, ctx = {}) {
  let text
  const song = ctx.title ? (ctx.artist ? `${q(ctx.title)} – ${ctx.artist}` : q(ctx.title)) : ''
  switch (kind) {
    case 'section':
      text = `Repertorio · ${ctx.label}`
      break
    case 'studioSection':
      text = `Prove · ${ctx.label}`
      break
    case 'song':
      text = song
      break
    case 'songPart':
      text = `${song} · ${ctx.label}`
      break
    case 'audio':
      text = `${song} · audio ${q(ctx.item)}`
      break
    case 'video':
      text = `${song} · video ${q(ctx.item)}`
      break
    case 'comment':
      text = `Commento di ${ctx.author} su ${song}`
      break
    case 'project':
      text = `Prove · ${q(ctx.title)}`
      break
    case 'projectTab':
      text = `Prove · ${q(ctx.title)} · ${ctx.label}`
      break
    case 'take': {
      text = `${q(ctx.item)} (brano di prova ${q(ctx.title)})`
      if (ctx.loop) text += ` loop ${formatClock(ctx.loop.a)}–${formatClock(ctx.loop.b)}`
      else if (ctx.time) text += ` da ${formatClock(ctx.time)}`
      break
    }
    case 'marker':
      text = `Marker ${q(ctx.item)} a ${formatClock(ctx.time)} in ${q(ctx.title)}`
      break
    case 'takeComment':
      text = `Commento di ${ctx.author} su ${q(ctx.title)}`
      break
    default:
      text = ctx.title ? q(ctx.title) : ''
  }
  if (ctx.bandName) text = text ? `${text} · ${ctx.bandName}` : ctx.bandName
  return text
}
