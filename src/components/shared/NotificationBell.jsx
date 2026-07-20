import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import {
  fetchRecentNotifications,
  subscribeToNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../../lib/notifications";
import { BellIcon } from "../icons";
import "../../styles/NotificationBell.css";

function timeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function NotificationBell() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const unreadCount = items.filter((n) => !n.is_read).length;

  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;

    fetchRecentNotifications(profile.id)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {});

    const unsubscribe = subscribeToNotifications(profile.id, (row) => {
      setItems((prev) => [row, ...prev].slice(0, 20));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [profile?.id]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleItemClick(n) {
    if (!n.is_read) {
      setItems((prev) => prev.map((it) => (it.id === n.id ? { ...it, is_read: true } : it)));
      markNotificationRead(n.id).catch(() => {});
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  function handleMarkAllRead() {
    setItems((prev) => prev.map((it) => ({ ...it, is_read: true })));
    markAllNotificationsRead().catch(() => {});
  }

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-bell-btn"
        onClick={() => setOpen((p) => !p)}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
      >
        <BellIcon />
        {unreadCount > 0 && <span className="notif-bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-bell-panel" role="menu">
          <div className="notif-bell-panel-header">
            <span className="notif-bell-panel-title">Notifications</span>
            {unreadCount > 0 && (
              <button type="button" className="notif-bell-mark-all" onClick={handleMarkAllRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className="notif-bell-list">
            {items.length === 0 ? (
              <div className="notif-bell-empty">You're all caught up.</div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`notif-bell-item${!n.is_read ? " unread" : ""}`}
                  onClick={() => handleItemClick(n)}
                >
                  {!n.is_read && <span className="notif-bell-dot" aria-hidden="true" />}
                  <span className="notif-bell-item-body">
                    <span className="notif-bell-item-title">{n.title}</span>
                    {n.sub_text && <span className="notif-bell-item-sub">{n.sub_text}</span>}
                    <span className="notif-bell-item-time">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
