/**
 * Schede a tutta larghezza con conteggio. L'indicatore sotto la scheda attiva segue il dito durante lo swipe
 * (SwipeTabs scrive --swipe-progress su <html>: nessun re-render della pagina a ogni movimento).
 */
export default function Tabs({ items, value, onChange, stickyClass = 'top-0', ariaLabel }) {
  const index = Math.max(0, items.findIndex((i) => i.key === value))
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`relative flex border-b border-gray-800 bg-gray-950 sticky z-10 ${stickyClass}`}
    >
      {items.map(({ key, label, count }) => {
        const active = key === value
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            data-tab={key}
            onClick={() => onChange(key)}
            className={`flex-1 min-w-0 py-3 px-1 text-sm font-medium transition-colors whitespace-nowrap ${
              active ? 'text-brand-400' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
            {count !== undefined && count !== null && count > 0 && (
              <span
                className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${active ? 'bg-brand-600 text-on-accent' : 'bg-gray-700 text-gray-300'}`}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
      <span
        aria-hidden
        className="absolute bottom-0 h-0.5 bg-brand-500 pointer-events-none"
        style={{
          width: `${100 / items.length}%`,
          left: `${(index * 100) / items.length}%`,
          transform: 'translateX(calc(var(--swipe-progress, 0) * 100%))',
          transition: 'transform 120ms linear, left 180ms ease',
        }}
      />
    </div>
  )
}
