/**
 * اقرأ أكثر... ترى أكثر — HOMEWORK CORRECTION WORKFLOW (Owner-facing)
 *
 * gradeHomework goes through owner_grade_homework() (15-homework-
 * correction-workflow.sql) — the only path that can write feedback/score/
 * correction, since those columns are revoked from `authenticated`
 * directly. This file adds no authorization logic of its own; the RPC
 * checks current_user_role() = 'owner' internally.
 */

import { listResource, callRpc } from "./api-client";
import { can } from "./permissions";
import { useAsync } from "./use-async";
import { ApiError } from "./api-client";
import { log } from "./logger";

function assertCanCorrect(session) {
  if (!can(session, "lesson.create")) {
    // Reused, not reinvented — same allowed-role set as lesson authoring
    // (Owner only), per SECURITY_STANDARDS.md §8.
    throw new ApiError("ليست لديك صلاحية تصحيح الواجبات", { code: "FORBIDDEN", status: 403 });
  }
}

export function usePendingCorrections(session) {
  return useAsync(async () => {
    assertCanCorrect(session);
    const result = await listResource("owner_pending_correction_view", {
      sort: { column: "submitted_at", ascending: true }, page: 1, pageSize: 100,
    });
    return result.data;
  }, [session?.userId]);
}

export function useNonSubmitters(session) {
  return useAsync(async () => {
    assertCanCorrect(session);
    const result = await listResource("owner_non_submitters_view", { page: 1, pageSize: 200 });
    return result.data;
  }, [session?.userId]);
}

export function useHomeworkGradingActions(session) {
  async function gradeHomework(submissionId, { totalScore, maxScore, feedback, competencyEvaluation, correctionFileUrl }) {
    assertCanCorrect(session);
    await callRpc("owner_grade_homework", {
      p_submission_id: submissionId,
      p_total_score: totalScore,
      p_max_score: maxScore,
      p_feedback: feedback,
      p_competency_evaluation: competencyEvaluation ?? {},
      p_correction_file_url: correctionFileUrl ?? null,
    });
    log.info("Homework graded", { actorId: session?.userId, submissionId, totalScore, maxScore, hasCorrection: !!correctionFileUrl });
  }

  return { gradeHomework };
}
