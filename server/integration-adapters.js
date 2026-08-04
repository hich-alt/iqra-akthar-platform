/**
 * اقرأ أكثر... ترى أكثر — AI MODULE
 * Integration Adapter Layer (Phase 10+)
 *
 * HONEST STATUS NOTE:
 * This file defines the CONTRACT for every integration point requested.
 * The AI-module side of each contract is fully implemented against
 * ai_draft_queue / ai_generation_jobs. The OTHER side — Curriculum Manager,
 * Lesson Editor, Homework System, etc. — exists so far only as descriptions
 * in the master project document, not as running code I have built in this
 * session. Where a function below calls into one of those systems, it is
 * marked STUB and throws NotImplementedError with a clear message, so a
 * missing integration is loud and traceable rather than a silent no-op.
 * As each real module's code exists, replace the STUB body with the actual
 * call — the AI-module side does not need to change.
 */

class NotImplementedError extends Error {
  constructor(system, method) {
    super(`[integration-pending] ${system}.${method} is not yet implemented — this module doesn't exist as code yet, only in the project spec.`);
    this.name = "NotImplementedError";
    this.system = system;
  }
}

/* ---------------------------------------------------------------------- */
/* 1. CURRICULUM MANAGER — provides competency definitions & structure     */
/* ---------------------------------------------------------------------- */
// STATUS: LIVE (upgraded — curriculum-manager-schema.sql + competencies
// table in question-bank-homework-schema.sql now exist).
const CurriculumManagerAdapter = {
  async getCompetency(db, competencyId) {
    return db.get("competencies", competencyId);
  },
  async competenciesExist(db, ids) {
    const rows = await db.query("competencies", { where: { id_in: ids } });
    return rows.map((r) => r.id);
  },
};

/* ---------------------------------------------------------------------- */
/* 2. LESSON EDITOR — source text for question/plan generation             */
/* ---------------------------------------------------------------------- */
// STATUS: LIVE (upgraded — lessons table now exists).
const LessonEditorAdapter = {
  async getLessonText(db, lessonId) {
    const lesson = await db.get("lessons", lessonId);
    if (!lesson || lesson.status !== "published") {
      // Draft lessons intentionally cannot be used as AI generation source
      // material for student-facing artifacts without the Owner explicitly
      // publishing them first — same principle as ai_draft_queue itself.
      throw new Error(`Lesson ${lessonId} is not published; cannot use as AI source text`);
    }
    return lesson.content_body;
  },
  async lessonsExist(db, ids) {
    const rows = await db.query("lessons", { where: { id_in: ids } });
    return rows.map((r) => r.id);
  },
};

/* ---------------------------------------------------------------------- */
/* 3. HOMEWORK SYSTEM — receives AI recommendations, provides submissions  */
/* ---------------------------------------------------------------------- */
// STATUS: LIVE (upgraded — homework-grading-service.js + schema now exist).
const HomeworkSystemAdapter = {
  async getSubmissionHistory(db, studentId) {
    return db.query("homework_submissions", { where: { student_id: studentId, status: "graded" } });
  },
  async publishAiRecommendation(db, studentId, recommendationDraft) {
    // Revision-plan drafts don't create a homework row directly — they
    // reference existing published lessons/homework via lesson_id, per
    // ConcoursModuleAdapter.publishRevisionPlan. This method exists for
    // recommendation types that DO create a new homework assignment
    // (e.g. "assign these 5 questions as remedial homework").
    return db.insert("homework", {
      title: recommendationDraft.payload.title ?? "واجب مقترح من المساعد الذكي",
      status: "draft", // Owner must still explicitly move draft -> assigned
      owner_id: recommendationDraft.owner_id,
      source_draft_id: recommendationDraft.id,
      competency_ids: recommendationDraft.source_competency_ids ?? [],
    });
  },
};

