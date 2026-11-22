// Test del motore dei temi. Esecuzione: node --test tests/frontend/theme.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildVars, contrastFailures, normalizeTheme, resolvePreset, patchTheme, serializeVars, parseVars,
  resolveAccent, contrast, hexToRgb, rgbToHex, rgbToOklch, oklchToRgb,
} from '../../frontend/src/lib/theme.js'
import { TAILWIND, STEPS, PRESET_IDS, ACCENTS, DEFAULT_THEME } from '../../frontend/src/lib/themePresets.js'

test('Sala prove senza personalizzazioni = palette Tailwind attuale', () => {
  const { vars, meta } = buildVars(DEFAULT_THEME)
  const families = { gray: 'gray', brand: 'purple', red: 'red', green: 'green', amber: 'amber', yellow: 'yellow', blue: 'blue', sky: 'sky' }
  for (const [family, tw] of Object.entries(families)) {
    STEPS.forEach((s, i) => {
      assert.equal(vars[`--${family}-${s}`], hexToRgb(TAILWIND[tw][i]).join(' '), `${family}-${s}`)
    })
  }
  assert.equal(vars['--ink'], '255 255 255')
  assert.equal(vars['--on-accent'], '255 255 255')
  assert.equal(meta.mode, 'dark')
  assert.equal(meta.themeColor, '#030712')
})

test('ogni preset, con contrasto normale e alto, rispetta le soglie AA', () => {
  for (const preset of PRESET_IDS) {
    for (const c of ['normal', 'high']) {
      const { palette, meta } = buildVars({ preset, contrast: c })
      assert.deepEqual(contrastFailures(palette, meta.onAccent), [], `${preset}/${c}`)
    }
  }
})

test('200 personalizzazioni casuali restano leggibili', () => {
  let seed = 42
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  for (let i = 0; i < 200; i++) {
    const theme = {
      preset: PRESET_IDS[Math.floor(rnd() * PRESET_IDS.length)],
      accent: rgbToHex([rnd() * 255, rnd() * 255, rnd() * 255]),
      tint: { hue: Math.floor(rnd() * 361), amount: Math.floor(rnd() * 101) },
      contrast: rnd() < 0.5 ? 'normal' : 'high',
    }
    const { palette, meta } = buildVars(theme)
    assert.deepEqual(contrastFailures(palette, meta.onAccent), [], JSON.stringify(theme))
  }
})

test('accenti pronti: tutti leggibili su ogni preset', () => {
  for (const preset of PRESET_IDS) {
    for (const { hex } of ACCENTS) {
      const { palette, meta } = buildVars({ preset, accent: hex })
      assert.deepEqual(contrastFailures(palette, meta.onAccent), [], `${preset} ${hex}`)
    }
  }
})

test('accento a contrasto insufficiente: corretto e segnalato', () => {
  const r = resolveAccent('#ff4d4d') // rosso medio: né bianco né scuro bastano
  assert.equal(r.adjusted, true)
  assert.ok(contrast(r.onAccent, r.rgb) >= 4.5)
  const { meta } = buildVars({ preset: 'spartito', accent: '#ff4d4d' })
  assert.equal(meta.accentAdjusted, true)
})

test('accento chiaro (giallo): testo scuro sui pulsanti, nessuna correzione', () => {
  const r = resolveAccent('#facc15')
  assert.equal(r.adjusted, false)
  assert.ok(r.onAccent.every((c) => c < 50))
  assert.equal(rgbToHex(r.rgb), '#facc15')
})

test('accento scuro: invariato con testo bianco', () => {
  const r = resolveAccent('#1d4ed8')
  assert.equal(r.adjusted, false)
  assert.deepEqual(r.onAccent, [255, 255, 255])
})

test('temi chiari: sfondo chiaro, testo scuro, stati scuri leggibili', () => {
  for (const preset of ['spartito', 'giorno']) {
    const { vars, meta } = buildVars({ preset })
    assert.equal(meta.mode, 'light')
    const bg = vars['--gray-950'].split(' ').map(Number)
    const ink = vars['--ink'].split(' ').map(Number)
    assert.ok(contrast(ink, bg) >= 12, preset)
    assert.ok(bg.every((c) => c > 200))
  }
})

test('normalizeTheme scarta valori sporchi e chiavi sconosciute', () => {
  assert.deepEqual(normalizeTheme(null), DEFAULT_THEME)
  assert.deepEqual(normalizeTheme('x'), DEFAULT_THEME)
  const t = normalizeTheme({
    preset: 'boh', accent: 'red', tint: { hue: 400, amount: 10 }, contrast: 'max',
    font: 'comic', scale: 95, radius: 'tondo', extra: 1,
  })
  assert.deepEqual(t, DEFAULT_THEME)
  const ok = normalizeTheme({ preset: 'auto', accent: '#ABCDEF', tint: { hue: 360, amount: 0 }, contrast: 'high', font: 'literata', scale: 125, radius: 'round' })
  assert.equal(ok.preset, 'auto')
  assert.equal(ok.accent, '#abcdef')
  assert.deepEqual(ok.tint, { hue: 360, amount: 0 })
  assert.equal(ok.scale, 125)
  assert.equal('extra' in normalizeTheme({ extra: 1 }), false)
})

test('Automatico segue il sistema', () => {
  assert.equal(resolvePreset({ preset: 'auto' }, true), 'sala')
  assert.equal(resolvePreset({ preset: 'auto' }, false), 'giorno')
  assert.equal(resolvePreset({ preset: 'palco' }, false), 'palco')
  assert.equal(buildVars({ preset: 'auto' }, { prefersDark: false }).meta.mode, 'light')
})

test('cambiare preset azzera accento e tinta, non testo e forme', () => {
  const t = { ...DEFAULT_THEME, accent: '#16a34a', tint: { hue: 10, amount: 50 }, font: 'barlow', scale: 112, radius: 'round' }
  const n = patchTheme(t, { preset: 'palco' })
  assert.equal(n.accent, null)
  assert.equal(n.tint, null)
  assert.equal(n.font, 'barlow')
  assert.equal(n.scale, 112)
  assert.equal(n.radius, 'round')
  assert.equal(patchTheme(t, { font: 'system' }).accent, '#16a34a')
})

test('testo e forme diventano variabili', () => {
  const { vars } = buildVars({ font: 'atkinson', scale: 90, radius: 'square' })
  assert.match(vars['--font-sans'], /Atkinson Hyperlegible/)
  assert.equal(vars['--root-size'], '90%')
  assert.equal(vars['--radius-sm'], '0rem')
  assert.equal(vars['--radius-xl'], '0.25rem')
})

test('serializeVars / parseVars reversibili', () => {
  const { vars } = buildVars({ preset: 'valvole', font: 'literata' })
  assert.deepEqual(parseVars(serializeVars(vars)), vars)
})

test('OKLCH andata e ritorno', () => {
  for (const hex of ['#9333ea', '#030712', '#f87171', '#ffffff', '#000000']) {
    assert.equal(rgbToHex(oklchToRgb(...rgbToOklch(hexToRgb(hex)))), hex)
  }
})

test('index.css: i valori di partenza coincidono con il tema predefinito', async () => {
  const { readFile } = await import('node:fs/promises')
  const css = await readFile(new URL('../../frontend/src/index.css', import.meta.url), 'utf8')
  const { vars } = buildVars(DEFAULT_THEME)
  for (const [k, v] of Object.entries(vars)) {
    assert.ok(css.includes(`${k}: ${v};`), `${k} non allineata in index.css`)
  }
})
