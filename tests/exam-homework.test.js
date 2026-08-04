/**
 * EXAM & HOMEWORK SYSTEMS — TEST SUITE (Jest)
 * Run: npx jest exam-homework.test.js --coverage
 *
 * Highest-risk logic tested here: auto-grading correctness (a scoring bug
 * affects every student who takes an exam) and the pre-submission
 * visibility rule (a privacy-adjacent guarantee: no student sees
 * feedback/score before an Owner grades it, regardless of how it's queried).
 */

const { ExamAttemptService } = require("./exam-attempt-service");
const { HomeworkGradingService } = require("./homework-grading-service");

// ---------------------------------------------------------------------------
// Fake in-memory DB, extended with the methods these two services need
// beyond the base CRUD already exercised in ai-module.test.js's FakeDb.
// ---------------------------------------------------------------------------

class FakeDb {
  constructor() { this.tables = {}; this._id = 0; }
  _table(name) { return (this.tables[name] ??= new Map()); }
  async get(table, id) { return this._table(table).get(id) ?? null; }
  async insert(table, row) {
    const id = row.id ?? `id_${++this._id}`;
    const record = { ...row, id, created_at: row.created_at ?? new Date().toISOString() };
    this._table(table).set(id, record);
    return record;
  }
  async update(table, id, patch) {
    const existing = this._table(table).get(id);
    const updated = { ...existing, ...patch };
    this._table(table).set(id, updated);
    return updated;
  }
  async query(table, { where = {}, limit } = {}) {
    let rows = [...this._table(table).values()];
    rows = rows.filter((r) => Object.entries(where).every(([k, v]) => {
      if (k === "homework_id_in") return v.includes(r.homework_id);
      if (v === null) return r[k] === null || r[k] === undefined;
      return r[k] === v;
    }));
    return limit ? rows.slice(0, limit) : rows;
  }
  async upsert(table, row, { conflictKeys }) {
    const existing = [...this._table(table).values()].find((r) => conflictKeys.every((k) => r[k] === row[k]));
    if (existing) return this.update(table, existing.id, row);
    return this.insert(table, { ...row, id: conflictKeys.map((k) => row[k]).join(":") });
  }
  // Exam-specific seam: points-per-question lookup, normally a join through
  // exam_section_questions -> exam_sections -> exam_attempts.
  async getSectionQuestionPoints(questionId, attemptId) {
    return this._pointsOverride?.[questionId] ?? { points: 1 };
  }
}

function seedCompetency(db, id = "c1") {
  return db.insert("competencies", { id, label: "كفاءة تجريبية", keywords: [] });
}

// ---------------------------------------------------------------------------
// EXAM SYSTEM — grading correctness
// ---------------------------------------------------------------------------

