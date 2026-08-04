/**
 * اقرأ أكثر... ترى أكثر — EXAM SYSTEM
 * Attempt Service (Phase 10+)
 *
 * Handles the full student attempt lifecycle: start, autosave, resume,
 * submit, auto-grade (objective question types only — short_answer always
 * queues for Owner review since free text can't be reliably auto-graded),
 * and offline-sync reconciliation for the platform's PWA/offline requirement.
 */

class ExamAttemptService {
  constructor(db) {
    this.db = db;
  }

  async startOrResume(examId, studentId) {
    const existing = await this.db.query("exam_attempts", { where: { exam_id: examId, student_id: studentId } });
    if (existing.length) {
      const attempt = existing[0];
      if (attempt.status === "not_started") {
        return this.db.update("exam_attempts", attempt.id, { status: "in_progress", started_at: new Date().toISOString() });
      }
      return attempt; // resume in_progress / already submitted, client decides what to show
    }
    return this.db.insert("exam_attempts", {
      exam_id: examId, student_id: studentId, status: "in_progress", started_at: new Date().toISOString(),
    });
  }

  /**
   * Autosave a single answer. Called frequently (e.g. on blur / every few
   * seconds) — idempotent per (attempt_id, question_id) via unique constraint,
   * so repeated calls simply overwrite the prior answer.
   */
  async autosaveAnswer(attemptId, questionId, studentAnswer) {
    const existing = await this.db.query("exam_answers", { where: { attempt_id: attemptId, question_id: questionId } });
    const payload = { attempt_id: attemptId, question_id: questionId, student_answer: studentAnswer, answered_at: new Date().toISOString() };
    const saved = existing.length
      ? await this.db.update("exam_answers", existing[0].id, payload)
      : await this.db.insert("exam_answers", payload);
    await this.db.update("exam_attempts", attemptId, { last_autosave_at: new Date().toISOString() });
    return saved;
  }

  /**
   * Offline sync: client queues answers locally while offline, then replays
   * them here once connectivity returns. Each answer carries its own
   * client-side timestamp so we never overwrite a newer answer with a
   * stale offline one (last-write-wins by client timestamp, not arrival order).
   */
  async syncOfflineAnswers(attemptId, offlineAnswers) {
    const results = [];
    for (const { questionId, studentAnswer, clientTimestamp } of offlineAnswers) {
      const existing = await this.db.query("exam_answers", { where: { attempt_id: attemptId, question_id: questionId } });
      if (existing.length && existing[0].answered_at && existing[0].answered_at > clientTimestamp) {
        results.push({ questionId, skipped: true, reason: "newer_answer_exists" });
        continue;
      }
      results.push(await this.autosaveAnswer(attemptId, questionId, studentAnswer));
    }
    await this.db.update("exam_attempts", attemptId, { is_offline_sync_pending: false });
    return results;
  }

  async submit(attemptId) {
    const attempt = await this.db.get("exam_attempts", attemptId);
    if (attempt.status !== "in_progress") throw new Error("Only an in-progress attempt can be submitted");

    const submittedAt = new Date().toISOString();
    const timeSpent = attempt.started_at ? Math.round((new Date(submittedAt) - new Date(attempt.started_at)) / 1000) : null;

    await this.db.update("exam_attempts", attemptId, {
      status: "submitted", submitted_at: submittedAt, time_spent_seconds: timeSpent,
    });

    return this.autoGrade(attemptId);
  }

  /**
   * Auto-grades objective question types (mcq, true_false, fill_blank).
   * short_answer questions are left ungraded (points_awarded = null,
   * is_correct = null) and queued for Owner manual grading — matching the
   * platform's "correction is never visible before submission" and
   * "AI never replaces pedagogical judgment" rules; this is exact-match
   * auto-grading against a known key, not AI judgment.
   */
  async autoGrade(attemptId) {
    const answers = await this.db.query("exam_answers", { where: { attempt_id: attemptId } });
    let totalScore = 0, maxScore = 0, pendingManualGrading = 0;

    for (const answer of answers) {
      const question = await this.db.get("quiz_questions", answer.question_id);
      const sectionQuestion = await this.db.getSectionQuestionPoints(question.id, attemptId);
      const points = sectionQuestion?.points ?? 1;
      maxScore += points;

      if (question.type === "short_answer") {
        pendingManualGrading++;
        continue; // leave is_correct/points_awarded null
      }

      const isCorrect = this._compareAnswer(question, answer.student_answer);
      const awarded = isCorrect ? points : 0;
      totalScore += awarded;

      await this.db.update("exam_answers", answer.id, { is_correct: isCorrect, points_awarded: awarded });
    }

    const fullyGraded = pendingManualGrading === 0;
    await this.db.update("exam_attempts", attemptId, {
      status: fullyGraded ? "graded" : "submitted", // stays "submitted" until Owner grades the rest
      total_score: totalScore,
      max_score: maxScore,
    });

    if (fullyGraded) {
      await this._refreshCompetencyScores(attemptId);
    }

    return { totalScore, maxScore, pendingManualGrading };
  }

  _compareAnswer(question, studentAnswer) {
    if (question.type === "mcq" || question.type === "true_false") {
      return studentAnswer === question.correct_answer;
    }
    if (question.type === "fill_blank") {
      // Normalize whitespace/diacritics-insensitive comparison for Arabic input.
      const normalize = (s) => (s ?? "").trim().replace(/[\u064B-\u0652]/g, ""); // strip tashkeel
      return normalize(studentAnswer) === normalize(question.correct_answer);
    }
    return false;
  }

  /** Called after full auto-grading; Owner can also trigger manually post manual-grading. */
  async _refreshCompetencyScores(attemptId) {
    const attempt = await this.db.get("exam_attempts", attemptId);
    const breakdown = await this.db.query("attempt_competency_breakdown", { where: { student_id: attempt.student_id } });
    for (const row of breakdown) {
      await this.db.upsert("competency_scores", {
        student_id: row.student_id, competency_id: row.competency_id,
        score: row.score_pct, last_updated: new Date().toISOString(),
      }, { conflictKeys: ["student_id", "competency_id"] });
    }
  }

  /** Owner manually grades a short_answer question after auto-grading leaves it pending. */
  async manualGrade(answerId, ownerId, { isCorrect, pointsAwarded }) {
    const updated = await this.db.update("exam_answers", answerId, { is_correct: isCorrect, points_awarded: pointsAwarded });
    const answer = await this.db.get("exam_answers", answerId);
    const remaining = await this.db.query("exam_answers", { where: { attempt_id: answer.attempt_id, is_correct: null } });
    if (remaining.length === 0) {
      const allAnswers = await this.db.query("exam_answers", { where: { attempt_id: answer.attempt_id } });
      const totalScore = allAnswers.reduce((s, a) => s + (a.points_awarded ?? 0), 0);
      await this.db.update("exam_attempts", answer.attempt_id, { status: "graded", total_score: totalScore });
      await this._refreshCompetencyScores(answer.attempt_id);
    }
    return updated;
  }
}

module.exports = { ExamAttemptService };
