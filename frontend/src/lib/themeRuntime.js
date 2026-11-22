// Applicazione del tema al documento: l'unico modulo dei temi che tocca il DOM.
// Lo script inline in index.html legge la stessa cache (band_theme_css) prima del bundle, per evitare lampi.

import { buildVars, normalizeTheme, serializeVars, parseVars } from './theme.js'
import { AUTO_DARK, AUTO_LIGHT } from './themePresets.js'

export const THEME_KEY = 'band_theme'
export const CSS_KEY = 'band_theme_css'
export const THEME_EVENT = 'band:theme'

// Un file per peso, solo latin (copre le lettere accentate italiane). Chunk separati: si scarica solo il carattere scelto.
const FONT_LOADERS = {
  atkinson: () => Promise.all([
    import('@fontsource/atkinson-hyperlegible/latin-400.css'),
    import('@fontsource/atkinson-hyperlegible/latin-700.css'),
  ]),
  barlow: () => Promise.all([
    import('@fontsource/barlow-condensed/latin-400.css'),
    import('@fontsource/barlow-condensed/latin-600.css'),
    import('@fontsource/barlow-condensed/latin-700.css'),
  ]),
  literata: () => Promise.all([
    import('@fontsource/literata/latin-400.css'),
    import('@fontsource/literata/latin-600.css'),
    import('@fontsource/literata/latin-700.css'),
  ]),
}
const loadedFonts = new Set()

export function loadFont(id) {
  const load = FONT_LOADERS[id]
  if (!load || loadedFonts.has(id)) return Promise.resolve()
  loadedFonts.add(id)
  return load().catch(() => loadedFonts.delete(id)) // offline al primo uso: resta il carattere di sistema
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function prefersDark() {
  try {
    return window.matchMedia(DARK_QUERY).matches
  } catch {
    return true
  }
}

function storage(fn) {
  try {
    return fn(window.localStorage)
  } catch {
    return null
  }
}

/** Tema salvato su questo dispositivo (ultimo usato), normalizzato. */
export function readCachedTheme() {
  const raw = storage((s) => s.getItem(THEME_KEY))
  try {
    return normalizeTheme(raw ? JSON.parse(raw) : null)
  } catch {
    return normalizeTheme(null)
  }
}

function writeToDocument(vars, meta) {
  const root = document.documentElement
  // setProperty e non cssText: su <html> vivono anche altre variabili (es. --swipe-progress)
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  root.style.colorScheme = meta.mode
  root.dataset.mode = meta.mode
  root.dataset.theme = meta.presetId
  let tag = document.querySelector('meta[name="theme-color"]')
  if (!tag) {
    tag = document.createElement('meta')
    tag.name = 'theme-color'
    document.head.appendChild(tag)
  }
  tag.content = meta.themeColor
}

function cacheEntry(theme, dark) {
  const { vars, meta } = buildVars(theme, { prefersDark: dark })
  return { css: serializeVars(vars), mode: meta.mode, color: meta.themeColor, preset: meta.presetId }
}

let mql = null
let currentTheme = null

function onSystemChange() {
  if (currentTheme?.preset === 'auto') applyTheme(currentTheme)
}

/** Applica il tema al documento, aggiorna la cache del dispositivo ed emette `band:theme`. Restituisce meta. */
export function applyTheme(rawTheme) {
  const theme = normalizeTheme(rawTheme)
  currentTheme = theme
  const dark = prefersDark()
  const { vars, meta } = buildVars(theme, { prefersDark: dark })
  writeToDocument(vars, meta)
  loadFont(theme.font)

  // Cache per lo script anti-lampo: con Automatico servono entrambe le varianti
  const cache = theme.preset === 'auto'
    ? { auto: true, dark: cacheEntry({ ...theme, preset: AUTO_DARK }, true), light: cacheEntry({ ...theme, preset: AUTO_LIGHT }, false) }
    : { auto: false, dark: { css: serializeVars(vars), mode: meta.mode, color: meta.themeColor, preset: meta.presetId } }
  storage((s) => {
    s.setItem(THEME_KEY, JSON.stringify(theme))
    s.setItem(CSS_KEY, JSON.stringify(cache))
  })

  if (!mql) {
    try {
      mql = window.matchMedia(DARK_QUERY)
      mql.addEventListener('change', onSystemChange)
    } catch {
      mql = null
    }
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: meta }))
  return meta
}

/** Valore corrente di una variabile colore del tema come [r, g, b] (per canvas). */
export function themeRgb(name, el = document.documentElement) {
  const v = getComputedStyle(el).getPropertyValue(name).trim()
  const parts = v.split(/\s+/).map(Number)
  return parts.length === 3 && parts.every((n) => Number.isFinite(n)) ? parts : [128, 128, 128]
}

export const cssColor = (rgb, alpha = 1) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`

/** Variabili di un tema come oggetto style React (per anteprime con un tema diverso da quello attivo). */
export function themeStyle(theme, dark = prefersDark()) {
  const { vars, meta } = buildVars(theme, { prefersDark: dark })
  return { ...vars, colorScheme: meta.mode }
}

export { parseVars }
