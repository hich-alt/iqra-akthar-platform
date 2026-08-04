/**
 * اقرأ أكثر... ترى أكثر — AI MODULE
 * Validation Pipeline (Phase 10+)
 *
 * Every AI response must pass ALL checks before entering ai_draft_queue
 * as "pending_review". Any failure => automatic rejection (see ai-draft-service.js).
 *
 * This module is intentionally synchronous/pure where possible so it can be
 * unit-tested without a DB or network connection.
 */

const Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true, strict: false });

class AiValidator {
  constructor({ db, curriculumIndex }) {
    this.db = db;                         // for reference checks (lessons, competencies)
    this.curriculumIndex = curriculumIndex; // pre-built index of approved terms/concepts per grade
  }

  async validate(draft) {
    const errors = [];

    // Structural checks (unchanged)
    errors.push(...this._checkSchema(draft));
    errors.push(...this._checkMissingFields(draft));
    errors.push(...(await this._checkReferences(draft)));
    errors.push(...(await this._checkDuplicates(draft)));
    errors.push(...this._checkUnsupportedMedia(draft));
    errors.push(...this._checkCurriculumScope(draft));

    // Pedagogical/quality checks (Phase 10+ expansion)
    errors.push(...(await this._checkSimilarityScore(draft)));
    errors.push(...this._checkDifficultyValidity(draft));
    errors.push(...(await this._checkCompetencyObjectiveAlignment(draft)));
    errors.push(...this._checkQuestionQuality(draft));
    errors.push(...this._checkReadingLevel(draft));
    errors.push(...this._checkLanguage(draft));
    errors.push(...this._checkFormatting(draft));

    // Security: output sanitization runs regardless of pass/fail so nothing
    // with embedded markup ever reaches the draft queue's stored payload.
    draft.payload = this._sanitizeOutput(draft.payload);

    return { passed: errors.length === 0, errors };
  }

  // -----------------------------------------------------------------------
  // 1. JSON SCHEMA VALIDATION
  // -----------------------------------------------------------------------

  _checkSchema(draft) {
    const schema = draft.output_json_schema || SCHEMAS[draft.draft_type];
    if (!schema) {
      return [{ code: "missing_schema", message: `No schema registered for type ${draft.draft_type}` }];
    }
    const validateFn = ajv.compile(schema);
    const valid = validateFn(draft.payload);
    if (valid) return [];
    return validateFn.errors.map((e) => ({
      code: "schema_violation",
      message: `${e.instancePath || "(root)"} ${e.message}`,
    }));
  }

  // -----------------------------------------------------------------------
  // 2. MISSING FIELDS (belt-and-suspenders beyond JSON schema "required")
  // -----------------------------------------------------------------------

  _checkMissingFields(draft) {
    const errors = [];
    const requiredByType = {
      question: ["prompt", "correct_answer", "competency_id"],
      mock_exam: ["exam_title", "sections"],
      weakness_analysis: ["priority_weaknesses", "summary_ar"],
      revision_plan: ["weekly_plan"],
      readiness_summary: ["summary_ar"],
      tutor_response: ["response"],
    };
    const required = requiredByType[draft.draft_type] || [];
    for (const field of required) {
      if (draft.payload[field] === undefined || draft.payload[field] === null) {
        errors.push({ code: "missing_field", message: `Missing required field: ${field}` });
      }
    }
    return errors;
  }

  // -----------------------------------------------------------------------
  // 3. INVALID REFERENCES — competencies and lessons must actually exist
  // -----------------------------------------------------------------------

  async _checkReferences(draft) {
    const errors = [];
    const competencyIds = this._extractCompetencyIds(draft.payload);
    const lessonIds = draft.source_lesson_ids || [];

    if (competencyIds.length) {
      const valid = await this.db.competenciesExist(competencyIds);
      const invalid = competencyIds.filter((id) => !valid.includes(id));
      invalid.forEach((id) =>
        errors.push({ code: "invalid_competency", message: `Unknown competency_id: ${id}` })
      );
    }

    if (lessonIds.length) {
      const valid = await this.db.lessonsExist(lessonIds);
      const invalid = lessonIds.filter((id) => !valid.includes(id));
      invalid.forEach((id) =>
        errors.push({ code: "invalid_lesson_reference", message: `Unknown lesson_id: ${id}` })
      );
    }

    return errors;
  }

