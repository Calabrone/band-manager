import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'
import { useNotifications } from '../context/NotificationContext'

/** Campanella con il numero di notifiche non lette (R2.1). */
export default function NotificationBell() {
  const { unread } = useNotifications()
  const label = unread > 0 ? `Notifiche, ${unread} non lette` : 'Notifiche'
  return (
    <Link
      to="/notifications"
      aria-label={label}
      title={label}
      data-testid="notification-bell"
      className="relative p-2 -mr-1 rounded-full text-gray-400 hover:text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      <Bell className="w-6 h-6" />
      {unread > 0 && (
        <span
          data-testid="notification-badge"
          className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-on-solid text-[11px] font-bold leading-[18px] text-center"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </Link>
  )
}
