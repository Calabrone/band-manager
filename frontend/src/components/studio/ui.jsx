// Elementi comuni delle pagine della Sala prove: modale, campo, stato dei brani di prova, formati.
import { X } from 'lucide-react'
import { formatClock } from '../../lib/loop'

export const inputCls = `w-full px-3 py-2 rounded-xl bg-gray-800 border border-gray-700 text-white
                  placeholder-gray-500 text-sm focus:outline-none focus:border-brand-500`

export const btnPrimary = `px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium
                  disabled:opacity-50 transition flex items-center justify-center gap-1.5`
export const btnSecondary = `px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-medium
                  disabled:opacity-50 transition flex items-center justify-center gap-1.5`

export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-2xl">
        <div className="flex items-center justify-between px-5 pt-4">
          <h3 className="text-white font-semibold text-base">{title}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-3">{children}</div>
      </div>
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-400 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-500 mt-1">{hint}</span>}
    </label>
  )
}

export function errorText(err, fallback) {
  const detail = err?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

export function formatSize(bytes) {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Il server manda date UTC senza fuso ("2026-11-20T20:30:15.123"): vanno lette come UTC. */
export function parseUtc(iso) {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : iso + 'Z')
}

export function formatDateTime(iso) {
  return parseUtc(iso).toLocaleString('it-IT', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function timeAgo(iso) {
  const sec = Math.max(0, Math.round((Date.now() - parseUtc(iso).getTime()) / 1000))
  if (sec < 60) return 'adesso'
  if (sec < 3600) return `${Math.floor(sec / 60)} min fa`
  if (sec < 86400) return `${Math.floor(sec / 3600)} h fa`
  if (sec < 7 * 86400) return `${Math.floor(sec / 86400)} g fa`
  return parseUtc(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDuration(ms) {
  return ms ? formatClock(ms) : '–:––'
}

export const STATUS = {
  idea: { label: 'Idea', cls: 'bg-sky-900/40 text-sky-300' },
  lavorazione: { label: 'In lavorazione', cls: 'bg-amber-900/40 text-amber-300' },
  pronto: { label: 'Pronto', cls: 'bg-green-900/40 text-green-300' },
  promosso: { label: 'Promosso', cls: 'bg-purple-900/40 text-purple-300' },
  archiviato: { label: 'Archiviato', cls: 'bg-gray-800 text-gray-400' },
}

/** Stati che il creatore (o l'admin) imposta a mano: "Promosso" si ottiene solo con la promozione. */
export const SETTABLE_STATUSES = ['idea', 'lavorazione', 'pronto', 'archiviato']

export function StatusBadge({ status }) {
  const s = STATUS[status] ?? STATUS.idea
  return <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${s.cls}`}>{s.label}</span>
}

export const CATEGORY_OPTIONS = [
  { key: 'proposta', label: 'Proposta' },
  { key: 'da_provare', label: 'Da Provare' },
  { key: 'in_scaletta', label: 'In Scaletta' },
]

/** Colore stabile per autore (marker sulla timeline): tinta dall'id utente. */
export function userColor(userId) {
  return `hsl(${(Number(userId) * 67) % 360} 70% 62%)`
}
