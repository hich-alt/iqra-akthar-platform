/**
 * اقرأ أكثر... ترى أكثر — CONCOURS MODULE
 * Readiness Service (Phase 10+)
 *
 * The readiness score is ALWAYS computed here, deterministically, from
 * concrete data. The AI Module's buildReadinessSummaryPrompt only explains
 * a score this service already produced — it never computes or overrides it.
 */

class ReadinessService {
  constructor(db) {
    this.db = db;
  }

  async computeSnapshot(studentId, concoursId) {
    const mockExamAvg = await this._mockExamAverage(studentId);
    const homeworkCompletionPct = await this._homeworkCompletionRate(studentId);
    const streakDays = await this._currentStreak(studentId);
    const competencyCoveragePct = await this._competencyCoverage(studentId);

    // Weights are an explicit, inspectable formula — not a black box.
    const score = Math.round(
      mockExamAvg * 0.4 +
      homeworkCompletionPct * 0.25 +
      Math.min(streakDays / 30, 1) * 100 * 0.15 +
      competencyCoveragePct * 0.20
    );

    const breakdown = { mock_exam_avg: mockExamAvg, homework_completion_pct: homeworkCompletionPct, streak_days: streakDays, competency_coverage_pct: competencyCoveragePct };

    return this.db.insert("readiness_snapshots", {
      student_id: studentId, concours_id: concoursId, score, breakdown,
    });
  }

  async _mockExamAverage(studentId) {
    const rows = await this.db.query("exam_attempts", { where: { student_id: studentId, status: "graded" } });
    const withScores = rows.filter((r) => r.max_score > 0);
    if (!withScores.length) return 0;
    const avg = withScores.reduce((sum, r) => sum + (r.total_score / r.max_score) * 100, 0) / withScores.length;
    return +avg.toFixed(1);
  }

  async _homeworkCompletionRate(studentId) {
    const assigned = await this.db.query("homework", { where: { status: "assigned" } });
    if (!assigned.length) return 0;
    const submissions = await this.db.query("homework_submissions", { where: { student_id: studentId } });
    const submittedIds = new Set(submissions.filter((s) => s.status !== "not_submitted").map((s) => s.homework_id));
    return +((submittedIds.size / assigned.length) * 100).toFixed(1);
  }

  async _currentStreak(studentId) {
    // Real implementation: count consecutive days with at least one
    // graded submission or attempt, walking backward from today.
    return this.db.getStudentStreakDays(studentId);
  }

  async _competencyCoverage(studentId) {
    const scores = await this.db.query("competency_scores", { where: { student_id: studentId } });
    const allCompetencies = await this.db.query("competencies", {});
    if (!allCompetencies.length) return 0;
    const covered = scores.filter((s) => s.score >= 60).length;
    return +((covered / allCompetencies.length) * 100).toFixed(1);
  }

  /**
   * Publishes an approved `revision_plan` AI draft into the domain table.
   * Visibility to the student is a SEPARATE, explicit Owner action from
   * approval — matching "correction is never visible before submission"-style
   * caution: an Owner might approve a plan into the system to review its
   * formatting, then still hold back showing it to the student.
   */
  async publishRevisionPlan(db, approvedDraft, { concoursId } = {}) {
    return db.insert("revision_plans", {
      student_id: approvedDraft.student_id,
      source_draft_id: approvedDraft.id,
      concours_id: concoursId ?? null,
      weekly_plan: approvedDraft.payload.weekly_plan,
      teacher_notes: approvedDraft.payload.notes_for_teacher ?? null,
      is_visible_to_student: false, // Owner must explicitly flip this
    });
  }

  async makeVisibleToStudent(revisionPlanId) {
    return this.db.update("revision_plans", revisionPlanId, { is_visible_to_student: true });
  }

  async getConcoursCalendar() {
    const [next] = await this.db.query("concours_calendar", { orderBy: { exam_date: "asc" }, limit: 1 });
    if (!next) return null;
    const weeksRemaining = Math.max(0, Math.ceil((new Date(next.exam_date) - Date.now()) / (7 * 86400000)));
    return { ...next, weeksRemaining };
  }
}

module.exports = { ReadinessService };
