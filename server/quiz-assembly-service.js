/**
 * اقرأ أكثر... ترى أكثر — QUIZ SYSTEM (Phase 10+)
 *
 * Deliberately NOT a separate schema. A "quiz" is an `exams` row with
 * exam_type = 'quiz' — same attempts table, same grading, same autosave/
 * offline logic already built for the Exam System. This service only adds
 * the one thing quizzes need that mock exams don't: quick assembly from
 * a question pool by competency, without an Owner hand-picking every question.
 */

class QuizAssemblyService {
  constructor(db) {
    this.db = db;
  }

  /**
   * quizConfig: { title, ownerId, competencyIds, questionsPerCompetency,
   *               durationMinutes, difficultyMix: {easy, medium, hard} }
   */
  async assembleQuizFromCompetencies(quizConfig) {
    const {
      title, ownerId, competencyIds, questionsPerCompetency = 5,
      durationMinutes = 20, difficultyMix = { easy: 0.4, medium: 0.4, hard: 0.2 },
    } = quizConfig;

    const selectedQuestions = [];
    for (const competencyId of competencyIds) {
      const pool = await this.db.query("quiz_questions", { where: { competency_id: competencyId, is_active: true } });
      selectedQuestions.push(...this._sampleByDifficulty(pool, questionsPerCompetency, difficultyMix));
    }

    if (!selectedQuestions.length) {
      throw new Error("No active questions found in the bank for the selected competencies");
    }

    const exam = await this.db.insert("exams", {
      title, exam_type: "quiz", status: "scheduled", owner_id: ownerId,
      total_points: selectedQuestions.length, duration_minutes: durationMinutes,
    });

    const section = await this.db.insert("exam_sections", {
      exam_id: exam.id, subject: "متنوع", display_order: 0,
      duration_minutes: durationMinutes, total_points: selectedQuestions.length,
    });

    for (const [i, q] of selectedQuestions.entries()) {
      await this.db.insert("exam_section_questions", {
        section_id: section.id, question_id: q.id, display_order: i, points: 1,
      });
      await this.db.update("quiz_questions", q.id, { usage_count: (q.usage_count ?? 0) + 1 });
    }

    return exam;
  }

  /** Also assembles directly from an approved AI `question` draft batch. */
  async assembleQuizFromQuestions(questionIds, quizConfig) {
    const exam = await this.db.insert("exams", {
      title: quizConfig.title, exam_type: "quiz", status: "scheduled",
      owner_id: quizConfig.ownerId, total_points: questionIds.length,
      duration_minutes: quizConfig.durationMinutes,
    });
    const section = await this.db.insert("exam_sections", {
      exam_id: exam.id, subject: quizConfig.subject ?? "متنوع", display_order: 0,
      total_points: questionIds.length,
    });
    for (const [i, questionId] of questionIds.entries()) {
      await this.db.insert("exam_section_questions", { section_id: section.id, question_id: questionId, display_order: i, points: 1 });
    }
    return exam;
  }

  _sampleByDifficulty(pool, count, mix) {
    const byDifficulty = { easy: [], medium: [], hard: [] };
    for (const q of pool) byDifficulty[q.difficulty]?.push(q);

    const targetCounts = {
      easy: Math.round(count * mix.easy),
      medium: Math.round(count * mix.medium),
      hard: Math.round(count * mix.hard),
    };

    const result = [];
    for (const level of ["easy", "medium", "hard"]) {
      const shuffled = [...byDifficulty[level]].sort(() => Math.random() - 0.5);
      result.push(...shuffled.slice(0, targetCounts[level]));
    }
    return result.slice(0, count);
  }
}

module.exports = { QuizAssemblyService };
