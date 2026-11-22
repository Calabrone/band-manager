/** Selettore a segmenti a tutta larghezza: sta sempre nello schermo (ogni voce ha flex-1 e tronca il testo). */
export default function Segmented({ options, value, onChange, className = '' }) {
  const index = Math.max(0, options.findIndex((o) => o.key === value))
  const n = options.length
  return (
    <div role="tablist" className={`relative flex p-1 rounded-xl bg-gray-800 ${className}`}>
      <span
        aria-hidden
        className="absolute top-1 bottom-1 left-1 rounded-lg bg-brand-600 pointer-events-none"
        style={{
          width: `calc((100% - 0.5rem) / ${n})`,
          transform: `translateX(calc(${index * 100}% + var(--swipe-progress, 0) * 100%))`,
          transition: 'transform 150ms ease',
        }}
      />
      {options.map(({ key, label, count }) => {
        const active = key === value
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            data-segment={key}
            onClick={() => onChange(key)}
            className={`relative flex-1 min-w-0 px-2 py-2 text-sm font-medium truncate transition-colors ${
              active ? 'text-on-accent' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
            {count !== undefined && <span className={`ml-1 text-xs ${active ? 'text-on-accent/80' : 'text-gray-500'}`}>{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
