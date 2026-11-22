import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

const ToastContext = createContext({ showToast: () => {}, showLink: () => {} })

/**
 * Notifiche brevi (toast) e dialog con un link da copiare a mano
 * (ultimo ripiego della condivisione quando mancano share e appunti).
 */
export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const [link, setLink] = useState(null)
  const timer = useRef(null)

  const showToast = useCallback((message) => {
    clearTimeout(timer.current)
    setToast({ message, key: Date.now() })
    timer.current = setTimeout(() => setToast(null), 2500)
  }, [])

  const showLink = useCallback((url) => setLink(url), [])

  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <ToastContext.Provider value={{ showToast, showLink }}>
      {children}
      <div
        aria-live="polite"
        className="fixed inset-x-0 z-[60] flex justify-center px-4 pointer-events-none"
        style={{ bottom: 'calc(5.5rem + env(safe-area-inset-bottom))' }}
      >
        {toast && (
          <div
            key={toast.key}
            role="status"
            data-testid="toast"
            className="max-w-sm px-4 py-2.5 rounded-xl bg-gray-800 border border-gray-700 text-gray-100 text-sm shadow-xl"
          >
            {toast.message}
          </div>
        )}
      </div>
      {link && <LinkDialog url={link} onClose={() => setLink(null)} />}
    </ToastContext.Provider>
  )
}

function LinkDialog({ url, onClose }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Link da condividere"
        className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 space-y-3">
          <h3 className="text-white font-semibold text-base">Copia il link</h3>
          <p className="text-gray-400 text-sm">Tieni premuto sul link per copiarlo e incollalo nella chat.</p>
          <input
            readOnly
            autoFocus
            value={url}
            onFocus={(e) => e.target.select()}
            data-testid="share-fallback-url"
            className="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 text-xs font-mono"
          />
        </div>
        <button onClick={onClose} className="w-full py-4 border-t border-gray-800 text-gray-300 text-sm font-medium">
          Chiudi
        </button>
      </div>
    </div>
  )
}

export function useToast() {
  return useContext(ToastContext)
}
