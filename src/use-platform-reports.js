/**
 * اقرأ أكثر... ترى أكثر — REPORTS & ANALYTICS
 *
 * Zero new SQL objects. Every view queried here already returns
 * platform-wide (not per-student) rows when the caller is Owner, because
 * their WHERE clauses already include `(auth.jwt() ->> 'role') = 'owner'`
 * as an unconditional OR — a side effect of how those views were built for
 * Student Dashboard/Parent Portal, not something added for this module.
 * This file only aggregates; it introduces no new authorization surface.
 */

import { listResource, queryView } from "./api-client";
import { can } from "./permissions";
import { useAsync } from "./use-async";
import { ApiError } from "./api-client";

export function usePlatformReports(session) {
  return useAsync(async () => {
    if (!can(session, "student.list.view")) {
      // Reused, not reinvented — same Owner-only permission already
      // gating the Student List page; a platform-wide report is a superset
      // of that same data, not a distinct authorization concern.
      throw new ApiError("ليست لديك صلاحية عرض التقارير", { code: "FORBIDDEN", status: 403 });
    }

    const [examAttempts, homework, competencyRows, readinessRanking] = await Promise.all([
      listResource("student_exam_attempts_view", { page: 1, pageSize: 1000 }),
      listResource("student_homework_view", { page: 1, pageSize: 1000 }),
      queryView("student_academic_progress_view", {}),
      listResource("owner_readiness_ranking_view", { page: 1, pageSize: 500 }),
    ]);

    return {
      examSummary: summarizeExams(examAttempts.data),
      homeworkSummary: summarizeHomework(homework.data),
      competencyHeatmap: summarizeCompetencies(competencyRows),
      readinessDistribution: summarizeReadiness(readinessRanking.data),
    };
  }, [session?.userId]);
}

function summarizeExams(attempts) {
  const graded = attempts.filter((a) => a.status === "graded" && a.max_score > 0);
  const average = graded.length ? graded.reduce((s, a) => s + (a.total_score / a.max_score) * 100, 0) / graded.length : null;
  return {
    totalAttempts: attempts.length,
    gradedCount: graded.length,
    averagePct: average !== null ? +average.toFixed(1) : null,
    lateCount: attempts.filter((a) => a.is_late).length,
  };
}

function summarizeHomework(submissions) {
  const graded = submissions.filter((s) => s.status === "graded");
  return {
    totalSubmissions: submissions.length,
    gradedCount: graded.length,
    pendingCount: submissions.filter((s) => s.status === "submitted").length,
  };
}

function summarizeCompetencies(rows) {
  const bySubject = {};
  for (const row of rows) {
    (bySubject[row.subject] ??= []).push(row.score);
  }
  return Object.entries(bySubject).map(([subject, scores]) => ({
    subject, averageScore: +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1), count: scores.length,
  }));
}

function summarizeReadiness(ranking) {
  if (!ranking.length) return { average: null, distribution: {} };
  const average = +(ranking.reduce((s, r) => s + r.score, 0) / ranking.length).toFixed(1);
  const distribution = { below40: 0, "40to60": 0, "60to80": 0, above80: 0 };
  for (const r of ranking) {
    if (r.score < 40) distribution.below40++;
    else if (r.score < 60) distribution["40to60"]++;
    else if (r.score < 80) distribution["60to80"]++;
    else distribution.above80++;
  }
  return { average, distribution, studentCount: ranking.length };
}
