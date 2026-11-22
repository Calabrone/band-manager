// Preset e opzioni dei temi. Dati puri, condivisi da lib/theme.js, dalla pagina Aspetto e dai test.

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

// Palette Tailwind v3 usate oggi dall'app: il tema "Sala prove" le riproduce identiche.
export const TAILWIND = {
  gray: ['#f9fafb', '#f3f4f6', '#e5e7eb', '#d1d5db', '#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937', '#111827', '#030712'],
  purple: ['#faf5ff', '#f3e8ff', '#e9d5ff', '#d8b4fe', '#c084fc', '#a855f7', '#9333ea', '#7e22ce', '#6b21a8', '#581c87', '#3b0764'],
  red: ['#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d', '#450a0a'],
  green: ['#f0fdf4', '#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d', '#052e16'],
  amber: ['#fffbeb', '#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f', '#451a03'],
  yellow: ['#fefce8', '#fef9c3', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04', '#a16207', '#854d0e', '#713f12', '#422006'],
  blue: ['#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a', '#172554'],
  sky: ['#f0f9ff', '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e', '#082f49'],
}

// Famiglie di stato (errore, successo, avviso, info): colore fisso, cambia solo la luminosità nei temi chiari.
export const STATE_FAMILIES = ['red', 'green', 'amber', 'yellow', 'blue', 'sky']

export const PRESETS = {
  sala: {
    label: 'Sala prove',
    description: 'Grigio freddo e viola: l’aspetto di sempre.',
    mode: 'dark',
    bg: '#030712',
    tint: { hue: 264, amount: 30 },
    accent: '#9333ea',
    literal: true, // gray e brand = Tailwind finché non si personalizzano
  },
  palco: {
    label: 'Palco',
    description: 'Nero caldo e magenta, come una gelatina da luci di scena.',
    mode: 'dark',
    bg: '#140e0d',
    tint: { hue: 25, amount: 28 },
    accent: '#d1206a',
  },
  valvole: {
    label: 'Valvole',
    description: 'Verde scuro e arancio, come un amplificatore acceso.',
    mode: 'dark',
    bg: '#0b120d',
    tint: { hue: 150, amount: 24 },
    accent: '#f07a1a',
  },
  mezzanotte: {
    label: 'Mezzanotte',
    description: 'Nero puro: consuma meno batteria sugli schermi OLED.',
    mode: 'dark',
    bg: '#000000',
    tint: { hue: 195, amount: 10 },
    accent: '#14b8a6',
  },
  spartito: {
    label: 'Spartito',
    description: 'Chiaro come la carta, con l’inchiostro blu.',
    mode: 'light',
    bg: '#f2f3f0',
    tint: { hue: 100, amount: 8 },
    accent: '#1d4ed8',
  },
  giorno: {
    label: 'Giorno',
    description: 'Sala prove in versione chiara, per la luce del giorno.',
    mode: 'light',
    bg: '#e8ebf1',
    tint: { hue: 255, amount: 18 },
    accent: '#9333ea',
  },
}

export const PRESET_IDS = Object.keys(PRESETS)
export const THEME_CHOICES = [...PRESET_IDS, 'auto']
export const AUTO_DARK = 'sala'
export const AUTO_LIGHT = 'giorno'

export const ACCENTS = [
  { hex: '#9333ea', label: 'Viola' },
  { hex: '#4f46e5', label: 'Indaco' },
  { hex: '#1d4ed8', label: 'Blu' },
  { hex: '#0e7490', label: 'Petrolio' },
  { hex: '#14b8a6', label: 'Verde acqua' },
  { hex: '#16a34a', label: 'Verde' },
  { hex: '#ca8a04', label: 'Ottone' },
  { hex: '#f07a1a', label: 'Arancio' },
  { hex: '#dc2626', label: 'Rosso' },
  { hex: '#d1206a', label: 'Magenta' },
]

const SYSTEM_STACK = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

export const FONTS = {
  system: { label: 'Sistema', note: 'Il carattere del telefono', stack: SYSTEM_STACK },
  atkinson: { label: 'Atkinson Hyperlegible', note: 'Massima leggibilità', stack: `"Atkinson Hyperlegible", ${SYSTEM_STACK}` },
  barlow: { label: 'Barlow Condensed', note: 'Stretto: più parole per riga', stack: `"Barlow Condensed", ${SYSTEM_STACK}` },
  literata: { label: 'Literata', note: 'Con grazie, per leggere', stack: 'Literata, Georgia, "Times New Roman", serif' },
}
export const FONT_IDS = Object.keys(FONTS)

export const SCALES = [
  { value: 90, label: 'Piccola' },
  { value: 100, label: 'Normale' },
  { value: 112, label: 'Grande' },
  { value: 125, label: 'Molto grande' },
]

// rem per sm, DEFAULT, md, lg, xl, 2xl, 3xl ("soft" = valori Tailwind attuali)
export const RADII = {
  square: { label: 'Squadrati', values: [0, 0.125, 0.125, 0.1875, 0.25, 0.3125, 0.375] },
  soft: { label: 'Morbidi', values: [0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5] },
  round: { label: 'Arrotondati', values: [0.25, 0.375, 0.5, 0.75, 1.125, 1.5, 2] },
}
export const RADIUS_KEYS = ['sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl', '3xl']
export const RADIUS_IDS = Object.keys(RADII)

export const DEFAULT_THEME = Object.freeze({
  v: 1,
  preset: 'sala',
  accent: null,
  tint: null,
  contrast: 'normal',
  font: 'system',
  scale: 100,
  radius: 'soft',
})
