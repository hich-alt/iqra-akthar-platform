/**
 * اقرأ أكثر... ترى أكثر — PARENT PORTAL
 * Query Hooks
 *
 * Deliberately thin: every query reuses the exact views/tables
 * use-student-records.js and use-student-dashboard.js already query. The
 * only thing specific to a parent session is discovering WHICH children
 * they're linked to — everything after that is identical to the student's
 * own dashboard, by design (no parallel implementation).
 */

import { listResource, queryView } from "./api-client";
import { useAsync } from "./use-async";

/** parent_student_links is RLS-scoped to the parent's own rows already —
 * this returns exactly the children this session is allowed to see, no
 * client-side filtering needed on top of that. */
export function useLinkedChildren(session) {
  return useAsync(async () => {
    const links = await listResource("parent_student_links", {
      filters: { parent_id: session?.userId, verified: true },
      sort: { column: "created_at", ascending: true },
      page: 1, pageSize: 20,
    });
    if (!links.data.length) return [];

    // Single batched query (api-client.js's listResource uses .in() for
    // array filter values) instead of one query per child — the same N+1
    // pattern already fixed once in useStudentList; caught here before
    // it shipped a second time.
    const studentIds = links.data.map((link) => link.student_id);
    const profiles = await listResource("student_profiles", {
      filters: { user_id: studentIds }, page: 1, pageSize: studentIds.length,
    });
    const nameById = new Map(profiles.data.map((p) => [p.user_id, p.full_name]));

    return links.data.map((link) => ({ ...link, studentName: nameById.get(link.student_id) ?? "—" }));
  }, [session?.userId]);
}

/**
 * Milestone 2: reduced from five queries to two. Per the three-perspective
 * test ("can a parent monitor progress in under a minute?"), a numeric
 * readiness score and a competency-by-competency breakdown are a
 * teacher's tools, not a parent's — they invite a five-minute read, not a
 * one-minute glance. Homework completion + correction feedback answers
 * the actual question a parent has: "is my child keeping up, and how did
 * they do." Exam results are kept (the vision doc explicitly lists "exam
 * results" as a parent-facing item) but reduced to graded results only.
 */
export function useChildDashboard(studentId, session) {
  return useAsync(async () => {
    const [homeworkSummary, examAttempts] = await Promise.all([
      listResource("student_homework_view", { filters: { student_id: studentId }, sort: { column: "submitted_at", ascending: false }, page: 1, pageSize: 20 }),
      queryView("student_exam_attempts_view", { filters: { student_id: studentId }, orderBy: { column: "scheduled_start", ascending: false } }),
    ]);

    return {
      homeworkSummary: homeworkSummary.data,
      examAttempts: examAttempts.filter((e) => e.status === "graded"),
    };
  }, [studentId, session?.userId]);
}