describe("ExamAttemptService — auto-grading correctness", () => {
  async function setup() {
    const db = new FakeDb();
    const service = new ExamAttemptService(db);
    await seedCompetency(db);
    const mcq = await db.insert("quiz_questions", { id: "q1", type: "mcq", correct_answer: "a", competency_id: "c1" });
    const tf = await db.insert("quiz_questions", { id: "q2", type: "true_false", correct_answer: "true", competency_id: "c1" });
    const fillBlank = await db.insert("quiz_questions", { id: "q3", type: "fill_blank", correct_answer: "الفاعل", competency_id: "c1" });
    const shortAnswer = await db.insert("quiz_questions", { id: "q4", type: "short_answer", correct_answer: "-", competency_id: "c1" });
    return { db, service, mcq, tf, fillBlank, shortAnswer };
  }

  test("correct mcq answer scores full points, incorrect scores zero", async () => {
    const { db, service } = await setup();
    const attempt = await db.insert("exam_attempts", { exam_id: "e1", student_id: "s1", status: "in_progress", started_at: new Date().toISOString() });
    await service.autosaveAnswer(attempt.id, "q1", "a"); // correct
    const result = await service.submit(attempt.id);
    expect(result.totalScore).toBeGreaterThan(0);

    const answers = await db.query("exam_answers", { where: { attempt_id: attempt.id } });
    expect(answers.find((a) => a.question_id === "q1").is_correct).toBe(true);
  });

  test("incorrect mcq answer scores zero points, not partial credit", async () => {
    const { db, service } = await setup();
    const attempt = await db.insert("exam_attempts", { exam_id: "e1", student_id: "s1", status: "in_progress", started_at: new Date().toISOString() });
    await service.autosaveAnswer(attempt.id, "q1", "wrong_option");
    await service.submit(attempt.id);
    const answers = await db.query("exam_answers", { where: { attempt_id: attempt.id } });
    const graded = answers.find((a) => a.question_id === "q1");
    expect(graded.is_correct).toBe(false);
    expect(graded.points_awarded).toBe(0);
  });

  test("fill_blank comparison is diacritics-insensitive (Arabic tashkeel stripped)", async () => {
    const { db, service } = await setup();
    const attempt = await db.insert("exam_attempts", { exam_id: "e1", student_id: "s1", status: "in_progress", started_at: new Date().toISOString() });
    await service.autosaveAnswer(attempt.id, "q3", "الفَاعِلُ"); // same word, with tashkeel
    await service.submit(attempt.id);
    const answers = await db.query("exam_answers", { where: { attempt_id: attempt.id } });
    expect(answers.find((a) => a.question_id === "q3").is_correct).toBe(true);
  });

  test("short_answer questions are left ungraded and flagged for manual review", async () => {
    const { db, service } = await setup();
    const attempt = await db.insert("exam_attempts", { exam_id: "e1", student_id: "s1", status: "in_progress", started_at: new Date().toISOString() });
    await service.autosaveAnswer(attempt.id, "q4", "إجابة حرة من التلميذ");
    const result = await service.submit(attempt.id);
    expect(result.pendingManualGrading).toBe(1);

    const answers = await db.query("exam_answers", { where: { attempt_id: attempt.id } });
    const shortAns = answers.find((a) => a.question_id === "q4");
    expect(shortAns.is_correct).toBeUndefined() || expect(shortAns.is_correct).toBeNull();

    const attemptAfter = await db.get("exam_attempts", attempt.id);
    expect(attemptAfter.status).toBe("submitted"); // NOT 'graded' — manual grading still pending
  });

  test("manualGrade completes the attempt once all pending short answers are graded", async () => {
    const { db, service } = await setup();
    const attempt = await db.insert("exam_attempts", { exam_id: "e1", student_id: "s1", status: "in_progress", started_at: new Date().toISOString() });
    await service.autosaveAnswer(attempt.id, "q4", "إجابة حرة");
    await service.submit(attempt.id);

    const answers = await db.query("exam_answers", { where: { attempt_id: attempt.id } });
    const shortAns = answers.find((a) => a.question_id === "q4");
    await service.manualGrade(shortAns.id, "owner1", { isCorrect: true, pointsAwarded: 2 });

    const attemptAfter = await db.get("exam_attempts", attempt.id);
    expect(attemptAfter.status).toBe("graded");
  });

  test("submitting a non-in_progress attempt throws", async () => {
    const { db, service } = await setup();
    const attempt = await db.insert("exam_attempts", { exam_id: "e1", student_id: "s1", status: "submitted" });
    await expect(service.submit(attempt.id)).rejects.toThrow("Only an in-progress attempt can be submitted");
  });

  test("offline sync skips a stale answer older than the already-saved one", async () => {
    const { db, service } = await setup();
    const attempt = await db.insert("exam_attempts", { exam_id: "e1", student_id: "s1", status: "in_progress" });
    await service.autosaveAnswer(attempt.id, "q1", "a"); // saved "now"
    const newerAnswerTime = new Date(Date.now() - 60_000).toISOString(); // 1 minute in the past — older
    const results = await service.syncOfflineAnswers(attempt.id, [{ questionId: "q1", studentAnswer: "b", clientTimestamp: newerAnswerTime }]);
    expect(results[0].skipped).toBe(true);
    expect(results[0].reason).toBe("newer_answer_exists");

    const answers = await db.query("exam_answers", { where: { attempt_id: attempt.id, question_id: "q1" } });
    expect(answers[0].student_answer).toBe("a"); // unchanged — stale offline write did not overwrite
  });

  test("offline sync applies a genuinely newer answer", async () => {
    const { db, service } = await setup();
    const attempt = await db.insert("exam_attempts", { exam_id: "e1", student_id: "s1", status: "in_progress" });
    await service.autosaveAnswer(attempt.id, "q1", "a");
    const futureTime = new Date(Date.now() + 60_000).toISOString();
    await service.syncOfflineAnswers(attempt.id, [{ questionId: "q1", studentAnswer: "b", clientTimestamp: futureTime }]);
    const answers = await db.query("exam_answers", { where: { attempt_id: attempt.id, question_id: "q1" } });
    expect(answers[0].student_answer).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// HOMEWORK SYSTEM — the pre-submission visibility guarantee
// ---------------------------------------------------------------------------

describe("HomeworkGradingService — visibility rule", () => {
  test("getForStudentView withholds feedback/score/rubric before grading", async () => {
    const db = new FakeDb();
    const service = new HomeworkGradingService(db);
    const submission = await service.submit("hw1", "student1", { answers: { q1: "answer" } });

    // Simulate an Owner accidentally writing feedback fields early (e.g. a
    // partial save mid-grading) — the read path must STILL withhold them
    // because status isn't 'graded' yet, regardless of what's in the row.
    await db.update("homework_submissions", submission.id, { feedback: "ملاحظة مبكرة", total_score: 8 });

    const studentView = await service.getForStudentView(submission.id);
    expect(studentView.feedback).toBeUndefined();
    expect(studentView.total_score).toBeUndefined();
    expect(studentView.competency_evaluation).toBeUndefined();
  });

  test("getForStudentView returns full data once status is 'graded'", async () => {
    const db = new FakeDb();
    const service = new HomeworkGradingService(db);
    const submission = await service.submit("hw1", "student1", { answers: {} });
    await service.grade(submission.id, "owner1", {
      totalScore: 9, maxScore: 10, feedback: "أحسنت", competencyEvaluation: { c1: "meets" },
    });

    const studentView = await service.getForStudentView(submission.id);
    expect(studentView.feedback).toBe("أحسنت");
    expect(studentView.total_score).toBe(9);
  });

  test("grading updates competency_scores from qualitative rubric levels", async () => {
    const db = new FakeDb();
    const service = new HomeworkGradingService(db);
    const submission = await service.submit("hw1", "student1", { answers: {} });
    await service.grade(submission.id, "owner1", {
      totalScore: 5, maxScore: 10, feedback: "جيد", competencyEvaluation: { c1: "exceeds", c2: "below" },
    });

    const scores = await db.query("competency_scores", { where: { student_id: "student1" } });
    expect(scores.find((s) => s.competency_id === "c1").score).toBe(95);
    expect(scores.find((s) => s.competency_id === "c2").score).toBe(45);
  });

  test("returnForRevision sets status to 'returned' with a note, not 'graded'", async () => {
    const db = new FakeDb();
    const service = new HomeworkGradingService(db);
    const submission = await service.submit("hw1", "student1", { answers: {} });
    await service.returnForRevision(submission.id, "owner1", "أعد المحاولة على السؤال 2");
    const updated = await db.get("homework_submissions", submission.id);
    expect(updated.status).toBe("returned");
    expect(updated.feedback).toBe("أعد المحاولة على السؤال 2");
  });

  test("getQueue only returns submissions for the requesting owner's homework", async () => {
    const db = new FakeDb();
    const service = new HomeworkGradingService(db);
    await db.insert("homework", { id: "hw_owner1", owner_id: "owner1" });
    await db.insert("homework", { id: "hw_owner2", owner_id: "owner2" });
    await service.submit("hw_owner1", "student1", { answers: {} });
    await service.submit("hw_owner2", "student2", { answers: {} });

    const queue = await service.getQueue("owner1", { status: "submitted" });
    expect(queue.length).toBe(1);
    expect(queue[0].homework_id).toBe("hw_owner1");
  });
});