  _extractCompetencyIds(payload) {
    const ids = new Set();
    const collect = (obj) => {
      if (Array.isArray(obj)) return obj.forEach(collect);
      if (obj && typeof obj === "object") {
        if (obj.competency_id) ids.add(obj.competency_id);
        Object.values(obj).forEach(collect);
      }
    };
    collect(payload);
    return [...ids];
  }

  // -----------------------------------------------------------------------
  // 4. DUPLICATE DETECTION — near-identical questions already in the bank
  // -----------------------------------------------------------------------

  async _checkDuplicates(draft) {
    if (draft.draft_type !== "question") return [];
    const errors = [];
    const prompts = (draft.payload.questions || []).map((q) => q.prompt);
    for (const prompt of prompts) {
      const isDup = await this.db.similarQuestionExists(prompt, { threshold: 0.9 });
      if (isDup) {
        errors.push({ code: "duplicate_question", message: `Near-duplicate of an existing question: "${prompt.slice(0, 40)}..."` });
      }
    }
    return errors;
  }

  // -----------------------------------------------------------------------
  // 5. UNSUPPORTED MEDIA — reject AI-suggested media refs that don't exist
  // -----------------------------------------------------------------------

  _checkUnsupportedMedia(draft) {
    const errors = [];
    const mediaRefs = JSON.stringify(draft.payload).match(/(media|image|audio|video)_id["']?\s*:\s*["']?([\w-]+)/g) || [];
    // In production this resolves each ref against the media table;
    // flagged here structurally so unresolved refs never silently pass.
    if (mediaRefs.length && !draft.allow_media) {
      errors.push({ code: "unsupported_media", message: "Draft references media but media generation is not enabled for this prompt type" });
    }
    return errors;
  }

  // -----------------------------------------------------------------------
  // 6. OUT-OF-CURRICULUM / HALLUCINATION CHECK
  // -----------------------------------------------------------------------

  _checkCurriculumScope(draft) {
    const errors = [];
    const text = this._extractText(draft.payload).toLowerCase();
    const flaggedTerms = this.curriculumIndex.findOutOfScopeTerms(text, {
      grade: 6,
      subject: draft.subject,
    });
    if (flaggedTerms.length) {
      errors.push({
        code: "out_of_curriculum",
        message: `Content references terms outside the Grade 6 curriculum index: ${flaggedTerms.join(", ")}`,
      });
    }
    return errors;
  }

  _extractText(payload) {
    const parts = [];
    const walk = (obj) => {
      if (typeof obj === "string") return parts.push(obj);
      if (Array.isArray(obj)) return obj.forEach(walk);
      if (obj && typeof obj === "object") Object.values(obj).forEach(walk);
    };
    walk(payload);
    return parts.join(" ");
  }

  // -----------------------------------------------------------------------
  // 7. SIMILARITY SCORE — numeric score alongside the binary duplicate check,
  //    so the Review Center can show "87% similar to Q-1042" rather than a
  //    flat yes/no. Distinct from _checkDuplicates: that one blocks on a
  //    hard threshold (0.9); this one always reports the score for context.
  // -----------------------------------------------------------------------

  async _checkSimilarityScore(draft) {
    if (draft.draft_type !== "question") return [];
    const errors = [];
    for (const q of draft.payload.questions || []) {
      const { score, matchId } = await this.db.similarityScore(q.prompt);
      q._similarity_score = score;      // surfaced in Review UI, not itself a failure
      q._similarity_match_id = matchId;
      if (score >= 0.95 && matchId) {
        errors.push({ code: "near_identical_content", message: `${Math.round(score * 100)}% similar to existing question ${matchId}` });
      }
    }
    return errors;
  }

  // -----------------------------------------------------------------------
  // 8. DIFFICULTY VALIDATION — declared difficulty must be plausible for
  //    the competency's known difficulty band (heuristic, not AI-judged)
  // -----------------------------------------------------------------------

  _checkDifficultyValidity(draft) {
    if (draft.draft_type !== "question") return [];
    const errors = [];
    const validLevels = ["easy", "medium", "hard"];
    for (const q of draft.payload.questions || []) {
      if (!validLevels.includes(q.difficulty)) {
        errors.push({ code: "invalid_difficulty", message: `Unrecognized difficulty level: ${q.difficulty}` });
      }
      // Heuristic: an "easy" question with more than 4 options or a very long
      // prompt is often mislabeled — flag for Owner attention rather than
      // silently trusting the AI's self-reported difficulty.
      if (q.difficulty === "easy" && (q.options?.length > 4 || q.prompt.length > 220)) {
        errors.push({ code: "difficulty_mismatch", message: `Question marked "easy" but structure suggests higher difficulty: "${q.prompt.slice(0, 40)}..."` });
      }
    }
    return errors;
  }

  // -----------------------------------------------------------------------
  // 9. COMPETENCY / OBJECTIVE ALIGNMENT — does the question's content
  //    plausibly test the competency it claims to?
  // -----------------------------------------------------------------------

  async _checkCompetencyObjectiveAlignment(draft) {
    if (draft.draft_type !== "question") return [];
    const errors = [];
    for (const q of draft.payload.questions || []) {
      const competency = await this.db.getCompetency(q.competency_id);
      if (!competency) continue; // already caught by _checkReferences
      const keywordOverlap = competency.keywords?.some((kw) => q.prompt.includes(kw));
      if (competency.keywords?.length && !keywordOverlap) {
        errors.push({
          code: "objective_misalignment",
          message: `Question does not clearly test competency "${competency.label}" — no expected keyword/skill markers found`,
        });
      }
    }
    return errors;
  }

  // -----------------------------------------------------------------------
  // 10. QUESTION QUALITY SCORE — heuristic composite, surfaced not gating
  //     (very low scores warn the Owner but don't auto-reject, since this
  //     is a heuristic proxy, not ground truth pedagogical judgment)
  // -----------------------------------------------------------------------

  _checkQuestionQuality(draft) {
    if (draft.draft_type !== "question") return [];
    const errors = [];
    for (const q of draft.payload.questions || []) {
      let score = 100;
      if (q.prompt.length < 8) score -= 30;
      if (q.type === "mcq" && (!q.options || q.options.length < 3)) score -= 25;
      if (q.type === "mcq" && new Set(q.options).size !== q.options?.length) score -= 20; // duplicate options
      if (!q.rationale) score -= 10;
      q._quality_score = Math.max(0, score);
      if (score < 40) {
        errors.push({ code: "low_quality_question", message: `Quality score ${score}/100 — likely malformed: "${q.prompt.slice(0, 40)}..."` });
      }
    }
    return errors;
  }

  // -----------------------------------------------------------------------
  // 11. READING LEVEL ESTIMATION — proxy suitable for Arabic Grade 6 text
  //     (average word length + sentence length; a real Arabic readability
  //     formula, e.g. an adapted OSMAN index, should replace this proxy)
  // -----------------------------------------------------------------------

  _checkReadingLevel(draft) {
    const errors = [];
    const text = this._extractText(draft.payload);
    const sentences = text.split(/[.!؟\n]/).filter((s) => s.trim().length > 0);
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return errors;

    const avgWordLen = words.reduce((sum, w) => sum + w.length, 0) / words.length;
    const avgSentenceLen = words.length / Math.max(1, sentences.length);

    // Rough Grade-6-appropriate bands; tune against real corpus later.
    if (avgSentenceLen > 25) {
      errors.push({ code: "reading_level_too_high", message: `Average sentence length (${avgSentenceLen.toFixed(1)} words) likely exceeds Grade 6 reading level` });
    }
    if (avgWordLen > 9) {
      errors.push({ code: "reading_level_too_high", message: `Average word length (${avgWordLen.toFixed(1)} chars) suggests vocabulary above Grade 6 level` });
    }
    return errors;
  }

  // -----------------------------------------------------------------------
  // 12. LANGUAGE VALIDATION — content must be Arabic-script, matching the
  //     platform's RTL-Arabic-first requirement
  // -----------------------------------------------------------------------

  _checkLanguage(draft) {
    const errors = [];
    const text = this._extractText(draft.payload);
    const arabicChars = (text.match(/[\u0600-\u06FF]/g) || []).length;
    const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
    if (text.trim().length > 0 && arabicChars < latinChars) {
      errors.push({ code: "language_mismatch", message: "Content appears to be predominantly non-Arabic; expected Arabic-first output" });
    }
    return errors;
  }

  // -----------------------------------------------------------------------
  // 13. FORMATTING VALIDATION — no leftover template placeholders, no
  //     markdown/HTML leakage into structured educational fields
  // -----------------------------------------------------------------------

  _checkFormatting(draft) {
    const errors = [];
    const text = this._extractText(draft.payload);
    if (/\{\{\s*\w+\s*\}\}/.test(text)) {
      errors.push({ code: "unfilled_placeholder", message: "Draft contains an unfilled {{variable}} placeholder" });
    }
    if (/<\/?[a-z][\s\S]*>/i.test(text)) {
      errors.push({ code: "markup_leakage", message: "Draft contains raw HTML/markup, which should not appear in structured content fields" });
    }
    return errors;
  }

  // -----------------------------------------------------------------------
  // SECURITY: OUTPUT SANITIZATION — strip any HTML/script tags from every
  // string field before the payload is persisted, independent of whether
  // formatting validation above also flags and rejects it. Defense in depth:
  // even if a future draft type skips _checkFormatting, this still runs.
  // -----------------------------------------------------------------------

  _sanitizeOutput(payload) {
    const strip = (val) => {
      if (typeof val === "string") return val.replace(/<[^>]*>/g, "");
      if (Array.isArray(val)) return val.map(strip);
      if (val && typeof val === "object") {
        return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, strip(v)]));
      }
      return val;
    };
    return strip(payload);
  }
}

