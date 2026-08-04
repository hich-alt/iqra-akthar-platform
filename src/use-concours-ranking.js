/**
 * اقرأ أكثر... ترى أكثر — CONCOURS MODULE
 * Readiness Ranking (Owner-facing only — see concours-module-schema.sql's
 * owner_readiness_ranking_view for the deliberate scoping rationale: this
 * is a teacher's intervention tool, never a student-visible leaderboard.)
 */

import { listResource } from "./api-client";
import { can } from "./permissions";
import { useAsync } from "./use-async";
import { ApiError } from "./api-client";

export function useReadinessRanking(session) {
  return useAsync(async () => {
    if (!can(session, "student.list.view")) {
      // Reuses the existing Owner-only "student.list.view" permission
      // rather than minting a near-identical "concours.ranking.view" —
      // same allowed-role set (Owner only), per SECURITY_STANDARDS.md §8.
      throw new ApiError("ليست لديك صلاحية عرض ترتيب الاستعداد", { code: "FORBIDDEN", status: 403 });
    }
    const result = await listResource("owner_readiness_ranking_view", {
      sort: { column: "score", ascending: false }, page: 1, pageSize: 200,
    });
    return result.data;
  }, [session?.userId]);
}

/**
 * Previous-years mock exam archive ("Previous years archive" — the
 * original Concours Module spec). concours_mock_exam_archive was fixed
 * for a serious cross-student data leak during the Exam System security
 * regression check, but had zero consumers — found completely orphaned
 * during the RC1 convergence audit. Fixed here rather than left dead.
 * Works for any session: the view's own WHERE clause already scopes rows
 * to the caller (own attempts, or all of them if Owner/verified parent),
 * so a student calling this hook simply sees their own history.
 */
export function useMockExamArchive(studentId, session) {
  return useAsync(async () => {
    const result = await listResource("concours_mock_exam_archive", {
      filters: studentId ? { student_id: studentId } : {},
      sort: { column: "scheduled_start", ascending: false },
      page: 1, pageSize: 100,
    });
    return result.data;
  }, [studentId, session?.userId]);
}
