/**
 * اقرأ أكثر... ترى أكثر — RECOMMENDATION ENGINE (Phase 10+)
 *
 * No new schema. This is deliberately a read-model computed on demand from
 * competency_scores + published lessons/homework/questions — data that
 * already exists from the Exam System, Homework System, and AI weakness
 * analysis. Recommendations are NOT AI-generated text; they're a ranked
 * list the Owner can act on (assign this homework, review this lesson),
 * keeping the "AI only assists the Owner" rule intact — this engine doesn't
 * even call the AI API, it just ranks existing published content.
 */

class RecommendationEngine {
  constructor(db) {
    this.db = db;
  }

  async getRecommendationsForStudent(studentId, { limit = 5 } = {}) {
    const weakCompetencies = await this._getWeakCompetencies(studentId);
    if (!weakCompetencies.length) return [];

    const recommendations = [];
    for (const { competencyId, score } of weakCompetencies) {
      const lessons = await this.db.query("published_lessons", { where: { competency_ids_contains: competencyId } });
      const homeworkItems = await this.db.query("homework", { where: { status: "assigned", competency_ids_contains: competencyId } });

      if (lessons[0]) {
        recommendations.push({
          type: "review_lesson", competencyId, priority: this._priority(score),
          lessonId: lessons[0].id, title: lessons[0].title,
          reason: `درجة الأداء في هذه الكفاءة ${score}% — يُنصح بمراجعة الدرس`,
        });
      }
      if (homeworkItems[0]) {
        recommendations.push({
          type: "assign_homework", competencyId, priority: this._priority(score),
          homeworkId: homeworkItems[0].id, title: homeworkItems[0].title,
          reason: `تمرين إضافي متاح لهذه الكفاءة`,
        });
      }
    }

    return recommendations
      .sort((a, b) => b.priority - a.priority)
      .slice(0, limit);
  }

  async _getWeakCompetencies(studentId) {
    const scores = await this.db.query("competency_scores", { where: { student_id: studentId } });
    return scores
      .filter((s) => s.score < 60)
      .map((s) => ({ competencyId: s.competency_id, score: s.score }))
      .sort((a, b) => a.score - b.score);
  }

  _priority(score) {
    if (score < 40) return 3; // high
    if (score < 60) return 2; // medium
    return 1; // low
  }
}

module.exports = { RecommendationEngine };
