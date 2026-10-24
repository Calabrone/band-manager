import { createContext, useContext, useState } from 'react'
import client from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('band_user')
      return saved ? JSON.parse(saved) : null
    } catch {
      return null
    }
  })

  // Salva token e utente restituiti dalle API di accesso (login, registrazione, cambio password)
  function applySession(token, nextUser) {
    if (token) localStorage.setItem('band_token', token)
    localStorage.setItem('band_user', JSON.stringify(nextUser))
    setUser(nextUser)
    return nextUser
  }

  async function login(username, password) {
    const { data } = await client.post('/auth/login', { username, password })
    return applySession(data.token, data.user)
  }

  function updateUser(nextUser) {
    applySession(null, nextUser)
  }

  function logout() {
    localStorage.removeItem('band_token')
    localStorage.removeItem('band_user')
    setUser(null)
  }

  function isAdmin() {
    return user?.role === 'admin'
  }

  return (
    <AuthContext.Provider value={{ user, login, applySession, updateUser, logout, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
