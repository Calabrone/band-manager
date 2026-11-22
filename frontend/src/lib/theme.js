// Motore dei temi: dalla configurazione dell'utente alle variabili CSS. Puro (niente DOM), testato.
//
// Le palette Tailwind (gray, brand, red, …) sono variabili `--<famiglia>-<gradino>` in formato "R G B".
// La luminosità di ogni gradino dipende dal RUOLO che ha nell'app (testo forte, testo secondario,
// pulsante pieno, superficie, sfondo), così i temi chiari funzionano senza toccare le classi.

import {
  STEPS, TAILWIND, STATE_FAMILIES, PRESETS, PRESET_IDS, THEME_CHOICES, AUTO_DARK, AUTO_LIGHT,
  FONTS, FONT_IDS, SCALES, RADII, RADIUS_KEYS, RADIUS_IDS, DEFAULT_THEME,
} from './themePresets.js'

// ── Colore ──────────────────────────────────────────────────────────────────

export function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')
}

const toLinear = (c) => {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
}
const fromLinear = (x) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)

export function rgbToOklch(rgb) {
  const [r, g, b] = rgb.map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.hypot(A, B)
  let H = (Math.atan2(B, A) * 180) / Math.PI
  if (H < 0) H += 360
  return [L, C, H]
}

function oklchToLinear(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180)
  const b = C * Math.sin((H * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

const inGamut = (lin) => lin.every((x) => x >= -0.0005 && x <= 1.0005)

/** OKLCH → RGB 0-255; fuori gamut riduce la croma (mantiene luminosità e tonalità). */
export function oklchToRgb(L, C, H) {
  L = Math.min(1, Math.max(0, L))
  let lin = oklchToLinear(L, C, H)
  if (!inGamut(lin)) {
    let lo = 0
    let hi = C
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(oklchToLinear(L, mid, H))) lo = mid
      else hi = mid
    }
    lin = oklchToLinear(L, lo, H)
  }
  return lin.map((x) => Math.min(255, Math.max(0, Math.round(fromLinear(Math.min(1, Math.max(0, x)))))))
}

export function luminance(rgb) {
  const [r, g, b] = rgb.map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Rapporto di contrasto WCAG tra due colori RGB (1–21). */
export function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// ── Normalizzazione (stesse regole di php-api/src/Theme.php) ─────────────────

const HEX_RE = /^#[0-9a-f]{6}$/i
const clampInt = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null)

export function normalizeTheme(raw) {
  const t = { ...DEFAULT_THEME }
  if (!raw || typeof raw !== 'object') return t
  if (THEME_CHOICES.includes(raw.preset)) t.preset = raw.preset
  if (typeof raw.accent === 'string' && HEX_RE.test(raw.accent)) t.accent = raw.accent.toLowerCase()
  if (raw.tint && typeof raw.tint === 'object') {
    const hue = clampInt(raw.tint.hue, 0, 360)
    const amount = clampInt(raw.tint.amount, 0, 100)
    if (hue !== null && amount !== null) t.tint = { hue, amount }
  }
  if (raw.contrast === 'high' || raw.contrast === 'normal') t.contrast = raw.contrast
  if (FONT_IDS.includes(raw.font)) t.font = raw.font
  if (SCALES.some((s) => s.value === raw.scale)) t.scale = raw.scale
  if (RADIUS_IDS.includes(raw.radius)) t.radius = raw.radius
  return t
}

export function resolvePreset(theme, prefersDark = true) {
  const id = theme?.preset
  if (id === 'auto') return prefersDark ? AUTO_DARK : AUTO_LIGHT
  return PRESET_IDS.includes(id) ? id : DEFAULT_THEME.preset
}

/** Applica una modifica parziale. Cambiare tema predefinito azzera accento e tinta (R2.8). */
export function patchTheme(theme, patch) {
  const next = { ...normalizeTheme(theme), ...patch }
  if (patch.preset !== undefined && patch.preset !== theme?.preset) {
    if (!('accent' in patch)) next.accent = null
    if (!('tint' in patch)) next.tint = null
  }
  return normalizeTheme(next)
}

// ── Scale per ruolo ─────────────────────────────────────────────────────────

