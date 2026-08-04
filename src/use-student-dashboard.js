/**
 * اقرأ أكثر... ترى أكثر — STUDENT DASHBOARD
 * Query Hooks (new — supersedes student-dashboard-service.js, see
 * CLIENT-SERVER-BOUNDARY.md's deprecation note)
 *
 * Every query here relies on RLS + column grants (security-hardening.sql)
 * as the actual enforcement — this file adds no authorization logic of its
 * own beyond the same UX-layer can()/canOnStudent() pattern used everywhere
 * else. A student session querying any of these views/tables directly,
 * bypassing this hook entirely, gets the exact same data this hook returns —
 * that equivalence is the point.
 */

import { listResource, queryView, updateResource } from "./api-client";
import { useAsync } from "./use-async";

/**
 * One dashboard, one hook, four parallel queries. Reduced from five in
 * Milestone 2: readiness score / revision plan removed entirely, not just
 * hidden — per the three-perspective test, a Grade 6 student's daily view
 * has no use for a numeric readiness score; that's a teacher/Concours
 * concern, already scoped out of the student-facing UI. Fewer queries is
 * also just less to fetch on every load.
 */
export function useStudentDashboard(studentId, session) {
  return useAsync(async () => {
    const [currentLessons, homeworkSummary, upcomingExams, unreadNotifications] = await Promise.all([
      // student_current_lesson_view (13-progressive-weekly-publishing.sql)
      // is the backend's own determination of "current lesson per
      // subject" — this hook does not compute "current" itself, per the
      // explicit requirement that this decision live on the server.
      listResource("student_current_lesson_view", { page: 1, pageSize: 20 }),
      listResource("student_homework_view", { filters: { student_id: studentId }, sort: { column: "submitted_at", ascending: false }, page: 1, pageSize: 20 }),
      listResource("exams", { filters: { status: "scheduled" }, sort: { column: "scheduled_start", ascending: true }, page: 1, pageSize: 10 }),
      listResource("notifications", { filters: { recipient_id: studentId, is_read: false }, sort: { column: "created_at", ascending: false }, page: 1, pageSize: 10 }),
    ]);

    return {
      currentLessons: currentLessons.data,
      homeworkSummary: homeworkSummary.data,
      upcomingExams: upcomingExams.data.filter((e) => new Date(e.scheduled_start) > new Date()),
      unreadNotifications: unreadNotifications.data,
    };
  }, [studentId, session?.userId]);
}

export async function markNotificationRead(notificationId) {
  return updateResource("notifications", notificationId, { is_read: true });
}
