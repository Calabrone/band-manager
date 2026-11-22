import Tabs from './ui/Tabs'

export const CATEGORIES = [
  { key: 'proposta', label: 'Proposta' },
  { key: 'da_provare', label: 'Da Provare' },
  { key: 'in_scaletta', label: 'In Scaletta' },
]

export default function CategoryTabs({ active, counts = {}, onChange }) {
  const items = CATEGORIES.map((c) => ({ ...c, count: counts[c.key] }))
  return <Tabs items={items} value={active} onChange={onChange} ariaLabel="Sezioni del repertorio" />
}