// Luminosità OKLCH per gradino (50…950)
const L_GRAY = {
  dark: [0.985, 0.967, 0.925, 0.872, 0.714, 0.551, 0.446, 0.373, 0.278, 0.21, 0.13],
  light: [0.18, 0.22, 0.3, 0.4, 0.48, 0.56, 0.7, 0.86, 0.925, 0.995, 0.96],
}
const L_COLOR = {
  dark: [0.97, 0.94, 0.89, 0.83, 0.75, 0.66, 0.56, 0.49, 0.4, 0.32, 0.25],
  light: [0.3, 0.34, 0.38, 0.44, 0.5, 0.56, 0.5, 0.44, 0.91, 0.945, 0.97],
}
// Quota della croma del colore di partenza per gradino
const C_COLOR = {
  dark: [0.2, 0.35, 0.55, 0.75, 0.9, 1, 1, 0.95, 0.85, 0.7, 0.6],
  light: [0.6, 0.75, 0.85, 0.95, 1, 1, 1, 0.95, 0.4, 0.28, 0.2],
}
const C_GRAY = [0.3, 0.4, 0.5, 0.6, 0.8, 1, 1, 1, 1, 1, 1]
const MAX_TINT_CHROMA = 0.04

// Contrasto alto: testo secondario e bordi più marcati (indici di STEPS → spostamento verso il testo)
const HIGH_SHIFT = { 3: 0.07, 4: 0.07, 5: 0.07, 6: 0.07, 7: 0.06 }

function shiftForContrast(Ls, mode, contrastMode) {
  if (contrastMode !== 'high') return Ls
  const dir = mode === 'dark' ? 1 : -1
  return Ls.map((L, i) => L + dir * (HIGH_SHIFT[i] || 0))
}

function grayScale(mode, tint, bgHex, contrastMode) {
  const Ls = shiftForContrast(L_GRAY[mode], mode, contrastMode)
  const chroma = (tint.amount / 100) * MAX_TINT_CHROMA
  const scale = Ls.map((L, i) => oklchToRgb(L, chroma * C_GRAY[i], tint.hue))
  if (bgHex) scale[10] = hexToRgb(bgHex)
  return scale
}

function colorScale(mode, hex) {
  const [, C, H] = rgbToOklch(hexToRgb(hex))
  return L_COLOR[mode].map((L, i) => oklchToRgb(L, C * C_COLOR[mode][i], H))
}

const literal = (family) => TAILWIND[family].map(hexToRgb)

// ── Accento ─────────────────────────────────────────────────────────────────

const WHITE = [255, 255, 255]
const DARK_TEXT = [17, 17, 22]

/**
 * Colore dei pulsanti pieni (brand-600) e del loro testo.
 * Preferisce il testo bianco; se non basta scurisce un poco l'accento; se servirebbe troppo usa testo scuro
 * (accenti chiari come giallo o verde acqua); altrimenti scurisce finché il bianco passa.
 */
export function resolveAccent(hex) {
  const rgb = hexToRgb(hex)
  if (contrast(WHITE, rgb) >= 4.5) return { rgb, onAccent: WHITE, adjusted: false }
  const [L, C, H] = rgbToOklch(rgb)
  for (let d = 0.02; d <= 0.12 + 1e-9; d += 0.02) {
    const c = oklchToRgb(L - d, C, H)
    if (contrast(WHITE, c) >= 4.5) return { rgb: c, onAccent: WHITE, adjusted: true }
  }
  if (contrast(DARK_TEXT, rgb) >= 4.5) return { rgb, onAccent: DARK_TEXT, adjusted: false }
  for (let d = 0.14; d <= 0.6; d += 0.02) {
    const c = oklchToRgb(L - d, C, H)
    if (contrast(WHITE, c) >= 4.5) return { rgb: c, onAccent: WHITE, adjusted: true }
  }
  return { rgb: oklchToRgb(0.4, C, H), onAccent: WHITE, adjusted: true }
}

function brandScale(mode, hex) {
  const acc = resolveAccent(hex)
  const scale = colorScale(mode, hex)
  const [L, C, H] = rgbToOklch(acc.rgb)
  scale[5] = oklchToRgb(L + 0.07, C, H)
  scale[6] = acc.rgb
  scale[7] = oklchToRgb(L - 0.07, C, H)
  // Con testo scuro sui pulsanti, il 500 (pulsanti secondari) non deve diventare più chiaro del 600
  if (acc.onAccent === DARK_TEXT) scale[5] = acc.rgb
  return { scale, onAccent: acc.onAccent, adjusted: acc.adjusted }
}

