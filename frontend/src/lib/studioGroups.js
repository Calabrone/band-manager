// Raggruppamento della lista Prove: segmenti (In corso / Promossi / Archivio) e sezioni per stato.

export const SEGMENTS = [
  { key: 'inCorso', label: 'In corso', statuses: ['idea', 'lavorazione', 'pronto'] },
  { key: 'promossi', label: 'Promossi', statuses: ['promosso'] },
  { key: 'archivio', label: 'Archivio', statuses: ['archiviato'] },
]

/** Ordine delle sezioni in "In corso": prima i brani piu' vicini alla promozione. */
export const IN_CORSO_ORDER = ['pronto', 'lavorazione', 'idea']

export function segmentOf(status) {
  return SEGMENTS.find((s) => s.statuses.includes(status))?.key ?? 'inCorso'
}

/** Valori del vecchio filtro (sessionStorage band_studio_filter) -> segmento che li contiene. */
export function migrateFilter(value) {
  if (SEGMENTS.some((s) => s.key === value)) return value
  if (value === 'attivi') return 'inCorso'
  return segmentOf(value)
}

export function countBySegment(projects) {
  const counts = { inCorso: 0, promossi: 0, archivio: 0 }
  for (const p of projects) counts[segmentOf(p.status)] += 1
  return counts
}

export function inSegment(projects, segmentKey) {
  return projects.filter((p) => segmentOf(p.status) === segmentKey)
}

/** [{status, items}] per le sole sezioni non vuote, in ordine di avvicinamento alla promozione. */
export function groupByStatus(projects) {
  return IN_CORSO_ORDER.map((status) => ({ status, items: projects.filter((p) => p.status === status) })).filter(
    (g) => g.items.length > 0,
  )
}
