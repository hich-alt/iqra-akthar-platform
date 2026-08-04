/**
 * اقرأ أكثر... ترى أكثر — EXAM SYSTEM (Owner-facing authoring)
 * Assembly Hooks
 *
 * Reads from owner_quiz_questions_view (exam-security-hardening.sql), the
 * Owner-privileged path to full question data including correct_answer.
 * This is safe to run client-side specifically BECAUSE Owner is the
 * authorized audience for that column — the constraint in
 * CLIENT-SERVER-BOUNDARY.md was about students never seeing it, not that
 * assembly logic itself must be server-side. quiz-assembly-service.js's
 * design is realized here now that a safe Owner read path exists; that
 * file remains the reference algorithm, not a second live implementation —
 * this hook is the one actually wired to the UI.
 */

import { listResource, insertResource, updateResource, ApiError } from "./api-client";
import { can as canPermission } from "./permissions";
import { useAsync } from "./use-async";
import { log } from "./logger";

function assertCanAuthor(session) {
  if (!canPermission(session, "lesson.create")) {
    // Reuses the existing Owner-authoring permission rather than minting a
    // new "exam.create" entry identical in every respect — see permissions.js;
    // if exam authoring ever needs a DIFFERENT allowed-role set than lesson
    // authoring, split it then, not preemptively.
    throw new ApiError("ليست لديك صلاحية إنشاء اختبار", { code: "FORBIDDEN", status: 403 });
  }
}

export function useAvailableQuestions(competencyIds) {
  return useAsync(async () => {
    if (!competencyIds?.length) return [];
    const result = await listResource("owner_quiz_questions_view", {
      filters: { competency_id: competencyIds, is_active: true }, page: 1, pageSize: 500,
    });
    return result.data;
  }, [JSON.stringify(competencyIds)]);
}

export function useExamAuthoringActions(session) {
  function sampleByDifficulty(pool, count, mix = { easy: 0.4, medium: 0.4, hard: 0.2 }) {
    const byDifficulty = { easy: [], medium: [], hard: [] };
    for (const q of pool) byDifficulty[q.difficulty]?.push(q);
    const targetCounts = { easy: Math.round(count * mix.easy), medium: Math.round(count * mix.medium), hard: Math.round(count * mix.hard) };
    const result = [];
    for (const level of ["easy", "medium", "hard"]) {
      const shuffled = [...byDifficulty[level]].sort(() => Math.random() - 0.5);
      result.push(...shuffled.slice(0, targetCounts[level]));
    }
    return result.slice(0, count);
  }

  async function assembleQuizFromCompetencies({ title, examType, competencyIds, questionsPerCompetency = 5, durationMinutes = 20 }) {
    assertCanAuthor(session);
    const pool = await listResource("owner_quiz_questions_view", { filters: { competency_id: competencyIds, is_active: true }, page: 1, pageSize: 500 });

    const selected = [];
    for (const competencyId of competencyIds) {
      selected.push(...sampleByDifficulty(pool.data.filter((q) => q.competency_id === competencyId), questionsPerCompetency));
    }
    if (!selected.length) throw new ApiError("لا توجد أسئلة كافية في بنك الأسئلة للكفاءات المحددة", { code: "EMPTY_POOL" });

    const exam = await insertResource("exams", { title, exam_type: examType, status: "draft", owner_id: session?.userId, total_points: selected.length, duration_minutes: durationMinutes });
    const section = await insertResource("exam_sections", { exam_id: exam.id, subject: "متنوع", display_order: 0, duration_minutes: durationMinutes, total_points: selected.length });
    for (const [i, q] of selected.entries()) {
      await insertResource("exam_section_questions", { section_id: section.id, question_id: q.id, display_order: i, points: 1 });
    }

    log.info("Quiz assembled", { actorId: session?.userId, examId: exam.id, questionCount: selected.length });
    return exam;
  }

  async function scheduleExam(examId, scheduledStart) {
    assertCanAuthor(session);
    const updated = await updateResource("exams", examId, { status: "scheduled", scheduled_start: scheduledStart });
    log.info("Exam scheduled", { actorId: session?.userId, examId, scheduledStart });
    return updated;
  }

  return { assembleQuizFromCompetencies, scheduleExam };
}