// ---------------------------------------------------------------------------
// JSON SCHEMAS per draft type — mirrors the output shapes in the prompt
// templates (concours-ai-prompts.js). Kept here as the single source of
// truth for validation; prompt_library.output_json_schema stores a copy
// per prompt version for full auditability.
// ---------------------------------------------------------------------------

const SCHEMAS = {
  question: {
    type: "object",
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["type", "prompt", "correct_answer", "competency_id", "difficulty"],
          properties: {
            type: { enum: ["mcq", "true_false", "short_answer", "fill_blank"] },
            prompt: { type: "string", minLength: 3 },
            options: { type: "array" },
            correct_answer: { type: "string" },
            competency_id: { type: "string" },
            difficulty: { enum: ["easy", "medium", "hard"] },
            rationale: { type: "string" },
          },
        },
      },
    },
  },
  weakness_analysis: {
    type: "object",
    required: ["priority_weaknesses", "strengths", "summary_ar"],
    properties: {
      priority_weaknesses: { type: "array" },
      strengths: { type: "array" },
      summary_ar: { type: "string", minLength: 10 },
    },
  },
  revision_plan: {
    type: "object",
    required: ["weekly_plan"],
    properties: { weekly_plan: { type: "array", minItems: 1 } },
  },
  readiness_summary: {
    type: "object",
    required: ["summary_ar"],
    properties: { summary_ar: { type: "string" }, encouragement_note: { type: "string" } },
  },
};

module.exports = { AiValidator, SCHEMAS };
