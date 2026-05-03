import { Link, useLocation } from 'react-router-dom'
import { Music2, PlusCircle, Settings, UserCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function BottomNav() {
  const location = useLocation()
  const { isAdmin } = useAuth()

  const links = [
    { to: '/', icon: Music2, label: 'Brani' },
    { to: '/add', icon: PlusCircle, label: 'Aggiungi' },
    ...(isAdmin() ? [{ to: '/admin', icon: Settings, label: 'Admin' }] : []),
    { to: '/profile', icon: UserCircle, label: 'Profilo' },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 safe-bottom z-40">
      <div className="flex">
        {links.map(({ to, icon: Icon, label }) => {
          const active = location.pathname === to
          return (
            <Link
              key={to}
              to={to}
              className={`flex-1 flex flex-col items-center py-2 gap-0.5 transition-colors ${
                active ? 'text-brand-400' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <Icon className="w-6 h-6" />
              <span className="text-xs">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
