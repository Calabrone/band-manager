import { useState } from 'react'
import { Check, Flag, MessageSquare, Pencil, Trash2, X } from 'lucide-react'
import { citations } from '../../lib/refs'
import { formatTime } from '../../lib/loop'
import { inputCls, userColor } from './ui'

/** Elenco dei marker ordinati per tempo: tocco = salta lì, con i commenti che li citano. */
export default function MarkerList({ markers, comments, userId, onSeek, onUpdate, onDelete, onJumpToComment }) {
  const [editing, setEditing] = useState(null) // { id, label }
  const cited = citations(comments)
  const sorted = [...markers].sort((a, b) => a.time_ms - b.time_ms || a.id - b.id)

  async function saveEdit() {
    const label = editing.label.trim()
    if (!label) return
    await onUpdate(editing.id, label)
    setEditing(null)
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2 mb-2">
        <Flag className="w-4 h-4" /> Marker ({markers.length})
      </h2>
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-600 italic">
          Nessun marker. Tieni premuto (o tocca due volte) sulla timeline per segnare un punto, ad esempio una nota sbagliata.
        </p>
      ) : (
        <ul className="space-y-1">
          {sorted.map((m) => {
            const mine = m.user_id === userId
            const refs = cited.get(m.id) ?? []
            return (
              <li key={m.id} className="flex items-start gap-2 px-3 py-2 rounded-xl bg-gray-900 border border-gray-800">
                <button type="button" onClick={() => onSeek(m)} className="flex items-start gap-2 flex-1 min-w-0 text-left">
                  <span style={{ color: userColor(m.user_id) }} className="text-base leading-5">⚑</span>
                  <span className="font-mono text-xs text-gray-300 leading-5 w-14 flex-shrink-0">{formatTime(m.time_ms)}</span>
                  <span className="min-w-0">
                    {editing?.id === m.id ? null : <span className="block text-sm text-white break-words">{m.label}</span>}
                    <span className="block text-[11px] text-gray-500">{m.username}</span>
                  </span>
                </button>
                {editing?.id === m.id && (
                  <div className="flex-1 flex items-center gap-1">
                    <input value={editing.label} maxLength={80} autoFocus className={inputCls}
                           onChange={(e) => setEditing({ id: m.id, label: e.target.value })}
                           onKeyDown={(e) => e.key === 'Enter' && saveEdit()} />
                    <button type="button" onClick={saveEdit} className="p-1.5 text-green-400"><Check className="w-4 h-4" /></button>
                    <button type="button" onClick={() => setEditing(null)} className="p-1.5 text-gray-400"><X className="w-4 h-4" /></button>
                  </div>
                )}
                {refs.length > 0 && editing?.id !== m.id && (
                  <button type="button" onClick={() => onJumpToComment(refs[0])}
                          className="flex items-center gap-1 text-[11px] text-purple-300 flex-shrink-0 mt-0.5"
                          title="Vai al commento che lo cita">
                    <MessageSquare className="w-3 h-3" />{refs.length}
                  </button>
                )}
                {mine && editing?.id !== m.id && (
                  <div className="flex items-center flex-shrink-0">
                    <button type="button" onClick={() => setEditing({ id: m.id, label: m.label })} className="p-1.5 text-gray-500 hover:text-blue-400" title="Modifica">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => onDelete(m)} className="p-1.5 text-gray-500 hover:text-red-400" title="Elimina">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