/* ---------------------------------------------------------------------- */
/* 4. HOMEWORK LIBRARY — where approved AI-drafted homework items land     */
/* ---------------------------------------------------------------------- */
// STATUS: LIVE — homework_questions join table now exists.
const HomeworkLibraryAdapter = {
  async publishHomeworkItem(db, approvedDraft) {
    const homework = await db.insert("homework", {
      title: approvedDraft.payload.title ?? "واجب",
      status: "draft",
      owner_id: approvedDraft.owner_id,
      source_draft_id: approvedDraft.id,
      competency_ids: approvedDraft.source_competency_ids ?? [],
    });
    for (const [i, q] of (approvedDraft.payload.questions ?? []).entries()) {
      const bankQuestion = await db.findQuestionByPromptAndCompetency(q.prompt, q.competency_id);
      if (bankQuestion) {
        await db.insert("homework_questions", { homework_id: homework.id, question_id: bankQuestion.id, display_order: i, points: q.points ?? 1 });
      }
    }
    return { entityId: homework.id, entityTable: "homework" };
  },
};

/* ---------------------------------------------------------------------- */
/* 5. QUESTION BANK — REAL integration, this table's shape is known        */
/* ---------------------------------------------------------------------- */
// STATUS: LIVE CONTRACT. This is the one integration we can fully implement
// because `question` drafts and a question bank table are both defined in
// this bounded context's own schema plus the quiz system's known shape.
const QuestionBankAdapter = {
  async publish(db, approvedDraft) {
    const inserted = [];
    for (const q of approvedDraft.payload.questions) {
      const row = await db.insert("quiz_questions", {
        prompt: q.prompt,
        type: q.type,
        options: q.options ?? null,
        correct_answer: q.correct_answer,
        competency_id: q.competency_id,
        difficulty: q.difficulty,
        source: "ai_generated",
        source_draft_id: approvedDraft.id,
      });
      inserted.push(row);
    }
    return { entityId: inserted[0]?.id, entityTable: "quiz_questions", allIds: inserted.map((r) => r.id) };
  },
  async similarQuestionExists(db, promptText, { threshold }) {
    // Real implementation would use pg_trgm similarity() or an embedding
    // index; this delegates to db.similarQuestionExists which is the seam
    // ai-validation.js already calls.
    return db.similarQuestionExists(promptText, { threshold });
  },
};

/* ---------------------------------------------------------------------- */
/* 6. QUIZ SYSTEM / 7. QUIZ LIBRARY — consumes published questions         */
/* ---------------------------------------------------------------------- */
// STATUS: LIVE (upgraded — quiz-assembly-service.js now exists; a "quiz" is
// an `exams` row with exam_type='quiz', reusing the Exam System entirely
// rather than duplicating attempt/grading/autosave logic).
const QuizSystemAdapter = {
  async assembleQuizFromQuestions(quizAssemblyService, questionIds, quizConfig) {
    return quizAssemblyService.assembleQuizFromQuestions(questionIds, quizConfig);
  },
};

/* ---------------------------------------------------------------------- */
/* 8. EXAM SYSTEM — receives published mock_exam drafts                    */
/* ---------------------------------------------------------------------- */
// STATUS: LIVE (upgraded from stub — exam-system-schema.sql now exists).
const ExamSystemAdapter = {
  async publish(db, approvedDraft) {
    if (approvedDraft.draft_type !== "mock_exam") throw new Error("Draft is not a mock_exam type");
    const payload = approvedDraft.payload;

    const exam = await db.insert("exams", {
      title: payload.exam_title,
      exam_type: "mock_concours",
      status: "scheduled",
      owner_id: approvedDraft.owner_id,
      source_draft_id: approvedDraft.id,
      total_points: payload.sections.reduce((sum, s) => sum + (s.total_points ?? 0), 0),
    });

    for (const [i, section] of payload.sections.entries()) {
      const sectionRow = await db.insert("exam_sections", {
        exam_id: exam.id, subject: section.subject, display_order: i,
        duration_minutes: section.duration_minutes, total_points: section.total_points,
        instructions: section.instructions,
      });

      for (const [j, q] of section.questions.entries()) {
        // Each question must already exist in quiz_questions — mock_exam
        // drafts reference questions by competency_id/prompt, so this step
        // assumes the individual `question` drafts were approved/published
        // to the Question Bank first (see QuestionBankAdapter.publish).
        const bankQuestion = await db.findQuestionByPromptAndCompetency(q.prompt, q.competency_id);
        if (!bankQuestion) {
          throw new Error(`Question not found in bank for mock_exam publish: "${q.prompt.slice(0, 40)}..." — publish it to the Question Bank first`);
        }
        await db.insert("exam_section_questions", {
          section_id: sectionRow.id, question_id: bankQuestion.id, display_order: j, points: q.points,
        });
      }
    }

    return { entityId: exam.id, entityTable: "exams" };
  },
};

