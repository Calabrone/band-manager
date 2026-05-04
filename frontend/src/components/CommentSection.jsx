import { useState, useMemo, useEffect } from 'react'
import { Check, CornerDownRight, MessageCircle, Pencil, Send, Trash2, X } from 'lucide-react'
import client from '../api/client'
import { useAuth } from '../context/AuthContext'
import ConfirmDialog from './ConfirmDialog'

function CommentItem({
  comment, currentUser, isAdmin,
  isEditing, editText, onEditTextChange,
  onStartEdit, onCancelEdit, onSaveEdit,
  onDelete, onReply,
}) {
  const canEdit = comment.user_id === currentUser?.id
  const canDelete = canEdit || isAdmin
  const isEdited = comment.updated_at !== comment.created_at

  return (
    <div className="text-sm">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-white font-medium text-xs">{comment.username}</span>
        <span className="text-gray-600 text-xs">
          {new Date(comment.created_at).toLocaleString('it-IT', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
          })}
        </span>
        {isEdited && <span className="text-gray-600 text-xs italic">(modificato)</span>}
      </div>

      {isEditing ? (
        <div className="flex gap-2">
          <textarea
            value={editText}
            onChange={e => onEditTextChange(e.target.value)}
            rows={2}
            autoFocus
            className="flex-1 px-3 py-2 rounded-xl bg-gray-800 border border-brand-500
                       text-white text-sm resize-none focus:outline-none"
          />
          <div className="flex flex-col gap-1 self-end">
            <button
              onClick={onSaveEdit}
              disabled={!editText.trim()}
              className="p-2 rounded-xl bg-brand-600 text-white disabled:opacity-40 hover:bg-brand-700"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={onCancelEdit}
              className="p-2 rounded-xl bg-gray-700 text-gray-400 hover:bg-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <p className="text-gray-300 whitespace-pre-wrap">{comment.content}</p>
      )}

      {!isEditing && (
        <div className="flex items-center gap-3 mt-1">
          {onReply && (
            <button
              onClick={onReply}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300"
            >
              <CornerDownRight className="w-3 h-3" />
              Rispondi
            </button>
          )}
          {canEdit && (
            <button
              onClick={onStartEdit}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-400"
            >
              <Pencil className="w-3 h-3" />
              Modifica
            </button>
          )}
          {canDelete && (
            <button
              onClick={onDelete}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-400"
            >
              <Trash2 className="w-3 h-3" />
              Elimina
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function CommentSection({ songId }) {
  const { user, isAdmin } = useAuth()
  const [comments, setComments] = useState([])
  const [loading, setLoading] = useState(true)
  const [newText, setNewText] = useState('')
  const [replyingTo, setReplyingTo] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    client.get(`/songs/${songId}/comments`).then(({ data }) => {
      if (!cancelled) setComments(data)
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [songId])

  const threads = useMemo(() => {
    const top = comments.filter(c => c.parent_id === null)
    return top.map(p => ({ ...p, replies: comments.filter(c => c.parent_id === p.id) }))
  }, [comments])

  async function handleSubmitTop(e) {
    e.preventDefault()
    const content = newText.trim()
    if (!content || submitting) return
    setSubmitting(true)
    try {
      const { data } = await client.post(`/songs/${songId}/comments`, { content })
      setComments(prev => [...prev, data])
      setNewText('')
    } catch {
      // ignore
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSubmitReply(parentId) {
    const content = replyText.trim()
    if (!content || submitting) return
    setSubmitting(true)
    try {
      const { data } = await client.post(`/songs/${songId}/comments`, { content, parent_id: parentId })
      setComments(prev => [...prev, data])
      setReplyingTo(null)
      setReplyText('')
    } catch {
      // ignore
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSaveEdit(commentId) {
    const content = editText.trim()
    if (!content) return
    try {
      const { data } = await client.put(`/songs/${songId}/comments/${commentId}`, { content })
      setComments(prev => prev.map(c => c.id === commentId ? data : c))
      setEditingId(null)
      setEditText('')
    } catch {
      // ignore
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return
    const id = deleteTarget.id
    try {
      await client.delete(`/songs/${songId}/comments/${id}`)
      setComments(prev => prev.filter(c => c.id !== id && c.parent_id !== id))
    } catch {
      // ignore
    } finally {
      setDeleteTarget(null)
    }
  }

  function startEdit(comment) {
    setEditingId(comment.id)
    setEditText(comment.content)
    setReplyingTo(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditText('')
  }

  function startReply(commentId) {
    setReplyingTo(commentId)
    setReplyText('')
    setEditingId(null)
    setEditText('')
  }

  return (
    <div className="px-4 mt-6">
      <h2 className="text-sm font-semibold text-gray-300 mb-4 flex items-center gap-2">
        <MessageCircle className="w-4 h-4" />
        Commenti ({comments.length})
      </h2>

      <form onSubmit={handleSubmitTop} className="flex gap-2 mb-6">
        <textarea
          value={newText}
          onChange={e => setNewText(e.target.value)}
          placeholder="Aggiungi un commento..."
          rows={2}
          className="flex-1 px-3 py-2 rounded-xl bg-gray-800 border border-gray-700
                     text-white placeholder-gray-500 text-sm resize-none
                     focus:outline-none focus:border-brand-500"
        />
        <button
          type="submit"
          disabled={!newText.trim() || submitting}
          className="self-end p-2 rounded-xl bg-brand-600 text-white disabled:opacity-40 hover:bg-brand-700"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {loading ? (
        <p className="text-gray-500 text-sm">Caricamento...</p>
      ) : threads.length === 0 ? (
        <p className="text-gray-600 text-sm italic">Nessun commento ancora.</p>
      ) : (
        <div className="space-y-4">
          {threads.map(thread => (
            <div key={thread.id}>
              <CommentItem
                comment={thread}
                currentUser={user}
                isAdmin={isAdmin()}
                isEditing={editingId === thread.id}
                editText={editText}
                onEditTextChange={setEditText}
                onStartEdit={() => startEdit(thread)}
                onCancelEdit={cancelEdit}
                onSaveEdit={() => handleSaveEdit(thread.id)}
                onDelete={() => setDeleteTarget(thread)}
                onReply={() => startReply(thread.id)}
              />

              {thread.replies.length > 0 && (
                <div className="ml-6 mt-2 space-y-3 border-l border-gray-800 pl-3">
                  {thread.replies.map(reply => (
                    <CommentItem
                      key={reply.id}
                      comment={reply}
                      currentUser={user}
                      isAdmin={isAdmin()}
                      isEditing={editingId === reply.id}
                      editText={editText}
                      onEditTextChange={setEditText}
                      onStartEdit={() => startEdit(reply)}
                      onCancelEdit={cancelEdit}
                      onSaveEdit={() => handleSaveEdit(reply.id)}
                      onDelete={() => setDeleteTarget(reply)}
                      onReply={null}
                    />
                  ))}
                </div>
              )}

              {replyingTo === thread.id && (
                <div className="ml-6 mt-2 border-l border-gray-800 pl-3">
                  <form
                    onSubmit={e => { e.preventDefault(); handleSubmitReply(thread.id) }}
                    className="flex gap-2"
                  >
                    <textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder={`Rispondi a ${thread.username}...`}
                      rows={2}
                      autoFocus
                      className="flex-1 px-3 py-2 rounded-xl bg-gray-800 border border-gray-700
                                 text-white placeholder-gray-500 text-sm resize-none
                                 focus:outline-none focus:border-brand-500"
                    />
                    <div className="flex flex-col gap-1 self-end">
                      <button
                        type="submit"
                        disabled={!replyText.trim() || submitting}
                        className="p-2 rounded-xl bg-brand-600 text-white disabled:opacity-40 hover:bg-brand-700"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setReplyingTo(null)}
                        className="p-2 rounded-xl bg-gray-700 text-gray-400 hover:bg-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Elimina commento"
          message="Eliminare questo commento?"
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
