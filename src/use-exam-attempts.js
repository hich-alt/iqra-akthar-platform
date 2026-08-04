/**
 * اقرأ أكثر... ترى أكثر — EXAM SYSTEM (student-facing)
 * Attempt Hooks
 *
 * status/total_score/max_score are NEVER written from here directly — only
 * via start_exam_attempt()/submit_exam_attempt() (exam-security-hardening.sql).
 * Column grants on exam_attempts/exam_answers make any other write path
 * fail at the database, not just get ignored by this hook's own logic.
 */

import { listResource, callRpc } from "./api-client";
import { useAsync } from "./use-async";
import { log } from "./logger";

export function useExamAttempt(examId, session) {
  return useAsync(async () => {
    const attempt = await callRpc("start_exam_attempt", { p_exam_id: examId });
    return attempt;
  }, [examId, session?.userId]);
}

export function useExamAnswers(attemptId) {
  return useAsync(async () => {
    if (!attemptId) return [];
    // student_exam_answers_view, NOT the base exam_answers table — the
    // base table has is_correct/points_awarded revoked from `authenticated`
    // (exam-threat-model-fixes.sql), so `select("*")` against it errors
    // outright for a student session. Found unused (and this bug with it)
    // during the RC1 convergence audit.
    const result = await listResource("student_exam_answers_view", { filters: { attempt_id: attemptId }, page: 1, pageSize: 200 });
    return result.data;
  }, [attemptId]);
}

export function useExamQuestions(examId) {
  return useAsync(async () => {
    // quiz_questions_safe_view — never the base table — see
    // security-hardening.sql: correct_answer/rationale are not selectable
    // by `authenticated` at all, so querying the base table here would
    // error outright, not just under-return.
    const sections = await listResource("exam_sections", { filters: { exam_id: examId }, sort: { column: "display_order", ascending: true }, page: 1, pageSize: 20 });
    const questionLinks = await Promise.all(
      sections.data.map((s) => listResource("exam_section_questions", { filters: { section_id: s.id }, sort: { column: "display_order", ascending: true }, page: 1, pageSize: 100 }))
    );
    const allQuestionIds = questionLinks.flatMap((q) => q.data.map((row) => row.question_id));
    const questions = allQuestionIds.length
      ? await listResource("quiz_questions_safe_view", { filters: { id: allQuestionIds }, page: 1, pageSize: allQuestionIds.length })
      : { data: [] };
    const questionById = new Map(questions.data.map((q) => [q.id, q]));

    return sections.data.map((s, i) => ({
      ...s,
      questions: questionLinks[i].data.map((link) => ({ ...questionById.get(link.question_id), points: link.points, displayOrder: link.display_order })),
    }));
  }, [examId]);
}

export function useExamActions(session) {
  async function autosaveAnswer(attemptId, questionId, studentAnswer) {
    // Direct exam_answers writes are revoked from `authenticated` entirely
    // (exam-threat-model-fixes.sql, Finding 3) — this RPC is the only path,
    // and it takes an advisory lock shared with submit_exam_attempt so the
    // two can't race against each other.
    return callRpc("autosave_exam_answer", { p_attempt_id: attemptId, p_question_id: questionId, p_answer: studentAnswer });
  }

  async function submit(attemptId) {
    const result = await callRpc("submit_exam_attempt", { p_attempt_id: attemptId });
    log.info("Exam attempt submitted", { actorId: session?.userId, attemptId, isLate: result.isLate });
    return result;
  }

  return { autosaveAnswer, submit };
}
