/**
 * اقرأ أكثر... ترى أكثر — STUDENT MANAGEMENT
 * Student Records Hooks (extends the use-students.js hook layer)
 *
 * "Quizzes" and "mock exams" are both `exams` rows differentiated by
 * exam_type (see quiz-assembly-service.js / exam-system-schema.sql) — these
 * hooks filter the same table rather than querying a parallel structure.
 */

import { listResource, queryView, ApiError } from "./api-client";
import { can } from "./permissions";
import { useAsync } from "./use-async";

function assertCanViewStudent(session, studentId) {
  if (!can(session, "student.profile.view") && session?.userId !== studentId) {
    throw new ApiError("ليست لديك صلاحية عرض بيانات هذا التلميذ", { code: "FORBIDDEN", status: 403 });
  }
}

export function useStudentHomework(studentId, session, { status } = {}) {
  return useAsync(async () => {
    assertCanViewStudent(session, studentId);
    // Queries student_homework_view (not homework_submissions directly) —
    // the view nulls feedback/score fields until status = 'graded', so the
    // "never visible before submission" rule holds even though this now
    // goes straight to Supabase instead of through homework-grading-service.js.
    return listResource("student_homework_view", {
      filters: { student_id: studentId, ...(status ? { status } : {}) },
      sort: { column: "submitted_at", ascending: false },
      page: 1, pageSize: 50,
    });
  }, [studentId, session?.userId, status]);
}

export function useStudentExams(studentId, session, { examType } = {}) {
  return useAsync(async () => {
    assertCanViewStudent(session, studentId);
    // exam_attempts joined with exams for type/title — modeled as a view
    // for the same reason student_list_view exists: no N+1 from the client.
    const attempts = await queryView("student_exam_attempts_view", {
      filters: { student_id: studentId, ...(examType ? { exam_type: examType } : {}) },
      orderBy: { column: "scheduled_start", ascending: false },
    });
    return attempts;
  }, [studentId, session?.userId, examType]);
}

export function useStudentConcoursSummary(studentId, session) {
  return useAsync(async () => {
    assertCanViewStudent(session, studentId);
    const [readiness, revisionPlan, mockExams] = await Promise.all([
      queryView("student_latest_readiness_view", { filters: { student_id: studentId } }),
      queryView("student_visible_revision_plan_view", { filters: { student_id: studentId } }),
      queryView("student_exam_attempts_view", { filters: { student_id: studentId, exam_type: "mock_concours" } }),
    ]);
    return { readiness: readiness[0] ?? null, revisionPlan: revisionPlan[0] ?? null, mockExams };
  }, [studentId, session?.userId]);
}

export function useStudentAnalytics(studentId, session) {
  return useAsync(async () => {
    assertCanViewStudent(session, studentId);
    // Reuses student_academic_progress_view (already defined in
    // student-management-schema.sql) rather than introducing a parallel
    // analytics table — this hook only reshapes it for chart consumption.
    const progress = await queryView("student_academic_progress_view", { filters: { student_id: studentId } });
    const bySubject = {};
    for (const row of progress) {
      (bySubject[row.subject] ??= []).push({ competency: row.competency_label, score: row.score });
    }
    return { bySubject, overallAverage: progress.length ? +(progress.reduce((s, r) => s + r.score, 0) / progress.length).toFixed(1) : null };
  }, [studentId, session?.userId]);
}
