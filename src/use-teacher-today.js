/**
 * اقرأ أكثر... ترى أكثر — TEACHER "TODAY" VIEW
 *
 * Zero new SQL, zero new authorization logic. Reframes three things that
 * already exist (owner_lesson_browser_view, owner_pending_correction_view,
 * owner_non_submitters_view) around the single question this milestone
 * asks a teacher's home screen to answer: "what do I need to publish
 * today?" — plus what needs correcting, since that's the other action a
 * teacher takes between classes.
 */

import { listResource } from "./api-client";
import { can } from "./permissions";
import { useAsync } from "./use-async";
import { ApiError } from "./api-client";

export function useTeacherToday(session) {
  return useAsync(async () => {
    if (!can(session, "lesson.create")) {
      throw new ApiError("ليست لديك صلاحية عرض هذه الصفحة", { code: "FORBIDDEN", status: 403 });
    }

    const [lessons, pending, nonSubmitters] = await Promise.all([
      listResource("owner_lesson_browser_view", { page: 1, pageSize: 500 }),
      listResource("owner_pending_correction_view", { page: 1, pageSize: 200 }),
      listResource("owner_non_submitters_view", { page: 1, pageSize: 200 }),
    ]);

    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const needsAttention = lessons.data.filter((l) => {
      if (l.status === "draft") return true; // always worth surfacing — nothing scheduled yet
      if (l.status === "scheduled") return l.publish_date && new Date(l.publish_date) <= todayEnd;
      return false;
    });

    return {
      needsAttention,
      pendingCorrectionCount: pending.data.length,
      nonSubmitterCount: nonSubmitters.data.length,
    };
  }, [session?.userId]);
}
