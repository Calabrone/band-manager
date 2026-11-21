// Controllo dei BPM: tasti − / + (tenendo premuto si ripete), campo numerico, slider e Tap tempo.
import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { DEFAULT_BPM } from '../../lib/countin'
import { BPM_MAX, BPM_MIN, clampBpm, tapTempo } from '../../lib/metronome'

const stepBtn = `w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl bg-gray-800 hover:bg-gray-700
                 active:bg-gray-600 text-gray-100 disabled:opacity-40 select-none touch-none`

/**
 * value: BPM o null (solo con `optional`: nessun BPM impostato). onChange riceve un BPM valido (40–300) o null.
 * Con `optional` compare il tasto «Togli» e, a vuoto, «Imposta».
 */
export default function BpmControl({ value, onChange, optional = false, disabled = false }) {
  const [draft, setDraft] = useState(null)   // testo digitato nel campo, finché non si esce
  const valueRef = useRef(value)
  const changeRef = useRef(onChange)
  const tapsRef = useRef([])
  const holdRef = useRef({ timeout: null, interval: null })
  valueRef.current = value
  changeRef.current = onChange

  const stopHold = () => {
    clearTimeout(holdRef.current.timeout)
    clearInterval(holdRef.current.interval)
    holdRef.current = { timeout: null, interval: null }
  }
  useEffect(() => stopHold, [])

  const step = (delta) => changeRef.current(clampBpm((valueRef.current ?? DEFAULT_BPM) + delta))

  function startHold(delta) {
    if (disabled) return
    stopHold()
    step(delta)
    holdRef.current.timeout = setTimeout(() => {
      holdRef.current.interval = setInterval(() => step(delta), 80)
    }, 400)
  }

  function tap() {
    const r = tapTempo(tapsRef.current, performance.now())
    tapsRef.current = r.taps
    if (r.bpm !== null) onChange(r.bpm)
  }

  function commit(text) {
    setDraft(null)
    if (text.trim() === '') {
      if (optional) onChange(null)
      return
    }
    onChange(clampBpm(text))
  }

  if (value === null && optional) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500">Nessun BPM</span>
        <button type="button" disabled={disabled} onClick={() => onChange(DEFAULT_BPM)}
                className="px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm">
          Imposta
        </button>
        <button type="button" disabled={disabled} onClick={tap}
                className="px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm">
          Tap
        </button>
      </div>
    )
  }

  const stop = { onPointerUp: stopHold, onPointerLeave: stopHold, onPointerCancel: stopHold }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" disabled={disabled || value <= BPM_MIN} aria-label="Diminuisci BPM" className={stepBtn}
                onPointerDown={() => startHold(-1)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && step(-1)} {...stop}>
          <Minus className="w-5 h-5" />
        </button>
        <input type="text" inputMode="numeric" aria-label="BPM" disabled={disabled}
               value={draft ?? String(value ?? '')}
               onFocus={(e) => e.target.select()}
               onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
               onBlur={(e) => commit(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
               className="w-20 px-2 py-2 rounded-xl bg-gray-800 border border-gray-700 text-white text-center text-lg font-semibold
                          focus:outline-none focus:border-brand-500" />
        <button type="button" disabled={disabled || value >= BPM_MAX} aria-label="Aumenta BPM" className={stepBtn}
                onPointerDown={() => startHold(1)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && step(1)} {...stop}>
          <Plus className="w-5 h-5" />
        </button>
        <span className="text-xs text-gray-500">BPM</span>
        <button type="button" disabled={disabled} onClick={tap}
                className="ml-auto px-3 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm"
                title="Tocca a ritmo per calcolare i BPM">
          Tap
        </button>
        {optional && (
          <button type="button" disabled={disabled} onClick={() => onChange(null)}
                  className="px-2 py-2 text-xs text-gray-400 hover:text-gray-200">
            Togli
          </button>
        )}
      </div>
      <input type="range" min={BPM_MIN} max={BPM_MAX} step={1} value={value ?? DEFAULT_BPM} disabled={disabled}
             aria-label="Regola i BPM" onChange={(e) => onChange(clampBpm(e.target.value))}
             className="w-full accent-brand-500" />
    </div>
  )
}
