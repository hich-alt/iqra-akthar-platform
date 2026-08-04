/**
 * اقرأ أكثر... ترى أكثر — HOMEWORK SYSTEM
 * Grading Service (Phase 10+)
 *
 * Enforces: "Correction is never visible before submission." A student-facing
 * read of their own submission must never include feedback/score/competency
 * evaluation while status != 'graded', even to the student it belongs to.
 */

class HomeworkGradingService {
  constructor(db) {
    this.db = db;
  }

  async submit(homeworkId, studentId, { answers, uploadedFiles = [], isGroupSubmission = false, groupMemberIds = [] }) {
    const existing = await this.db.query("homework_submissions", { where: { homework_id: homeworkId, student_id: studentId } });
    const payload = {
      homework_id: homeworkId, student_id: studentId, status: "submitted",
      answers, uploaded_files: uploadedFiles, is_group_submission: isGroupSubmission,
      group_member_ids: groupMemberIds, submitted_at: new Date().toISOString(),
    };
    return existing.length
      ? this.db.update("homework_submissions", existing[0].id, payload)
      : this.db.insert("homework_submissions", payload);
  }

  /**
   * READ PATH — this is the enforcement point for "never visible before
   * submission." Any UI (student dashboard, homework library) must call
   * this rather than reading homework_submissions directly.
   */
  async getForStudentView(submissionId) {
    const s = await this.db.get("homework_submissions", submissionId);
    if (!s) return null;
    if (s.status !== "graded") {
      const { feedback, total_score, max_score, competency_evaluation, ...safe } = s;
      return safe; // score/feedback/rubric withheld until graded, regardless of who's asking
    }
    return s;
  }

  async grade(submissionId, ownerId, { totalScore, maxScore, feedback, competencyEvaluation, rubricScores }) {
    const updated = await this.db.update("homework_submissions", submissionId, {
      status: "graded",
      total_score: totalScore,
      max_score: maxScore,
      feedback,
      competency_evaluation: competencyEvaluation,
      graded_at: new Date().toISOString(),
    });

    await this._refreshCompetencyScores(submissionId, competencyEvaluation);
    return updated;
  }

  /**
   * Converts qualitative rubric levels ('exceeds'/'meets'/'below') into the
   * same numeric competency_scores table the Exam System writes to, so the
   * AI Module's weakness-analysis prompt sees a unified signal regardless
   * of whether the evidence came from an exam or homework.
   */
  async _refreshCompetencyScores(submissionId, competencyEvaluation) {
    if (!competencyEvaluation) return;
    const submission = await this.db.get("homework_submissions", submissionId);
    const LEVEL_TO_SCORE = { exceeds: 95, meets: 75, below: 45 };

    for (const [competencyId, level] of Object.entries(competencyEvaluation)) {
      const score = LEVEL_TO_SCORE[level];
      if (score === undefined) continue;
      await this.db.upsert("competency_scores", {
        student_id: submission.student_id, competency_id: competencyId,
        score, last_updated: new Date().toISOString(),
      }, { conflictKeys: ["student_id", "competency_id"] });
    }
  }

  async returnForRevision(submissionId, ownerId, note) {
    return this.db.update("homework_submissions", submissionId, {
      status: "returned",
      feedback: note,
    });
  }

  async getQueue(ownerId, { status = "submitted" } = {}) {
    const homeworkList = await this.db.query("homework", { where: { owner_id: ownerId } });
    const homeworkIds = homeworkList.map((h) => h.id);
    return this.db.query("homework_submissions", { where: { homework_id_in: homeworkIds, status } });
  }
}

module.exports = { HomeworkGradingService };
