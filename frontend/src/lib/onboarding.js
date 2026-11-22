// Guida interattiva "Primi passi": logica pura dello stato (testata con node --test).
// Lo stato sta nel browser (localStorage, per utente); nessun dato sul server.

export const GROUPS = [
  { id: 'repertorio', label: 'Repertorio' },
  { id: 'prove', label: 'Sala prove' },
]

/**
 * route: percorso con segnaposto :sid / :pid / :tid. target: valore di data-tour da evidenziare.
 * needs: prerequisito che deve esistere (project, take, anySong); optional: il passo puo' essere "non mi riguarda".
 */
export const STEPS = [
  { id: 'propose', group: 'repertorio', label: 'Proponi una cover', hint: 'Tocca «Aggiungi» e inserisci artista e titolo.', route: '/', target: 'nav-add' },
  { id: 'swipe', group: 'repertorio', label: 'Cambia sezione con uno swipe', hint: 'Trascina la lista verso sinistra o destra per passare tra Proposta, Da Provare e In Scaletta.', route: '/', target: 'song-list' },
  { id: 'move', group: 'repertorio', label: "Sposta un brano in un'altra sezione", hint: 'Tocca ⋮ su un brano e scegli «Sposta in…».', route: '/', target: 'song-menu' },
  { id: 'like', group: 'repertorio', label: 'Metti un «mi piace» a un brano', hint: 'Tocca il cuore sotto il titolo del brano.', route: '/songs/:sid', target: 'like-btn', needs: 'anySong' },
  { id: 'prompter', group: 'repertorio', label: 'Apri il testo a schermo intero', hint: 'Tocca «Schermo intero» sopra il testo: scorre da solo, ideale per suonare.', route: '/songs/:sid', target: 'fullscreen-btn', needs: 'anySong' },
  { id: 'project', group: 'prove', label: 'Crea un brano di prova', hint: 'Tocca + e dagli un titolo provvisorio.', route: '/studio', target: 'new-project' },
  { id: 'take', group: 'prove', label: 'Carica o registra un contenuto', hint: 'Registra con il microfono o carica un file audio/video.', route: '/studio/:pid', target: 'add-take', needs: 'project' },
  { id: 'loop', group: 'prove', label: 'Ascolta e imposta un loop A‑B', hint: 'Tocca «A qui» e «B qui» mentre ascolti, poi attiva il loop.', route: '/studio/:pid/takes/:tid', target: 'loop-row', needs: 'take' },
  { id: 'marker', group: 'prove', label: 'Aggiungi un marker', hint: 'Tocca «Marker qui» per segnare un punto, ad esempio una nota sbagliata.', route: '/studio/:pid/takes/:tid', target: 'marker-btn', needs: 'take' },
  { id: 'comment', group: 'prove', label: 'Scrivi un commento', hint: 'Scrivi qui: puoi citare un marker o un istante.', route: '/studio/:pid/takes/:tid', target: 'comment-box', needs: 'take' },
  { id: 'overdub', group: 'prove', label: 'Registra sopra un contenuto', hint: 'Con «Registra sopra» suoni insieme a una base già caricata (meglio con le cuffie).', route: '/studio/:pid/takes/:tid', target: 'overdub-btn', needs: 'take' },
  { id: 'status', group: 'prove', label: 'Cambia lo stato di un brano', hint: 'Tocca un passo del percorso: Idea → In lavoro → Pronto.', route: '/studio/:pid', target: 'status-stepper', needs: 'project', optional: true },
]

export const STATE_VERSION = 1

export function initialState() {
  return { v: STATE_VERSION, done: {}, notApplicable: {}, skipped: false, dismissedWelcome: false, completedAt: null }
}

const stepIds = () => STEPS.map((s) => s.id)

function isCountable(state, id) {
  return !state.notApplicable[id]
}

export function isComplete(state) {
  return STEPS.every((s) => !isCountable(state, s.id) || state.done[s.id])
}