// ── Variabili ───────────────────────────────────────────────────────────────

const triple = (rgb) => rgb.join(' ')

/**
 * Configurazione → variabili CSS.
 * @returns {{ vars: Record<string,string>, palette: Record<string,number[][]>, meta: object }}
 */
export function buildVars(rawTheme, { prefersDark = true } = {}) {
  const theme = normalizeTheme(rawTheme)
  const presetId = resolvePreset(theme, prefersDark)
  const p = PRESETS[presetId]
  const mode = p.mode
  const palette = {}

  const grayLiteral = p.literal && !theme.tint && theme.contrast === 'normal'
  palette.gray = grayLiteral ? literal('gray') : grayScale(mode, theme.tint || p.tint, theme.tint ? null : p.bg, theme.contrast)

  let onAccent = WHITE
  let accentAdjusted = false
  if (p.literal && !theme.accent) {
    palette.brand = literal('purple')
  } else {
    const b = brandScale(mode, theme.accent || p.accent)
    palette.brand = b.scale
    onAccent = b.onAccent
    accentAdjusted = theme.accent ? b.adjusted : false
  }

  for (const f of STATE_FAMILIES) {
    palette[f] = mode === 'dark' ? literal(f) : colorScale(mode, TAILWIND[f][5])
  }

  const vars = {}
  for (const [family, scale] of Object.entries(palette)) {
    STEPS.forEach((s, i) => { vars[`--${family}-${s}`] = triple(scale[i]) })
  }
  const ink = mode === 'dark' ? WHITE : palette.gray[0].map((c) => Math.max(0, c - 18))
  vars['--ink'] = triple(ink)
  vars['--on-accent'] = triple(onAccent)
  vars['--on-scrim'] = '255 255 255'
  vars['--scrim'] = '0 0 0'
  vars['--user-l'] = mode === 'dark' ? '62%' : '38%'
  vars['--font-sans'] = FONTS[theme.font].stack
  vars['--root-size'] = `${theme.scale}%`
  RADII[theme.radius].values.forEach((v, i) => { vars[`--radius-${RADIUS_KEYS[i]}`] = `${v}rem` })

  return {
    vars,
    palette,
    meta: {
      presetId,
      mode,
      themeColor: rgbToHex(palette.gray[10]),
      accentAdjusted,
      onAccent,
      font: theme.font,
      theme,
    },
  }
}

export function serializeVars(vars) {
  return Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')
}

export function parseVars(css) {
  const out = {}
  for (const part of css.split(';')) {
    const i = part.indexOf(':')
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1)
  }
  return out
}

// ── Verifica di contrasto (usata dai test e dalla pagina Aspetto) ───────────

const g = (palette, family, step) => palette[family][STEPS.indexOf(step)]

/** Coppie testo/sfondo principali con soglia minima. Restituisce quelle sotto soglia. */
export function contrastFailures(palette, onAccent) {
  const checks = [
    ['gray-100 su gray-950', g(palette, 'gray', 100), g(palette, 'gray', 950), 7],
    ['gray-400 su gray-900', g(palette, 'gray', 400), g(palette, 'gray', 900), 4.5],
    ['gray-500 su gray-900', g(palette, 'gray', 500), g(palette, 'gray', 900), 3],
    ['brand-400 su gray-900', g(palette, 'brand', 400), g(palette, 'gray', 900), 4.5],
    ['on-accent su brand-600', onAccent, g(palette, 'brand', 600), 4.5],
    ['red-400 su gray-900', g(palette, 'red', 400), g(palette, 'gray', 900), 4.5],
    ['green-400 su gray-900', g(palette, 'green', 400), g(palette, 'gray', 900), 4.5],
    ['amber-400 su gray-900', g(palette, 'amber', 400), g(palette, 'gray', 900), 4.5],
  ]
  return checks
    .map(([name, a, b, min]) => ({ name, ratio: contrast(a, b), min }))
    .filter((c) => c.ratio < c.min)
}
