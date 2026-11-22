import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Loader2, Moon, Music, RotateCcw, Sun } from 'lucide-react'
import AppHeader from '../components/ui/AppHeader'
import { useTheme } from '../context/ThemeContext'
import { ACCENTS, FONTS, FONT_IDS, PRESETS, PRESET_IDS, RADII, RADIUS_IDS, SCALES, AUTO_DARK, AUTO_LIGHT } from '../lib/themePresets'
import { loadFont, prefersDark, themeStyle } from '../lib/themeRuntime'

/** Frecce e Home/Fine dentro un gruppo di opzioni (role="radiogroup"). */
function onRadioKeys(e, values, current, select) {
  const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
  let i = values.indexOf(current)
  if (e.key in keys) i = (i + keys[e.key] + values.length) % values.length
  else if (e.key === 'Home') i = 0
  else if (e.key === 'End') i = values.length - 1
  else return
  e.preventDefault()
  select(values[i])
  const group = e.currentTarget
  requestAnimationFrame(() => group.querySelector('[aria-checked="true"]')?.focus())
}

const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950'

/** Miniatura di un tema: componenti veri dell'app disegnati con le variabili di quel preset. */
function PresetTile({ id, theme, active, onSelect }) {
  const p = PRESETS[id]
  const style = themeStyle({ ...theme, preset: id, accent: null, tint: null }, p.mode === 'dark')
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      tabIndex={active ? 0 : -1}
      onClick={() => onSelect(id)}
      data-preset={id}
      className={`flex flex-col justify-start text-left rounded-2xl p-1 transition-shadow ${focusRing} ${
        active ? 'ring-2 ring-brand-500' : 'ring-1 ring-gray-800 hover:ring-gray-600'
      }`}
    >
      <div style={style} className="font-sans rounded-xl overflow-hidden bg-gray-950 p-2 space-y-2" aria-hidden>
        <div className="flex items-center gap-2 rounded-lg bg-gray-900 border border-gray-800 p-1.5">
          <div className="w-8 h-8 rounded-md bg-brand-600 flex items-center justify-center flex-shrink-0">
            <Music className="w-4 h-4 text-on-accent" />
          </div>
          <div className="min-w-0">
            <p className="text-white text-xs font-semibold truncate leading-tight">Nuova canzone</p>
            <p className="text-gray-400 text-[10px] truncate leading-tight">In scaletta</p>
          </div>
        </div>
        <div className="px-1 leading-tight">
          <p className="font-mono text-[10px] font-bold text-brand-400 whitespace-pre">Am      F     C</p>
          <p className="text-[11px] text-gray-200 truncate">Suoniamo ancora stasera</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="flex-1 text-center rounded-md bg-brand-600 text-on-accent text-[10px] font-semibold py-1">Prova</span>
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="w-2 h-2 rounded-full bg-red-500" />
        </div>
      </div>
      <div className="flex items-start gap-1 px-1.5 pt-2 pb-1">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white leading-tight">{p.label}</p>
          <p className="text-xs text-gray-500 leading-snug mt-0.5">{p.description}</p>
        </div>
        {active && <Check className="w-4 h-4 text-brand-400 flex-shrink-0 mt-0.5" />}
      </div>
    </button>
  )
}

/** Gruppo di opzioni a segmenti con semantica radio. */
function Choice({ label, options, value, onChange, testid }) {
  const values = options.map((o) => o.value)
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-testid={testid}
      onKeyDown={(e) => onRadioKeys(e, values, value, onChange)}
      className="flex p-1 rounded-xl bg-gray-800"
    >
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            data-value={o.value}
            className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 px-1 py-2 rounded-lg text-sm transition-colors ${focusRing} ${
              active ? 'bg-brand-600 text-on-accent font-medium' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {o.icon}
            <span className="truncate max-w-full">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="space-y-4">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, hint, children }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-gray-300">{label}</p>
        {hint}
      </div>
      {children}
    </div>
  )
}

function SaveStatus({ state, onRetry }) {
  if (state === 'saving') return <span className="flex items-center gap-1 text-xs text-gray-500"><Loader2 className="w-3 h-3 animate-spin" />Salvataggio</span>
  if (state === 'saved') return <span className="flex items-center gap-1 text-xs text-gray-500" data-testid="theme-saved"><Check className="w-3 h-3" />Salvato</span>
  if (state === 'error') {
    return (
      <button onClick={onRetry} className="text-xs text-red-400 underline underline-offset-2">
        Non salvato. Riprova
      </button>
    )
  }
  return null
}

