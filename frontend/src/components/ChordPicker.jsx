import { useState } from 'react'
import { X } from 'lucide-react'
import { normalizeChord } from '../lib/chordpro'

const ROOTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const ACCIDENTALS = [
  { value: '', label: '♮' },
  { value: '#', label: '♯' },
  { value: 'b', label: '♭' },
]
const QUALITIES = [
  { value: '', label: 'magg.' },
  { value: 'm', label: 'm' },
  { value: '7', label: '7' },
  { value: 'm7', label: 'm7' },
  { value: 'maj7', label: 'maj7' },
  { value: 'sus4', label: 'sus4' },
  { value: 'sus2', label: 'sus2' },
  { value: 'dim', label: 'dim' },
  { value: 'aug', label: 'aug' },
  { value: 'add9', label: 'add9' },
  { value: '6', label: '6' },
  { value: '9', label: '9' },
]

// Scompone un accordo esistente nei pezzi del selettore; ciò che non rientra va nel campo libero
function decompose(chord) {
  const empty = { root: '', acc: '', quality: '', bass: '', bassAcc: '', free: '' }
  if (!chord) return empty
  const m = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/.exec(chord)
  if (!m || !QUALITIES.some((q) => q.value === m[3])) return { ...empty, free: chord }
  return { root: m[1], acc: m[2], quality: m[3], bass: m[4] || '', bassAcc: m[5] || '', free: '' }
}

/** Selettore di un accordo in notazione anglosassone. onPick(accordo) oppure onPick(null) per toglierlo. */
export default function ChordPicker({ current, used = [], word, onPick, onClose }) {
  const [s, setS] = useState(() => decompose(current))
  const set = (patch) => setS((prev) => ({ ...prev, ...patch, free: '' }))

  const built = s.root ? s.root + s.acc + s.quality + (s.bass ? '/' + s.bass + s.bassAcc : '') : ''
  const freeChord = s.free.trim() ? normalizeChord(s.free) : null
  const chord = s.free.trim() ? freeChord : normalizeChord(built)
  const freeInvalid = s.free.trim() !== '' && freeChord === null

  const chip = (active) =>
    `h-11 rounded-xl text-sm font-semibold transition-colors ${
      active ? 'bg-amber-500 text-gray-950' : 'bg-gray-800 text-gray-200 active:bg-gray-700'
    }`

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[92vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl p-4 space-y-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-500 truncate">
              Accordo{word ? <> su «<span className="text-gray-300">{word}</span>»</> : ''}
            </p>
            <p className={`text-2xl font-bold ${chord ? 'text-amber-400' : 'text-gray-600'}`}>{chord || '—'}</p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-gray-200" aria-label="Chiudi">
            <X className="w-5 h-5" />
          </button>
        </div>

        {used.length > 0 && (
          <div>
            <p className="text-[11px] text-gray-500 mb-1">Già usati nel brano</p>
            <div className="flex flex-wrap gap-2">
              {used.map((c) => (
                <button
                  key={c}
                  onClick={() => onPick(c)}
                  className="px-3 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-sm font-semibold active:bg-amber-500/30"
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-7 gap-1.5">
          {ROOTS.map((r) => (
            <button key={r} onClick={() => set({ root: r })} className={chip(s.root === r && !s.free)}>
              {r}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {ACCIDENTALS.map((a) => (
            <button key={a.label} onClick={() => set({ acc: a.value })} className={chip(s.acc === a.value && !s.free)}>
              {a.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {QUALITIES.map((q) => (
            <button key={q.label} onClick={() => set({ quality: q.value })} className={chip(s.quality === q.value && !s.free)}>
              {q.label}
            </button>
          ))}
        </div>

        <div>
          <p className="text-[11px] text-gray-500 mb-1">Basso (facoltativo, es. D/F#)</p>
          <div className="grid grid-cols-8 gap-1.5">
            <button onClick={() => set({ bass: '', bassAcc: '' })} className={chip(s.bass === '' && !s.free)}>
              —
            </button>
            {ROOTS.map((r) => (
              <button key={r} onClick={() => set({ bass: r })} className={chip(s.bass === r && !s.free)}>
                {r}
              </button>
            ))}
          </div>
          {s.bass && (
            <div className="grid grid-cols-3 gap-1.5 mt-1.5">
              {ACCIDENTALS.map((a) => (
                <button key={a.label} onClick={() => set({ bassAcc: a.value })} className={chip(s.bassAcc === a.value && !s.free)}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <input
            type="text"
            value={s.free}
            onChange={(e) => setS((prev) => ({ ...prev, free: e.target.value }))}
            placeholder="Oppure scrivilo: C7sus4, Lam, Sol/Si…"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 text-base"
          />
          {freeInvalid && <p className="text-red-400 text-xs mt-1">Accordo non riconosciuto</p>}
        </div>

        <div className="flex gap-2 pt-1">
          {current && (
            <button
              onClick={() => onPick(null)}
              className="flex-1 h-12 rounded-xl bg-gray-800 text-red-400 text-sm font-semibold active:bg-gray-700"
            >
              Togli accordo
            </button>
          )}
          <button
            onClick={() => chord && onPick(chord)}
            disabled={!chord}
            className="flex-1 h-12 rounded-xl bg-brand-600 hover:bg-brand-700 text-on-accent text-sm font-semibold disabled:opacity-40"
          >
            Conferma
          </button>
        </div>
      </div>
    </div>
  )
}
