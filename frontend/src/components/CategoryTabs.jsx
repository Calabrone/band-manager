const CATEGORIES = [
  { key: 'proposta', label: 'Proposta' },
  { key: 'da_provare', label: 'Da Provare' },
  { key: 'in_scaletta', label: 'In Scaletta' },
]

export default function CategoryTabs({ active, counts = {}, onChange }) {
  return (
    <div className="flex border-b border-gray-800 bg-gray-950 sticky top-0 z-10">
      {CATEGORIES.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
            active === key
              ? 'text-brand-400 border-b-2 border-brand-500'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {label}
          {counts[key] > 0 && (
            <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${
              active === key ? 'bg-brand-600 text-white' : 'bg-gray-700 text-gray-300'
            }`}>
              {counts[key]}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
