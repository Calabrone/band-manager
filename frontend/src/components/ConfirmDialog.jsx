export default function ConfirmDialog({ title, message, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-sm bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden">
        <div className="p-5">
          <h3 className="text-white font-semibold text-base">{title}</h3>
          <p className="text-gray-400 text-sm mt-1">{message}</p>
        </div>
        <div className="flex border-t border-gray-800">
          <button
            onClick={onCancel}
            className="flex-1 py-4 text-gray-300 text-sm font-medium border-r border-gray-800"
          >
            Annulla
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-4 text-red-400 text-sm font-semibold"
          >
            Elimina
          </button>
        </div>
      </div>
    </div>
  )
}
