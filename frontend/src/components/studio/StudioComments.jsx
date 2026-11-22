import { useRef, useState } from 'react'
import { trackStep } from '../../lib/onboarding'
import { Clock, Flag, MessageSquare, Pencil, Send, Share2, Trash2 } from 'lucide-react'
import client from '../../api/client'
import { formatClock } from '../../lib/loop'
import { insertRef, markerToken, parseRefs, timeToken } from '../../lib/refs'
import { errorText, formatDateTime, inputCls, userColor } from './ui'

/** Testo di un commento: le citazioni [[m:id]] e [[t:ms]] diventano pulsanti che portano il player a quel punto. */
function CommentBody({ text, markers, onSeekMs }) {
  const byId = Object.fromEntries(markers.map((m) => [m.id, m]))
  return (
    <p className="text-sm text-gray-200 whitespace-pre-wrap break-words">
      {parseRefs(text).map((part, i) => {
        if (part.type === 'text') return <span key={i}>{part.text}</span>
        if (part.type === 'time') {
          return (
            <button key={i} type="button" onClick={() => onSeekMs(part.ms)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-purple-900/40 text-purple-200 text-xs align-baseline">
              <Clock className="w-3 h-3" />{formatClock(part.ms)}
            </button>
          )
        }
        const m = byId[part.id]
        return m ? (
          <button key={i} type="button" onClick={() => onSeekMs(m.time_ms)}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-purple-900/40 text-xs align-baseline"
                  style={{ color: userColor(m.user_id) }}>
            <Flag className="w-3 h-3" />{formatClock(m.time_ms)} <span className="text-purple-100">{m.label}</span>
          </button>
        ) : (
          <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded-md bg-gray-800 text-gray-500 text-xs align-baseline">
            <Flag className="w-3 h-3" />marker eliminato
          </span>
        )
      })}
    </p>
  )
}

/** Commenti semplici di un contenuto, con citazione di marker e istanti. */
export default function StudioComments({ takeId, comments, markers, userId, getPosition, onSeekMs, onCreateMarker, onChanged, onShare }) {
  const [text, setText] = useState('')
  const [picker, setPicker] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // { id, content }
  const areaRef = useRef(null)

  function addToken(token) {
    const cursor = areaRef.current?.selectionStart
    const next = insertRef(text, cursor, token)
    setText(next.text)
    setPicker(false)
    requestAnimationFrame(() => {
      areaRef.current?.focus()
      areaRef.current?.setSelectionRange(next.cursor, next.cursor)
    })
  }

  async function createAndCite() {
    const label = newLabel.trim()
    if (!label) return
    try {
      const marker = await onCreateMarker(getPosition(), label)
      setNewLabel('')
      addToken(markerToken(marker.id))
    } catch (err) {
      setError(errorText(err, 'Marker non creato'))
    }
  }

  async function send(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    setError('')
    try {
      await client.post(`/studio/takes/${takeId}/comments`, { content: text })
      trackStep('comment')
      setText('')
      setPicker(false)
      await onChanged()
    } catch (err) {
      setError(errorText(err, 'Commento non inviato'))
    } finally {
      setSending(false)
    }
  }

  async function saveEdit() {
    try {
      await client.put(`/studio/takes/${takeId}/comments/${editing.id}`, { content: editing.content })
      setEditing(null)
      await onChanged()
    } catch (err) {
      setError(errorText(err, 'Modifica non riuscita'))
    }
  }

  async function remove(c) {
    try {
      await client.delete(`/studio/takes/${takeId}/comments/${c.id}`)
      await onChanged()
    } catch (err) {
      setError(errorText(err, 'Eliminazione non riuscita'))
    }
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2 mb-2">
        <MessageSquare className="w-4 h-4" /> Commenti ({comments.length})
      </h2>

      <ul className="space-y-2 mb-3">
        {comments.length === 0 && <li className="text-sm text-gray-600 italic">Nessun commento ancora.</li>}
        {comments.map((c) => (
          <li key={c.id} id={`c-${c.id}`} data-share-id={`comment-${c.id}`} className="px-3 py-2 rounded-xl bg-gray-900 border border-gray-800 scroll-mt-20">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs text-gray-400"><span className="text-gray-200 font-medium">{c.username}</span> · {formatDateTime(c.created_at)}</span>
              <span className="flex items-center">
                {onShare && editing?.id !== c.id && (
                  <button type="button" onClick={() => onShare(c)} className="p-1 text-gray-500 hover:text-brand-300"
                          aria-label="Condividi il commento" title="Condividi" data-testid="share-action">
                    <Share2 className="w-3.5 h-3.5" />
                  </button>
                )}
              {c.user_id === userId && editing?.id !== c.id && (
                <span className="flex items-center">
                  <button type="button" onClick={() => setEditing({ id: c.id, content: c.content })} className="p-1 text-gray-500 hover:text-blue-400" title="Modifica">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button type="button" onClick={() => remove(c)} className="p-1 text-gray-500 hover:text-red-400" title="Elimina">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              )}
              </span>
            </div>
            {editing?.id === c.id ? (
              <div className="space-y-2">
                <textarea value={editing.content} maxLength={2000} rows={3} className={inputCls}
                          onChange={(e) => setEditing({ id: c.id, content: e.target.value })} />
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setEditing(null)} className="text-xs text-gray-400 px-2 py-1">Annulla</button>
                  <button type="button" onClick={saveEdit} disabled={!editing.content.trim()} className="text-xs text-purple-300 px-2 py-1 disabled:opacity-40">Salva</button>
                </div>
              </div>
            ) : (
              <CommentBody text={c.content} markers={markers} onSeekMs={onSeekMs} />
            )}
          </li>
        ))}
      </ul>

      <form onSubmit={send} className="space-y-2">
        <textarea ref={areaRef} data-tour="comment-box" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={3}
                  placeholder="Scrivi un commento…" className={inputCls} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPicker((p) => !p)}
                  className="px-2.5 py-1.5 rounded-lg bg-gray-800 text-gray-200 text-xs flex items-center gap-1">
            <Flag className="w-3 h-3" /> Cita marker
          </button>
          <button type="button" onClick={() => addToken(timeToken(getPosition()))}
                  className="px-2.5 py-1.5 rounded-lg bg-gray-800 text-gray-200 text-xs flex items-center gap-1">
            <Clock className="w-3 h-3" /> Cita istante
          </button>
          <button type="submit" disabled={sending || !text.trim()}
                  className="ml-auto px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-on-accent text-xs font-medium flex items-center gap-1 disabled:opacity-50">
            <Send className="w-3 h-3" /> Invia
          </button>
        </div>

        {picker && (
          <div className="p-2 rounded-xl bg-gray-900 border border-gray-700 space-y-2">
            {markers.length > 0 && (
              <ul className="max-h-40 overflow-y-auto space-y-1">
                {[...markers].sort((a, b) => a.time_ms - b.time_ms).map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => addToken(markerToken(m.id))}
                            className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-gray-800 text-xs flex items-center gap-2">
                      <span style={{ color: userColor(m.user_id) }}>⚑</span>
                      <span className="font-mono text-gray-300">{formatClock(m.time_ms)}</span>
                      <span className="text-white truncate">{m.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2 items-center">
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} maxLength={80} className={inputCls}
                     placeholder={`Nuovo marker a ${formatClock(getPosition())}: nota`}
                     onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createAndCite() } }} />
              <button type="button" onClick={createAndCite} disabled={!newLabel.trim()}
                      className="px-2.5 py-2 rounded-lg bg-gray-800 text-gray-200 text-xs whitespace-nowrap disabled:opacity-40">
                Crea e cita
              </button>
            </div>
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </form>
    </section>
  )
}
