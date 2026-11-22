import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import GuidePanel from '../components/onboarding/GuidePanel'
import Spotlight from '../components/onboarding/Spotlight'
import WelcomeCard from '../components/onboarding/WelcomeCard'
import {
  ONBOARDING_EVENT, STEPS, dismissWelcome, initialState, load, markDone, markNotApplicable, resolveTarget, restart as restartState,
  serialize, showsBadge, showsWelcome, skip as skipState,
} from '../lib/onboarding'

const Ctx = createContext({
  state: initialState(), badge: false, open: () => {}, setCtx: () => {}, track: () => {},
})

const stateKey = (id) => `band_onboarding_${id}`
const ctxKey = (id) => `band_onboarding_ctx_${id}`

function read(key) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage non disponibile: la guida funziona per la sessione
  }
}
function readCtx(id) {
  try {
    return JSON.parse(read(ctxKey(id)) || '{}') || {}
  } catch {
    return {}
  }
}

export function OnboardingProvider({ children }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const userId = user?.id
  const [state, setState] = useState(initialState)
  const [ctx, setCtxState] = useState({})
  const [panel, setPanel] = useState(false)
  const [spot, setSpot] = useState(null) // { stepId, target, title, hint, message }
  const loadedFor = useRef(null)

  // Carica lo stato dell'utente che ha fatto l'accesso
  useEffect(() => {
    if (!userId) {
      loadedFor.current = null
      setState(initialState())
      setCtxState({})
      return
    }
    setState(load(read(stateKey(userId))))
    setCtxState(readCtx(userId))
    loadedFor.current = userId
  }, [userId])

  useEffect(() => {
    if (userId && loadedFor.current === userId) write(stateKey(userId), serialize(state))
  }, [state, userId])

  const setCtx = useCallback(
    (partial, { ifMissing = false } = {}) => {
      if (!userId) return
      setCtxState((prev) => {
        const next = { ...prev }
        for (const [k, v] of Object.entries(partial)) {
          if (ifMissing && prev[k]) continue
          next[k] = v ?? null
        }
        if (JSON.stringify(next) === JSON.stringify(prev)) return prev
        write(ctxKey(userId), JSON.stringify(next))
        return next
      })
    },
    [userId],
  )

  const track = useCallback(
    (id) => {
      if (!userId) return
      setState((s) => markDone(s, id))
      setSpot((sp) => (sp && sp.stepId === id ? null : sp))
    },
    [userId],
  )

  useEffect(() => {
    const onEvent = (e) => track(e.detail?.step)
    window.addEventListener(ONBOARDING_EVENT, onEvent)
    return () => window.removeEventListener(ONBOARDING_EVENT, onEvent)
  }, [track])

  const showMe = useCallback(
    (id) => {
      const step = STEPS.find((s) => s.id === id)
      if (!step) return
      const r = resolveTarget(step, ctx)
      setPanel(false)
      setSpot(
        r.missing
          ? { stepId: id, target: null, title: step.label, hint: r.message }
          : { stepId: id, target: step.target, title: step.label, hint: step.hint },
      )
      navigate(r.route)
    },
    [ctx, navigate],
  )

  const value = useMemo(
    () => ({ state, badge: showsBadge(state), open: () => setPanel(true), setCtx, track }),
    [state, setCtx, track],
  )

  const onHome = location.pathname === '/'
  const welcome = !!userId && !user.must_change_password && onHome && showsWelcome(state) && !panel
  const inProve = location.pathname.startsWith('/studio')

  return (
    <Ctx.Provider value={value}>
      {children}
      {welcome && (
        <WelcomeCard
          onStart={() => {
            setState(dismissWelcome)
            setPanel(true)
          }}
          onSkip={() => setState(skipState)}
        />
      )}
      {panel && userId && (
        <GuidePanel
          state={state}
          initialGroup={inProve ? 'prove' : 'repertorio'}
          onClose={() => {
            setPanel(false)
            setState(dismissWelcome)
          }}
          onShow={showMe}
          onSkip={() => {
            setState(skipState)
            setPanel(false)
          }}
          onRestart={() => setState(restartState())}
          onNotApplicable={(id) => setState((s) => markNotApplicable(s, id))}
        />
      )}
      {spot && <Spotlight key={spot.stepId} spot={spot} onClose={() => setSpot(null)} />}
    </Ctx.Provider>
  )
}

export function useOnboarding() {
  return useContext(Ctx)
}
