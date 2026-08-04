/**
 * اقرأ أكثر... ترى أكثر — Concours AI Assistant
 * Claude API Prompt Templates (Phase 10+ — AI Expansion)
 *
 * Conventions used across all templates:
 * - Every generator returns STRICT JSON, no markdown fences, no preamble.
 * - Every generated artifact lands in ai_draft_queue with status "pending" —
 *   nothing is shown to students until the Owner approves it.
 * - All content must be in Modern Standard Arabic, aligned with the official
 *   Tunisian Grade 6 curriculum (المقاربة بالكفايات) and appropriate for
 *   10-12 year olds.
 * - Templates are functions so they can be composed with live data
 *   (lesson text, competency scores, etc.) at call time.
 */

const MODEL = "claude-sonnet-4-6";

/* ---------------------------------------------------------------------- */
/* 1. AI DRAFT GENERATOR — quiz questions / mock exam items from a lesson */
/* ---------------------------------------------------------------------- */

function buildQuestionDraftPrompt({ lessonText, competencyId, questionCount = 5, difficulty = "mixed" }) {
  const system = `أنت مساعد تربوي متخصص في إعداد أسئلة تقييمية لتلاميذ السنة السادسة ابتدائي في تونس،
وفق المقاربة بالكفايات والمنهج الرسمي التونسي.
مهمتك: اقتراح مسودة أسئلة اعتمادًا فقط على النص المقدم من المعلم.
لا تُدرج أي معلومة أو مفهوم غير موجود في النص المصدر.
لا تُنتج أي محتوى نهائي — هذه مسودة تخضع لمراجعة المعلم واعتماده قبل النشر.
أعد الإجابة بصيغة JSON صارمة فقط، دون أي نص إضافي أو علامات markdown.`;

  const user = `النص المصدر (الدرس):
"""
${lessonText}
"""

معرّف الكفاءة المستهدفة: ${competencyId}
عدد الأسئلة المطلوب: ${questionCount}
مستوى الصعوبة: ${difficulty} (سهل / متوسط / صعب / متنوع)

أعد JSON بهذا الشكل بالضبط:
{
  "questions": [
    {
      "type": "mcq | true_false | short_answer | fill_blank",
      "prompt": "نص السؤال",
      "options": ["..."],
      "correct_answer": "...",
      "competency_id": "${competencyId}",
      "difficulty": "easy | medium | hard",
      "rationale": "تفسير موجز لماذا يقيس هذا السؤال الكفاءة المستهدفة"
    }
  ]
}`;

  return { model: MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: user }] };
}

/* ---------------------------------------------------------------------- */
/* 2. MOCK EXAM GENERATOR — full concours-style paper                     */
/* ---------------------------------------------------------------------- */

function buildMockExamPrompt({ sourceLessons, examStructure }) {
  // sourceLessons: array of { title, text, competencyId }
  // examStructure: e.g. { arabic: 10, math: 10, science: 5 } minutes/counts per section
  const system = `أنت خبير في إعداد مناظرات تجريبية لمناظرة الدخول إلى المدارس الإعدادية النموذجية.
اعتمد حصريًا على الدروس المقدمة لك، ولا تخترع مفاهيم خارج المنهج التونسي للسنة السادسة.
يجب أن يحاكي التمرين شكل وأسلوب المناظرة الرسمية (تعليمات واضحة، تدرّج في الصعوبة، توزيع نقاط).
أعد الإجابة بصيغة JSON صارمة فقط، دون أي نص إضافي.`;

  const lessonsBlock = sourceLessons
    .map((l, i) => `[${i + 1}] (${l.competencyId}) ${l.title}:\n${l.text}`)
    .join("\n\n");

  const user = `الدروس المصدر:
${lessonsBlock}

هيكل المناظرة المطلوب (بالدقائق/عدد الأسئلة لكل قسم):
${JSON.stringify(examStructure)}

أعد JSON بهذا الشكل:
{
  "exam_title": "...",
  "sections": [
    {
      "subject": "...",
      "instructions": "...",
      "duration_minutes": 0,
      "total_points": 0,
      "questions": [
        { "prompt": "...", "points": 0, "type": "...", "competency_id": "..." }
      ]
    }
  ],
  "answer_key": [ { "question_ref": "...", "correct_answer": "..." } ]
}`;

  return { model: MODEL, max_tokens: 4000, system, messages: [{ role: "user", content: user }] };
}

/* ---------------------------------------------------------------------- */
/* 3. WEAKNESS DETECTION ANALYSIS                                         */
/* ---------------------------------------------------------------------- */

