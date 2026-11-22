/** Barra d'azione fissa in basso (rispetta la safe area). La pagina aggiunge pb-28 per non coprire il fondo. */
export default function ActionBar({ children }) {
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 bg-gray-950/95 backdrop-blur border-t border-gray-800 pt-3 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="max-w-2xl mx-auto flex gap-2">{children}</div>
    </div>
  )
}