const RADIUS_ICONS = {
  square: <span className="w-4 h-4 border-2 border-current" style={{ borderRadius: 1 }} />,
  soft: <span className="w-4 h-4 border-2 border-current" style={{ borderRadius: 4 }} />,
  round: <span className="w-4 h-4 border-2 border-current" style={{ borderRadius: 8 }} />,
}

export default function Appearance() {
  const navigate = useNavigate()
  const { theme, meta, setTheme, resetTheme, saveState, retry } = useTheme()
  const colorInput = useRef(null)

  // Le anteprime dei caratteri si vedono nel carattere stesso
  useEffect(() => {
    FONT_IDS.forEach(loadFont)
  }, [])

  const isAuto = theme.preset === 'auto'
  const presetValues = [...PRESET_IDS, 'auto']
  const activeAccent = theme.accent
  const presetAccent = PRESETS[meta?.presetId || 'sala'].accent
  const tint = theme.tint || PRESETS[meta?.presetId || 'sala'].tint

  return (
    <div className="min-h-screen pb-24">
      <AppHeader
        title="Aspetto"
        sticky
        onBack={() => navigate(-1)}
        actions={<SaveStatus state={saveState} onRetry={retry} />}
      />

      <div className="p-4 space-y-8 max-w-2xl mx-auto">
        <Section title="Tema">
          <div
            role="radiogroup"
            aria-label="Tema"
            data-testid="preset-gallery"
            onKeyDown={(e) => onRadioKeys(e, presetValues, theme.preset, (preset) => setTheme({ preset }))}
            className="space-y-3"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {PRESET_IDS.map((id) => (
                <PresetTile key={id} id={id} theme={theme} active={theme.preset === id} onSelect={(preset) => setTheme({ preset })} />
              ))}
            </div>
            <button
              type="button"
              role="radio"
              aria-checked={isAuto}
              tabIndex={isAuto ? 0 : -1}
              data-preset="auto"
              onClick={() => setTheme({ preset: 'auto' })}
              className={`w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left ${focusRing} ${
                isAuto ? 'ring-2 ring-brand-500 bg-gray-900' : 'ring-1 ring-gray-800 hover:ring-gray-600'
              }`}
            >
              <span className="flex -space-x-1 text-gray-400" aria-hidden>
                <Moon className="w-5 h-5" />
                <Sun className="w-5 h-5" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-white">Automatico</span>
                <span className="block text-xs text-gray-500">
                  {PRESETS[AUTO_DARK].label} di sera, {PRESETS[AUTO_LIGHT].label} di giorno: segue il sistema
                  {isAuto && ` (ora ${prefersDark() ? 'scuro' : 'chiaro'})`}
                </span>
              </span>
              {isAuto && <Check className="w-4 h-4 text-brand-400 flex-shrink-0" />}
            </button>
          </div>
        </Section>

        <Section title="Colori">
          <Field
            label="Accento"
            hint={meta?.accentAdjusted && <span className="text-xs text-amber-400">Scurito per restare leggibile</span>}
          >
            <div
              role="radiogroup"
              aria-label="Colore d'accento"
              data-testid="accent-group"
              onKeyDown={(e) => onRadioKeys(e, [null, ...ACCENTS.map((a) => a.hex)], activeAccent, (accent) => setTheme({ accent }))}
              className="flex flex-wrap gap-2"
            >
              <button
                type="button"
                role="radio"
                aria-checked={activeAccent === null}
                tabIndex={activeAccent === null ? 0 : -1}
                aria-label="Colore del tema"
                title="Colore del tema"
                onClick={() => setTheme({ accent: null })}
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 border-dashed ${focusRing} ${
                  activeAccent === null ? 'border-white' : 'border-gray-600'
                }`}
              >
                <span className="w-6 h-6 rounded-full" style={{ background: presetAccent }} />
              </button>
              {ACCENTS.map((a) => {
                const active = activeAccent === a.hex
                return (
                  <button
                    key={a.hex}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    aria-label={a.label}
                    title={a.label}
                    onClick={() => setTheme({ accent: a.hex })}
                    style={{ background: a.hex }}
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${focusRing} ${
                      active ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-950' : ''
                    }`}
                  >
                    {active && <Check className="w-4 h-4 text-on-solid drop-shadow" />}
                  </button>
                )
              })}
              <label
                className={`relative w-10 h-10 rounded-full flex items-center justify-center cursor-pointer border-2 focus-within:ring-2 focus-within:ring-brand-400 ${
                  activeAccent && !ACCENTS.some((a) => a.hex === activeAccent) ? 'border-white' : 'border-gray-600'
                }`}
                title="Colore libero"
                style={{ background: 'conic-gradient(#f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)' }}
              >
                <span className="sr-only">Colore libero</span>
                <input
                  ref={colorInput}
                  type="color"
                  data-testid="accent-custom"
                  value={activeAccent || presetAccent}
                  onChange={(e) => setTheme({ accent: e.target.value })}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </label>
            </div>
          </Field>

          <Field
            label="Tinta dello sfondo"
            hint={theme.tint && (
              <button onClick={() => setTheme({ tint: null })} className="text-xs text-brand-400 hover:text-brand-300">
                Usa quella del tema
              </button>
            )}
          >
            <div className="space-y-3 rounded-xl bg-gray-900 border border-gray-800 p-3">
              <label className="block">
                <span className="text-xs text-gray-500">Tonalità</span>
                <input
                  type="range" min="0" max="360" step="1"
                  value={tint.hue}
                  data-testid="tint-hue"
                  onChange={(e) => setTheme({ tint: { hue: Number(e.target.value), amount: tint.amount } })}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer mt-1 accent-brand-500"
                  style={{ background: 'linear-gradient(to right, hsl(0 60% 50%), hsl(60 60% 50%), hsl(120 60% 50%), hsl(180 60% 50%), hsl(240 60% 50%), hsl(300 60% 50%), hsl(360 60% 50%))' }}
                />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Intensità: {tint.amount === 0 ? 'neutro' : `${tint.amount}%`}</span>
                <input
                  type="range" min="0" max="100" step="1"
                  value={tint.amount}
                  data-testid="tint-amount"
                  onChange={(e) => setTheme({ tint: { hue: tint.hue, amount: Number(e.target.value) } })}
                  className="w-full mt-1 accent-brand-500"
                />
              </label>
            </div>
          </Field>

          <Field label="Contrasto">
            <Choice
              label="Contrasto"
              testid="contrast-group"
              value={theme.contrast}
              onChange={(contrast) => setTheme({ contrast })}
              options={[{ value: 'normal', label: 'Normale' }, { value: 'high', label: 'Alto' }]}
            />
          </Field>
        </Section>

        <Section title="Testo e forme">
          <Field label="Carattere">
            <div
              role="radiogroup"
              aria-label="Carattere"
              data-testid="font-group"
              onKeyDown={(e) => onRadioKeys(e, FONT_IDS, theme.font, (font) => setTheme({ font }))}
              className="rounded-xl bg-gray-900 border border-gray-800 divide-y divide-gray-800 overflow-hidden"
            >
              {FONT_IDS.map((id) => {
                const f = FONTS[id]
                const active = theme.font === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    data-value={id}
                    onClick={() => setTheme({ font: id })}
                    className={`w-full flex items-center gap-3 px-3 py-3 text-left ${focusRing} ${active ? 'bg-gray-800' : 'hover:bg-gray-800/50'}`}
                  >
                    <span className="text-2xl w-10 text-center text-white" style={{ fontFamily: f.stack }} aria-hidden>Aa</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-white" style={{ fontFamily: f.stack }}>{f.label}</span>
                      <span className="block text-xs text-gray-500">{f.note}</span>
                    </span>
                    {active && <Check className="w-4 h-4 text-brand-400 flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          </Field>

          <Field label="Dimensione del testo">
            <Choice
              label="Dimensione del testo"
              testid="scale-group"
              value={theme.scale}
              onChange={(scale) => setTheme({ scale })}
              options={SCALES.map((s, i) => ({
                value: s.value,
                label: s.label,
                icon: <span aria-hidden className="font-semibold leading-none" style={{ fontSize: `${12 + i * 3}px` }}>A</span>,
              }))}
            />
          </Field>

          <Field label="Angoli">
            <Choice
              label="Angoli"
              testid="radius-group"
              value={theme.radius}
              onChange={(radius) => setTheme({ radius })}
              options={RADIUS_IDS.map((id) => ({ value: id, label: RADII[id].label, icon: RADIUS_ICONS[id] }))}
            />
          </Field>
        </Section>

        <button
          onClick={resetTheme}
          className={`flex items-center gap-2 text-sm text-gray-400 hover:text-gray-200 ${focusRing} rounded-lg`}
        >
          <RotateCcw className="w-4 h-4" />
          Ripristina il tema
        </button>
      </div>
    </div>
  )
}