function buildWeaknessAnalysisPrompt({ studentName, competencyScores }) {
  // competencyScores: [{ competency_id, label, score (0-100), attempts, trend }]
  const system = `أنت محلل تربوي. مهمتك تحليل بيانات أداء تلميذ عبر الكفاءات المختلفة
وتحديد نقاط الضعف الحقيقية، دون تخمين أسباب نفسية أو شخصية لم تُذكر في البيانات.
اعتمد فقط على الأرقام المقدمة. لا تُصدر أي حكم على شخصية التلميذ أو قدراته العامة.
أعد الإجابة بصيغة JSON صارمة فقط.`;

  const user = `بيانات الأداء حسب الكفاءة:
${JSON.stringify(competencyScores, null, 2)}

أعد JSON بهذا الشكل:
{
  "priority_weaknesses": [
    { "competency_id": "...", "severity": "high | medium | low", "evidence": "وصف قائم على الأرقام فقط" }
  ],
  "strengths": [ { "competency_id": "...", "evidence": "..." } ],
  "summary_ar": "فقرة موجزة (3-4 أسطر) بصيغة محايدة وبنّاءة"
}`;

  return { model: MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: user }] };
}

/* ---------------------------------------------------------------------- */
/* 4. PERSONAL REVISION PLAN GENERATOR                                    */
/* ---------------------------------------------------------------------- */

function buildRevisionPlanPrompt({ weaknessAnalysis, weeksUntilConcours, availableLessons }) {
  const system = `أنت مخطط تربوي. اقترح خطة مراجعة أسبوعية لتلميذ استعدادًا لمناظرة الدخول
إلى المدارس الإعدادية النموذجية، اعتمادًا فقط على نقاط الضعف المحددة والدروس المتوفرة فعليًا للمعلم.
لا تقترح أي مورد أو درس غير موجود في القائمة المقدمة.
هذه مسودة تخضع لمراجعة المعلم قبل عرضها على التلميذ.
أعد الإجابة بصيغة JSON صارمة فقط.`;

  const user = `تحليل نقاط الضعف:
${JSON.stringify(weaknessAnalysis, null, 2)}

عدد الأسابيع المتبقية إلى المناظرة: ${weeksUntilConcours}

الدروس/الموارد المتاحة (يجب الاختيار منها فقط):
${JSON.stringify(availableLessons, null, 2)}

أعد JSON بهذا الشكل:
{
  "weekly_plan": [
    {
      "week_number": 1,
      "focus_competencies": ["..."],
      "recommended_resources": [ { "lesson_id": "...", "reason": "..." } ],
      "suggested_daily_minutes": 0
    }
  ],
  "notes_for_teacher": "أي ملاحظة يجب أن يطّلع عليها المعلم قبل الاعتماد"
}`;

  return { model: MODEL, max_tokens: 1800, system, messages: [{ role: "user", content: user }] };
}

/* ---------------------------------------------------------------------- */
/* 5. READINESS SUMMARY — plain-language explanation of a computed score  */
/*    NOTE: the readiness score itself is computed deterministically in   */
/*    application code, NOT by the AI. This prompt only explains it.      */
/* ---------------------------------------------------------------------- */

function buildReadinessSummaryPrompt({ studentName, readinessScore, breakdown }) {
  const system = `أنت مساعد تربوي. مهمتك صياغة شرح واضح ومشجّع لدرجة جاهزية محسوبة مسبقًا،
دون تغيير الدرجة أو إعادة حسابها. حافظ على نبرة إيجابية وبنّاءة، وتجنب أي حكم نهائي
على قدرات التلميذ. أعد الإجابة بصيغة JSON صارمة فقط.`;

  const user = `درجة الجاهزية المحسوبة: ${readinessScore}/100
تفاصيل الاحتساب:
${JSON.stringify(breakdown, null, 2)}

أعد JSON بهذا الشكل:
{
  "summary_ar": "فقرة من 3-5 أسطر بلغة عربية بسيطة تناسب ولي أمر وتلميذ",
  "encouragement_note": "جملة تشجيعية قصيرة"
}`;

  return { model: MODEL, max_tokens: 600, system, messages: [{ role: "user", content: user }] };
}

/* ---------------------------------------------------------------------- */
/* 6. STUDENT-FACING AI TUTOR — strictly scoped                           */
/* ---------------------------------------------------------------------- */

function buildStudentTutorPrompt({ studentQuestion, allowedLessonTexts }) {
  const system = `أنت مساعد تعليمي لتلميذ في السنة السادسة ابتدائي في تونس.
يجب أن تجيب فقط باستخدام المحتوى الموجود في الدروس المرفقة أدناه.
إذا كان سؤال التلميذ خارج نطاق هذه الدروس، أخبره بلطف أن هذا الموضوع
سيُدرس لاحقًا أو أنه خارج البرنامج الحالي، ولا تُجب عنه من معرفتك العامة.
لا تقيّم التلميذ ولا تصدر أحكامًا على قدراته. استخدم لغة مبسطة ومشجعة.`;

  const lessonsBlock = allowedLessonTexts
    .map((l, i) => `[${i + 1}] ${l.title}:\n${l.text}`)
    .join("\n\n");

  const user = `الدروس المسموح الاعتماد عليها:
${lessonsBlock}

سؤال التلميذ: "${studentQuestion}"`;

  return { model: MODEL, max_tokens: 800, system, messages: [{ role: "user", content: user }] };
}

module.exports = {
  buildQuestionDraftPrompt,
  buildMockExamPrompt,
  buildWeaknessAnalysisPrompt,
  buildRevisionPlanPrompt,
  buildReadinessSummaryPrompt,
  buildStudentTutorPrompt,
};
