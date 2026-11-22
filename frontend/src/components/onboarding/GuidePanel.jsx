import { useState } from 'react'
import { Check, ChevronDown, PartyPopper, X } from 'lucide-react'
import { GROUPS, STEPS, isComplete, progress } from '../../lib/onboarding'
import { VERSION } from '../../version'

function Bar({ percent }) {
  return (
    <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
      <div className="h-full bg-brand-500 transition-all" style={{ width: `${percent}%` }} />
    </div>
  )
}

/** Lista dei passi con avanzamento: ogni passo si spunta da solo; "Mostrami" porta alla pagina e lo evidenzia. */
export default function GuidePanel({ state, initialGroup, onClose, onShow, onSkip, onRestart, onNotApplicable }) {
  const [openGroup, setOpenGroup] = useState(initialGroup)
  const total = progress(state)
  const complete = isComplete(state)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" data-testid="guide-panel" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[88vh] flex flex-col bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-gray-800">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Primi passi</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-200" aria-label="Chiudi la guida" data-testid="guide-close">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <div className="flex-1"><Bar percent={total.percent} /></div>
            <span data-testid="guide-progress" className="text-xs text-gray-400">{total.done}/{total.total}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {complete && (
            <div className="flex items-center gap-3 mx-2 my-2 px-4 py-3 rounded-xl bg-green-900/30 text-green-300 text-sm" data-testid="guide-complete">
              <PartyPopper className="w-5 h-5 flex-shrink-0" />
              Hai completato la guida: ora conosci tutto. Puoi sempre rivederla.
            </div>
          )}
          {GROUPS.map((g) => {
            const p = progress(state, g.id)
            const open = openGroup === g.id
            return (
              <div key={g.id} className="mb-1">
                <button
                  onClick={() => setOpenGroup(open ? null : g.id)}
                  className="flex items-center gap-3 w-full px-2 py-3 text-left"
                  aria-expanded={open}
                >
                  <span className="flex-1 text-sm font-semibold text-gray-200">{g.label}</span>
                  <span className="text-xs text-gray-500">{p.done}/{p.total}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                  <ul className="space-y-1 pb-2">
                    {STEPS.filter((s) => s.group === g.id).map((s) => {
                      const done = !!state.done[s.id]
                      const na = !!state.notApplicable[s.id]
                      return (
                        <li key={s.id} data-step={s.id} data-done={done ? '1' : '0'} className="flex items-start gap-3 px-2 py-2 rounded-xl">
                          <span
                            className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border ${
                              done ? 'bg-green-600 border-green-600 text-on-solid' : 'border-gray-600 text-transparent'
                            }`}
                          >
                            <Check className="w-4 h-4" />
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm ${done || na ? 'text-gray-500' : 'text-gray-100'} ${done ? 'line-through' : ''}`}>{s.label}</p>
                            {!done && !na && (
                              <div className="flex flex-wrap gap-2 mt-1.5">
                                <button
                                  onClick={() => onShow(s.id)}
                                  data-testid={`show-${s.id}`}
                                  className="px-3 py-1.5 rounded-lg bg-brand-600/20 text-brand-300 text-xs font-medium"
                                >
                                  Mostrami
                                </button>
                                {s.optional && (
                                  <button onClick={() => onNotApplicable(s.id)} className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-400 text-xs">
                                    Non mi riguarda
                                  </button>
                                )}
                              </div>
                            )}
                            {na && <p className="text-xs text-gray-600">Non ti riguarda</p>}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-2 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] border-t border-gray-800">
          {!complete && !state.skipped && (
            <button onClick={onSkip} data-testid="guide-skip" className="py-2 px-3 rounded-lg bg-gray-800 text-gray-300 text-xs font-medium">
              Salta la guida
            </button>
          )}
          <button onClick={onRestart} data-testid="guide-restart" className="py-2 px-3 rounded-lg bg-gray-800 text-gray-300 text-xs font-medium">
            Ricomincia
          </button>
          <span className="flex-1 text-right text-[11px] text-gray-600">Versione {VERSION}</span>
        </div>
      </div>
    </div>
  )
}
