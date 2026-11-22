import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import client from '../api/client'
import { useAuth } from './AuthContext'

const DEFAULT_NAME = 'Band Manager'
const CACHE_KEY = 'band_name_cache'

/** Ultimo nome del gruppo noto sul dispositivo: serve alla pagina di login, che non puo' leggerlo dal server. */
export function readCachedBandName() {
  try {
    return localStorage.getItem(CACHE_KEY) || ''
  } catch {
    return ''
  }
}

function writeCachedBandName(name) {
  try {
    if (name) localStorage.setItem(CACHE_KEY, name)
    else localStorage.removeItem(CACHE_KEY)
  } catch {
    // storage non disponibile
  }
}

const ConfigContext = createContext({ config: null, bandName: DEFAULT_NAME, refreshConfig: async () => {} })

export function ConfigProvider({ children }) {
  const { user } = useAuth()
  const [config, setConfig] = useState(null)
  const [cached, setCached] = useState(readCachedBandName)

  const refreshConfig = useCallback(async () => {
    try {
      const { data } = await client.get('/config')
      setConfig(data)
      const name = (data.band_name || '').trim()
      writeCachedBandName(name)
      setCached(name)
    } catch {
      // senza config si resta sull'ultimo nome noto
    }
  }, [])

  const userId = user?.id
  useEffect(() => {
    if (userId) refreshConfig()
    else setConfig(null)
  }, [userId, refreshConfig])

  const value = useMemo(() => {
    const name = config ? (config.band_name || '').trim() : cached
    return { config, bandName: name || DEFAULT_NAME, refreshConfig }
  }, [config, cached, refreshConfig])

  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

export function useConfig() {
  return useContext(ConfigContext)
}