/* ---------------------------------------------------------------------- */
/* 9. CONCOURS MODULE — consumes revision_plan and readiness_summary        */
/* ---------------------------------------------------------------------- */
// STATUS: LIVE (upgraded — concours-module-schema.sql + readiness-service.js now exist).
const ConcoursModuleAdapter = {
  async publishRevisionPlan(db, approvedDraft, readinessService) {
    return readinessService.publishRevisionPlan(db, approvedDraft);
  },
  async getConcoursCalendar(readinessService) {
    return readinessService.getConcoursCalendar();
  },
};

/* ---------------------------------------------------------------------- */
/* 10. STUDENT DASHBOARD — reads published AI artifacts only, never drafts */
/* ---------------------------------------------------------------------- */
// STATUS: LIVE (upgraded — student-dashboard-service.js now exists and is
// the actual enforcement point: it never queries ai_draft_queue, filters
// lessons to 'published', filters revision_plans to is_visible_to_student,
// and strips ungraded homework of feedback/score).
const StudentDashboardAdapter = {
  async getPublishedRevisionPlan(studentDashboardService, studentId) {
    const dashboard = await studentDashboardService.getDashboard(studentId);
    return dashboard.revisionPlan;
  },
};

/* ---------------------------------------------------------------------- */
/* 11. OWNER DASHBOARD — REAL, this module owns these widgets directly     */
/* ---------------------------------------------------------------------- */
const OwnerDashboardAdapter = {
  async getReviewQueueSummary(db, ownerId) {
    const drafts = await db.query("ai_draft_queue", { where: { owner_id: ownerId } });
    return {
      pending: drafts.filter((d) => d.status === "pending_review").length,
      approved: drafts.filter((d) => d.status === "approved").length,
      published: drafts.filter((d) => d.status === "published").length,
    };
  },
  async getCostSummary(db) {
    return db.query("ai_usage_analytics", {}); // materialized view, defined in schema
  },
};

/* ---------------------------------------------------------------------- */
/* 12. PLATFORM REPORTS / 13. ANALYTICS — REAL, feeds from existing views  */
/* ---------------------------------------------------------------------- */
const PlatformReportsAdapter = {
  async getAiUsageReport(db, { from, to }) {
    return db.query("ai_usage_analytics", { where: { day_between: [from, to] } });
  },
};

/* ---------------------------------------------------------------------- */
/* 14. RECOMMENDATION ENGINE — consumes weakness_analysis                  */
/* ---------------------------------------------------------------------- */
// STATUS: LIVE (upgraded — recommendation-engine.js now exists). Computes
// on demand from competency_scores + published lessons/homework; does not
// call the AI API itself, keeping "AI only assists the Owner" intact.
const RecommendationEngineAdapter = {
  async ingestWeaknessAnalysis(recommendationEngine, studentId) {
    // "Ingest" here means "recompute now" since this engine has no persisted
    // state to update — weakness signal already lives in competency_scores.
    return recommendationEngine.getRecommendationsForStudent(studentId);
  },
};

