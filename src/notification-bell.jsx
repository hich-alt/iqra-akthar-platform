import React, { useState } from "react";
import { Bell, CheckCircle2, X } from "lucide-react";
import { useNotifications, useNotificationActions } from "./use-notifications";
import { Skeleton, ErrorBlock } from "./ui-primitives";

/**
 * Notification Bell — a header component, not a page.
 * Embed in any dashboard's header (Owner, Student, Parent) — RLS already
 * scopes results to the current session's own notifications regardless of
 * which dashboard embeds it, so this component needs no role prop at all.
 *
 * student-dashboard-page.jsx currently has its own inline notification
 * section predating this component — per the migration policy, that page
 * adopts this shared component the next time it's touched, not rewritten
 * here as a side effect of building Notifications.
 */
export default function NotificationBell({ session }) {
  const [open, setOpen] = useState(false);
  const { data: notifications, isLoading, error, retry } = useNotifications(session, { unreadOnly: false, limit: 15 });
  const { markRead, markAllRead } = useNotificationActions(session);

  const unreadCount = notifications?.filter((n) => !n.is_read).length ?? 0;

  async function handleMarkAllRead() {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    await markAllRead(unreadIds);
    retry();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`الإشعارات${unreadCount > 0 ? ` — ${unreadCount} غير مقروء` : ""}`}
        aria-expanded={open}
        className="relative p-2 hover:bg-stone-100 rounded-lg focus-visible:ring-2 focus-visible:ring-stone-400"
      >
        <Bell size={18} className="text-stone-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -left-0.5 bg-red-600 text-white text-[10px] rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div dir="rtl" className="absolute left-0 mt-2 w-80 bg-white border border-stone-200 rounded-xl shadow-lg z-40 max-h-96 overflow-auto">
          <div className="flex items-center justify-between p-3 border-b border-stone-100">
            <h3 className="text-sm font-bold">الإشعارات</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button onClick={handleMarkAllRead} className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-1">
                  <CheckCircle2 size={12} /> وضع علامة مقروء للكل
                </button>
              )}
              <button onClick={() => setOpen(false)} aria-label="إغلاق" className="text-stone-400 hover:text-stone-700"><X size={14} /></button>
            </div>
          </div>

          <div className="p-2">
            {isLoading && <Skeleton lines={3} />}
            {error && <ErrorBlock error={error} retry={retry} />}
            {!isLoading && !error && notifications?.length === 0 && (
              <p className="text-xs text-stone-400 text-center py-6">لا توجد إشعارات</p>
            )}
            {!isLoading && !error && notifications?.map((n) => (
              <div key={n.id} className={`flex items-start justify-between gap-2 p-2.5 rounded-lg ${!n.is_read ? "bg-stone-50" : ""}`}>
                <div className="min-w-0">
                  <p className="text-sm truncate">{n.title}</p>
                  {n.body && <p className="text-xs text-stone-400 mt-0.5">{n.body}</p>}
                  <p className="text-xs text-stone-300 mt-0.5">{n.created_at?.slice(0, 10)}</p>
                </div>
                {!n.is_read && (
                  <button onClick={() => markRead(n.id).then(retry)} aria-label="وضع علامة مقروء" className="shrink-0 p-1 hover:bg-stone-200 rounded-md text-stone-400">
                    <CheckCircle2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
