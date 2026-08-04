/**
 * اقرأ أكثر... ترى أكثر — STUDENT MANAGEMENT
 * Query Hooks (new shared layer, built on api-client.js)
 *
 * Every Student Management screen imports from here rather than calling
 * the API client directly, so caching/invalidation stays consistent as
 * more modules (Homework, Exams, Notifications) get their own hook files
 * following this same pattern.
 */

import { getResource, updateResource, bulkUpdateResource, listResource, queryView, ApiError } from "./api-client";
import { can } from "./permissions";
import { useAsync } from "./use-async";
import { log } from "./logger";
import { cacheGet, cacheSet, cacheInvalidate } from "./query-cache";

/**
 * Student List — search/filter/sort/pagination against student_list_view,
 * which already aggregates exam average, pending-grading count, and
 * readiness score server-side (no N+1 fetching per row).
 */
export function useStudentList({ search, filters, sort, page, pageSize, session }) {
  const cacheKey = `students:list:${JSON.stringify({ search, filters, sort, page, pageSize })}`;

  return useAsync(async () => {
    if (!can(session, "student.list.view")) {
      throw new ApiError("ليست لديك صلاحية عرض قائمة التلاميذ", { code: "FORBIDDEN", status: 403 });
    }
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    // FIX (production readiness audit): this previously queried
    // student_profiles for the current page, then separately fetched
    // student_list_view with NO filters at all — pulling every student's
    // aggregate data on every page load regardless of page size. Querying
    // the view directly with the same search/filter/sort/pagination means
    // this now scales with pageSize, not with total enrollment.
    const result = await listResource("student_list_view", {
      search, searchColumns: ["full_name"], filters,
      sort: sort ?? { column: "full_name", ascending: true },
      page, pageSize,
    });

    cacheSet(cacheKey, result);
    return result;
  }, [search, JSON.stringify(filters), JSON.stringify(sort), page, pageSize, session?.userId]);
}

export function useStudentProfile(studentId, session) {
  return useAsync(async () => {
    if (!can(session, "student.profile.view") && session?.userId !== studentId) {
      throw new ApiError("ليست لديك صلاحية عرض هذا الملف", { code: "FORBIDDEN", status: 403 });
    }
    const cacheKey = `students:profile:${studentId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const profile = await getResource("student_profiles", studentId);
    if (!profile) throw new ApiError("لم يتم العثور على هذا التلميذ", { code: "NOT_FOUND", status: 404 });

    // The real boundary is the column-level REVOKE on student_profiles.notes
    // in security-hardening.sql — a student session's Supabase query cannot
    // receive this column at all, regardless of what this hook does. The
    // line below is defense-in-depth only, not the enforcement point; do
    // not rely on it, and do not remove the DB-level revoke thinking this
    // line covers it.
    const safeProfile = can(session, "student.notes.view") ? profile : { ...profile, notes: undefined };
    cacheSet(cacheKey, safeProfile);
    return safeProfile;
  }, [studentId, session?.userId]);
}

export function useStudentAcademicProgress(studentId) {
  return useAsync(async () => {
    return queryView("student_academic_progress_view", { filters: { student_id: studentId } });
  }, [studentId]);
}

export function useStudentActivityTimeline(studentId, { limit = 30 } = {}) {
  return useAsync(async () => {
    return listResource("student_activity_log", {
      filters: { student_id: studentId },
      sort: { column: "occurred_at", ascending: false },
      page: 1, pageSize: limit,
    });
  }, [studentId, limit]);
}

/** Mutations — not useAsync-wrapped since they're triggered imperatively, not on mount. */
export function useStudentMutations(session) {
  async function updateProfile(studentId, patch) {
    if (!can(session, "student.profile.edit")) {
      throw new ApiError("ليست لديك صلاحية تعديل هذا الملف", { code: "FORBIDDEN", status: 403 });
    }
    const updated = await updateResource("student_profiles", studentId, patch);
    log.info("Student profile updated", { actorId: session?.userId, studentId, fields: Object.keys(patch) });
    cacheInvalidate("students:");
    return updated;
  }

  async function bulkUpdateStatus(studentIds, status) {
    if (!can(session, "student.bulk_action")) {
      throw new ApiError("ليست لديك صلاحية تنفيذ إجراء جماعي", { code: "FORBIDDEN", status: 403 });
    }
    const updated = await bulkUpdateResource("student_profiles", studentIds, { status });
    log.info("Bulk student status change", { actorId: session?.userId, studentIds, newStatus: status });
    cacheInvalidate("students:");
    return updated;
  }

  return { updateProfile, bulkUpdateStatus };
}