/* ---------------------------------------------------------------------- */
/* 15. GAMIFICATION — awarding XP/badges is NEVER triggered by AI directly */
/* ---------------------------------------------------------------------- */
// STATUS: DELIBERATELY NOT INTEGRATED. Gamification rewards must be tied
// to verified student actions (quiz completion, streaks), not to an AI
// draft's existence — an AI-generated question being *approved* should not
// itself grant XP to anyone. Flagging this as an intentional non-integration,
// not a missing one.
const GamificationAdapter = {
  note: "Intentionally not connected — AI artifacts do not award XP/badges directly.",
};

/* ---------------------------------------------------------------------- */
/* 16. CERTIFICATES — separate prompt-template system, not this queue      */
/* ---------------------------------------------------------------------- */
// STATUS: OUT OF SCOPE for ai_draft_queue. Certificate/card image-generation
// prompts (already covered in your earlier prompt-engineering work for
// graduation portraits and exam-success cards) are a distinct generation
// path using image models, not this text-JSON draft pipeline. No merge
// attempted here — kept separate deliberately to avoid conflating two
// different content types under one review workflow.
const CertificatesAdapter = {
  note: "Certificate generation uses a separate image-prompt pipeline, intentionally not merged into ai_draft_queue.",
};

/* ---------------------------------------------------------------------- */
/* 17. NOTIFICATION CENTER — notify Owner of pending reviews                */
/* ---------------------------------------------------------------------- */
// STATUS: LIVE (upgraded — notification-center-schema.sql now exists).
const NotificationCenterAdapter = {
  async notifyOwnerPendingReview(db, ownerId, draftId) {
    return db.insert("notifications", {
      recipient_id: ownerId,
      type: "ai_pending_review",
      title: "مسودة جديدة بانتظار المراجعة",
      link_entity_table: "ai_draft_queue",
      link_entity_id: draftId,
    });
  },
  async notifyStudentRevisionPlanReady(db, studentId, revisionPlanId) {
    return db.insert("notifications", {
      recipient_id: studentId,
      type: "revision_plan_ready",
      title: "خطة مراجعتك الأسبوعية جاهزة",
      link_entity_table: "revision_plans",
      link_entity_id: revisionPlanId,
    });
  },
};

/* ---------------------------------------------------------------------- */
/* 18. SEARCH ENGINE — index published (never draft) AI content            */
/* ---------------------------------------------------------------------- */
// STATUS: LIVE (upgraded) — uses Postgres full-text search (tsvector) over
// already-published domain tables directly, rather than a separate search
// index table, since the platform's scale doesn't yet justify a dedicated
// search infrastructure (e.g. Elasticsearch/Algolia).
const SearchEngineAdapter = {
  async indexPublishedArtifact(db, entityTable, entityId) {
    // With Postgres full-text search, "indexing" means ensuring a
    // `search_vector tsvector` generated column + GIN index exists on the
    // target table (lessons, quiz_questions, homework) — a one-time DDL
    // concern, not a per-row action. This method is a deliberate no-op
    // placeholder call site so future migrations to a dedicated search
    // service have an obvious single integration point to change.
    return { indexed: true, table: entityTable, id: entityId, strategy: "postgres_fts" };
  },
  async search(db, query, { tables = ["lessons", "quiz_questions", "homework"] } = {}) {
    // Deliberately excludes ai_draft_queue from `tables` by default — drafts
    // must never surface in search results.
    return db.fullTextSearch(query, { tables, excludeStatuses: { lessons: ["draft", "archived"] } });
  },
};

module.exports = {
  NotImplementedError,
  CurriculumManagerAdapter, LessonEditorAdapter, HomeworkSystemAdapter,
  HomeworkLibraryAdapter, QuestionBankAdapter, QuizSystemAdapter,
  ExamSystemAdapter, ConcoursModuleAdapter, StudentDashboardAdapter,
  OwnerDashboardAdapter, PlatformReportsAdapter, RecommendationEngineAdapter,
  GamificationAdapter, CertificatesAdapter, NotificationCenterAdapter,
  SearchEngineAdapter,
};