/** Idempotente: la prima data resta. Imposta completedAt quando tutti i passi (esclusi "non mi riguarda") sono fatti. */
export function markDone(state, id, now = new Date().toISOString()) {
  if (!stepIds().includes(id) || state.done[id]) return state
  const next = { ...state, done: { ...state.done, [id]: now } }
  if (!next.completedAt && isComplete(next)) next.completedAt = now
  return next
}

export function markNotApplicable(state, id, now = new Date().toISOString()) {
  const step = STEPS.find((s) => s.id === id)
  if (!step?.optional || state.notApplicable[id]) return state
  const next = { ...state, notApplicable: { ...state.notApplicable, [id]: true } }
  if (!next.completedAt && isComplete(next)) next.completedAt = now
  return next
}

/** Completamento complessivo o per gruppo. */
export function progress(state, groupId) {
  const steps = STEPS.filter((s) => (!groupId || s.group === groupId) && isCountable(state, s.id))
  const done = steps.filter((s) => state.done[s.id]).length
  return { done, total: steps.length, percent: steps.length ? Math.round((done / steps.length) * 100) : 100 }
}

export function nextStep(state) {
  return STEPS.find((s) => isCountable(state, s.id) && !state.done[s.id]) ?? null
}

export function skip(state) {
  return { ...state, skipped: true, dismissedWelcome: true }
}

export function dismissWelcome(state) {
  return { ...state, dismissedWelcome: true }
}

/** Azzera i passi ma ricorda che il benvenuto e' gia' stato visto. */
export function restart() {
  return { ...initialState(), dismissedWelcome: true }
}

/** Il pallino sul "?" si vede finche' la guida non e' completata ne' saltata. */
export function showsBadge(state) {
  return !state.skipped && !state.completedAt
}

/** La scheda di benvenuto compare solo la prima volta. */
export function showsWelcome(state) {
  return !state.dismissedWelcome && !state.skipped && !state.completedAt
}

/**
 * Rotta concreta di un passo. ctx = { lastSongId, lastProjectId, lastTakeId }.
 * Se manca cio' che serve restituisce { missing } col passo che lo crea (o la lista dove sceglierlo).
 */
export function resolveTarget(step, ctx = {}) {
  const needsProject = step.route.includes(':pid')
  const needsTake = step.route.includes(':tid')
  const needsSong = step.route.includes(':sid')
  if (needsSong && !ctx.lastSongId) return { route: '/', missing: 'song', message: 'Apri prima un brano del repertorio.' }
  if (needsTake && !ctx.lastTakeId) {
    return ctx.lastProjectId
      ? { route: `/studio/${ctx.lastProjectId}`, missing: 'take', message: 'Apri prima un contenuto (o creane uno).' }
      : { route: '/studio', missing: 'project', message: 'Apri prima un brano di prova.' }
  }
  if (needsProject && !ctx.lastProjectId) return { route: '/studio', missing: 'project', message: 'Apri prima un brano di prova.' }
  const route = step.route
    .replace(':sid', ctx.lastSongId)
    .replace(':pid', ctx.lastProjectId)
    .replace(':tid', ctx.lastTakeId)
  return { route, missing: null }
}

export function serialize(state) {
  return JSON.stringify(state)
}

/** Tollerante: JSON rotto, versione diversa o campi mancanti -> stato iniziale / campi di default. */
export function load(raw) {
  if (!raw) return initialState()
  try {
    const p = JSON.parse(raw)
    if (!p || typeof p !== 'object' || p.v !== STATE_VERSION) return initialState()
    const base = initialState()
    const ids = stepIds()
    const pick = (obj) =>
      Object.fromEntries(Object.entries(obj && typeof obj === 'object' ? obj : {}).filter(([k]) => ids.includes(k)))
    return {
      ...base,
      done: pick(p.done),
      notApplicable: pick(p.notApplicable),
      skipped: p.skipped === true,
      dismissedWelcome: p.dismissedWelcome === true,
      completedAt: typeof p.completedAt === 'string' ? p.completedAt : null,
    }
  } catch {
    return initialState()
  }
}

/** Segnala un passo compiuto da qualunque componente, senza prop drilling (ascolta OnboardingContext). */
export const ONBOARDING_EVENT = 'band:onboarding'
export function trackStep(id) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT, { detail: { step: id } }))
}
