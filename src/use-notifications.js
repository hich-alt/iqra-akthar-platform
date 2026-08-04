/**
 * اقرأ أكثر... ترى أكثر — NOTIFICATION CENTER
 * Hooks — any authenticated user (Owner, Student, Parent) reads/marks only
 * their own notifications; enforced by notification-center-schema.sql's
 * RLS, not by this file. No role branching needed here at all.
 */

import { listResource, updateResource, bulkUpdateResource } from "./api-client";
import { useAsync } from "./use-async";
import { cacheGet, cacheSet, cacheInvalidate } from "./query-cache";

export function useNotifications(session, { unreadOnly = false, limit = 20 } = {}) {
  return useAsync(async () => {
    const cacheKey = `notifications:${session?.userId}:${unreadOnly}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const result = await listResource("notifications", {
      filters: { recipient_id: session?.userId, ...(unreadOnly ? { is_read: false } : {}) },
      sort: { column: "created_at", ascending: false },
      page: 1, pageSize: limit,
    });
    cacheSet(cacheKey, result.data, 15_000); // short TTL — notifications are the one thing worth refreshing often
    return result.data;
  }, [session?.userId, unreadOnly, limit]);
}

export function useNotificationActions(session) {
  async function markRead(notificationId) {
    const updated = await updateResource("notifications", notificationId, { is_read: true });
    cacheInvalidate(`notifications:${session?.userId}`);
    return updated;
  }

  async function markAllRead(notificationIds) {
    if (!notificationIds.length) return [];
    const updated = await bulkUpdateResource("notifications", notificationIds, { is_read: true });
    cacheInvalidate(`notifications:${session?.userId}`);
    return updated;
  }

  return { markRead, markAllRead };
}
