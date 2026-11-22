// Logica pura dello swipe tra sezioni (nessuna dipendenza dal DOM: testata con node --test).
// Convenzione delle schede Android: il contenuto segue il dito.
// Dito verso sinistra (dx < 0) -> sezione successiva (+1); verso destra (dx > 0) -> precedente (-1).

export const SWIPE = {
  minDx: 60, // spostamento orizzontale minimo (px)
  ratio: 1.5, // |dx| deve essere almeno 1,5 volte |dy|
  flickDx: 30, // spostamento minimo per un gesto rapido
  flickVelocity: 0.4, // px/ms
  edge: 20, // zona morta ai bordi dello schermo (gesto "indietro" di Android)
  lockDist: 10, // dopo quanti px si decide l'asse del gesto
}

/** Asse del gesto, deciso una volta sola: 'x' | 'y' | null (ancora incerto). */
export function axisLock(dx, dy) {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (Math.max(ax, ay) < SWIPE.lockDist) return null
  return ax > ay * SWIPE.ratio ? 'x' : 'y'
}

/** -1 sezione precedente, +1 successiva, 0 nessun cambio. dt in ms. */
export function swipeDecision({ dx, dy, dt }) {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ax < ay * SWIPE.ratio) return 0
  const velocity = dt > 0 ? ax / dt : 0
  const isFlick = ax >= SWIPE.flickDx && velocity >= SWIPE.flickVelocity
  if (ax < SWIPE.minDx && !isFlick) return 0
  return dx < 0 ? 1 : -1
}

/** Indice di arrivo, limitato a [0, count-1]: niente giro circolare. */
export function nextIndex(index, dir, count) {
  return Math.min(count - 1, Math.max(0, index + dir))
}

/** Spostamento visivo durante il trascinamento: oltre la prima/ultima sezione c'e' resistenza. */
export function dragOffset(dx, index, count) {
  const pullingPastFirst = index === 0 && dx > 0
  const pullingPastLast = index === count - 1 && dx < 0
  return pullingPastFirst || pullingPastLast ? dx / 3 : dx
}

/** True se il tocco parte dai bordi dello schermo: il gesto va ignorato. */
export function startsInEdge(x, viewportWidth) {
  return x < SWIPE.edge || x > viewportWidth - SWIPE.edge
}
