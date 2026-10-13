import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBell } from '@fortawesome/free-solid-svg-icons';

const POLL_INTERVAL_MS = 8000;

const TYPE_ICON = {
  low_stock: 'ti-alert-triangle',
  reorder_suggestion: 'ti-shopping-cart',
  slow_mover: 'ti-trending-down',
  demand_spike: 'ti-trending-up',
};

export default function NotificationBell() {
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  async function refresh() {
    try {
      const items = await api.listNotifications();
      setNotifications(items);
    } catch {
      // Silently skip — a missed poll shouldn't disrupt the UI, the next
      // one will pick it up.
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function handleMarkAll() {
    await api.markAllNotificationsRead();
    refresh();
  }

  async function handleItemClick(n) {
    if (!n.is_read) {
      await api.markNotificationRead(n.id);
      refresh();
    }
  }

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button className="bell-btn" onClick={() => setOpen((o) => !o)} title="Notifications">
        <i className="ti ti-bell" aria-hidden="true" />
        <FontAwesomeIcon icon={faBell} className="bell-icon" />
        {unreadCount > 0 && <span className="bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="bell-panel">
          <div className="bell-panel-header">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button className="bell-mark-all" onClick={handleMarkAll}>Mark all read</button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className="bell-empty">
              <i className="ti ti-bell-off" aria-hidden="true" />
              Nothing yet — you'll see low-stock alerts here.
            </div>
          ) : (
            <div className="bell-list">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`bell-item ${n.is_read ? '' : 'unread'}`}
                  onClick={() => handleItemClick(n)}
                >
                  <i className={`ti ${TYPE_ICON[n.type] || 'ti-alert-triangle'}`} aria-hidden="true" />
                  <div>
                    <div className="bell-item-msg">{n.message}</div>
                    <div className="bell-item-time">{n.created_at}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
