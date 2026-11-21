import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Songs from './pages/Songs'
import SongDetail from './pages/SongDetail'
import AddEditSong from './pages/AddEditSong'
import LyricsEdit from './pages/LyricsEdit'
import Studio from './pages/Studio'
import StudioProject from './pages/StudioProject'
import StudioProjectEdit from './pages/StudioProjectEdit'
import StudioTake from './pages/StudioTake'
import StudioRecord from './pages/StudioRecord'
import Admin from './pages/Admin'
import Profile from './pages/Profile'

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, isAdmin } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace />
  // Password di default: l'unica pagina utilizzabile e' il profilo
  if (user.must_change_password && location.pathname !== '/profile') {
    return <Navigate to="/profile" replace />
  }
  if (adminOnly && !isAdmin()) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/invite/:token" element={<Register />} />
      <Route path="/forgot" element={<ForgotPassword />} />
      <Route path="/reset/:token" element={<ResetPassword />} />
      <Route path="/" element={<ProtectedRoute><Songs /></ProtectedRoute>} />
      <Route path="/songs/:id" element={<ProtectedRoute><SongDetail /></ProtectedRoute>} />
      <Route path="/add" element={<ProtectedRoute><AddEditSong /></ProtectedRoute>} />
      <Route path="/songs/:id/edit" element={<ProtectedRoute><AddEditSong /></ProtectedRoute>} />
      <Route path="/songs/:id/lyrics" element={<ProtectedRoute><LyricsEdit /></ProtectedRoute>} />
      <Route path="/studio" element={<ProtectedRoute><Studio /></ProtectedRoute>} />
      <Route path="/studio/new" element={<ProtectedRoute><StudioProjectEdit /></ProtectedRoute>} />
      <Route path="/studio/:pid" element={<ProtectedRoute><StudioProject /></ProtectedRoute>} />
      <Route path="/studio/:pid/lyrics" element={<ProtectedRoute><LyricsEdit /></ProtectedRoute>} />
      <Route path="/studio/:pid/edit" element={<ProtectedRoute><StudioProjectEdit /></ProtectedRoute>} />
      <Route path="/studio/:pid/record" element={<ProtectedRoute><StudioRecord /></ProtectedRoute>} />
      <Route path="/studio/:pid/takes/:tid" element={<ProtectedRoute><StudioTake /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute adminOnly><Admin /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
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
