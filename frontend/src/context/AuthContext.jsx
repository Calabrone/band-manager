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

  async function login(username, password) {
    const { data } = await client.post('/auth/login', { username, password })
    localStorage.setItem('band_token', data.token)
    localStorage.setItem('band_user', JSON.stringify(data.user))
    setUser(data.user)
    return data.user
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
    <AuthContext.Provider value={{ user, login, logout, isAdmin }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
