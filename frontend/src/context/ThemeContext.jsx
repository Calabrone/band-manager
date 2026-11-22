import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import client from '../api/client'
import { useAuth } from './AuthContext'
import { normalizeTheme, patchTheme } from '../lib/theme'
import { DEFAULT_THEME } from '../lib/themePresets'
import { applyTheme, readCachedTheme, THEME_EVENT } from '../lib/themeRuntime'

const SAVE_DELAY_MS = 800
const same = (a, b) => JSON.stringify(normalizeTheme(a)) === JSON.stringify(normalizeTheme(b))

const ThemeContext = createContext(null)

/**
 * Tema dell'utente: si applica subito a tutta l'app (variabili CSS), si salva sul server dopo 800 ms
 * senza altre modifiche. Prima dell'accesso vale l'ultimo tema usato sul dispositivo.
 */
export function ThemeProvider({ children }) {
  const { user, updateUser } = useAuth()
  const [theme, setThemeState] = useState(readCachedTheme)
  const [meta, setMeta] = useState(null)
  const [saveState, setSaveState] = useState('idle') // idle | saving | saved | error
  const pending = useRef(null) // modifiche locali non ancora salvate: hanno la precedenza sul server
  const timer = useRef(null)
  const updateUserRef = useRef(updateUser)
  updateUserRef.current = updateUser

  useLayoutEffect(() => {
    setMeta(applyTheme(theme))
  }, [theme])

  // Automatico: il sistema cambia da chiaro a scuro
  useEffect(() => {
    const onTheme = (e) => setMeta(e.detail)
    window.addEventListener(THEME_EVENT, onTheme)
    return () => window.removeEventListener(THEME_EVENT, onTheme)
  }, [])

  // Allineamento con il tema salvato nel profilo (login, altro dispositivo). Utente senza tema → predefinito,
  // non il tema rimasto sul dispositivo da un altro utente.
  const serverTheme = user ? JSON.stringify(user.theme ?? null) : null
  useEffect(() => {
    if (!user || pending.current) return
    const next = normalizeTheme(user.theme)
    setThemeState((cur) => (same(cur, next) ? cur : next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, serverTheme])

  // All'avvio rilegge il profilo: il tema può essere cambiato da un altro dispositivo
  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    client.get('/auth/me').then(({ data }) => {
      if (!pending.current && !same(data.theme, user?.theme)) updateUserRef.current({ ...user, ...data })
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const save = useCallback(async (t) => {
    clearTimeout(timer.current)
    setSaveState('saving')
    try {
      const { data } = await client.put('/auth/theme', { theme: t })
      if (pending.current === t) pending.current = null
      updateUserRef.current(data)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [])

  const themeRef = useRef(theme)
  themeRef.current = theme
  const loggedIn = !!user

  const setTheme = useCallback((patch) => {
    const next = patchTheme(themeRef.current, patch)
    themeRef.current = next
    setThemeState(next)
    if (loggedIn) {
      pending.current = next
      clearTimeout(timer.current)
      timer.current = setTimeout(() => save(next), SAVE_DELAY_MS)
      setSaveState('idle')
    }
  }, [loggedIn, save])

  /** Ripristina il tema predefinito scelto: stessi colori del preset, testo e forme di default. */
  const resetTheme = useCallback(() => {
    setTheme({ ...DEFAULT_THEME, preset: theme.preset })
  }, [setTheme, theme.preset])

  const retry = useCallback(() => {
    if (pending.current) save(pending.current)
  }, [save])

  // Uscendo dall'app (o chiudendo la scheda) salva subito le modifiche in attesa
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden' && pending.current) save(pending.current)
    }
    document.addEventListener('visibilitychange', flush)
    return () => document.removeEventListener('visibilitychange', flush)
  }, [save])

  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <ThemeContext.Provider value={{ theme, meta, setTheme, resetTheme, saveState, retry }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
