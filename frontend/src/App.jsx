import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Songs from './pages/Songs'
import SongDetail from './pages/SongDetail'
import AddEditSong from './pages/AddEditSong'
import Admin from './pages/Admin'

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, isAdmin } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !isAdmin()) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Songs /></ProtectedRoute>} />
      <Route path="/songs/:id" element={<ProtectedRoute><SongDetail /></ProtectedRoute>} />
      <Route path="/add" element={<ProtectedRoute><AddEditSong /></ProtectedRoute>} />
      <Route path="/songs/:id/edit" element={<ProtectedRoute><AddEditSong /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute adminOnly><Admin /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
