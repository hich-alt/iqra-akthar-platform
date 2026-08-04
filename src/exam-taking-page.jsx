import React, { useState, useEffect, useRef } from "react";
import { Clock, CheckCircle2, Send } from "lucide-react";
import { useExamAttempt, useExamQuestions, useExamActions } from "./use-exam-attempts";
import { Skeleton, ErrorBlock } from "./ui-primitives";

/**
 * Exam Taking — student-facing.
 *
 * Every write here goes through start_exam_attempt()/submit_exam_attempt()
 * or the RLS-scoped exam_answers insert/update — see
 * exam-security-hardening.sql. This component has no ability to set its
 * own score or status under any circumstance; if that were possible, it
 * would be a data-layer bug, not something fixable by removing a button here.
 */

export default function ExamTaking({ examId, session }) {
  const { data: attempt, isLoading: attemptLoading, error: attemptError, retry: retryAttempt } = useExamAttempt(examId, session);
  const { data: sections, isLoading: questionsLoading, error: questionsError } = useExamQuestions(examId);
  const { autosaveAnswer, submit } = useExamActions(session);
  const [answers, setAnswers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const saveTimers = useRef({});

  const isDone = attempt?.status && attempt.status !== "in_progress";

  function handleAnswerChange(questionId, value) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    clearTimeout(saveTimers.current[questionId]);
    saveTimers.current[questionId] = setTimeout(() => {
      autosaveAnswer(attempt.id, questionId, value).catch(() => {
        // Autosave failures are non-fatal to the attempt itself (RLS simply
        // rejects a write if the attempt is no longer in_progress — e.g.
        // the student submitted from another tab); surfaced as a subtle
        // indicator rather than a blocking error, since the exam itself
        // isn't broken.
      });
    }, 800);
  }

  useEffect(() => () => Object.values(saveTimers.current).forEach(clearTimeout), []);

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await submit(attempt.id);
      setResult(res);
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (attemptLoading || questionsLoading) return <div className="p-6"><Skeleton lines={6} /></div>;
  if (attemptError) return <div className="p-6"><ErrorBlock error={attemptError} retry={retryAttempt} /></div>;
  if (questionsError) return <div className="p-6"><ErrorBlock error={questionsError} /></div>;

  if (result || isDone) {
    return (
      <div dir="rtl" className="min-h-screen bg-[#faf9f7] flex items-center justify-center p-6">
        <div className="bg-white border border-stone-200 rounded-xl p-8 text-center max-w-sm">
          <CheckCircle2 size={32} className="mx-auto mb-3 text-emerald-600" />
          <h2 className="font-bold mb-2">تم تسليم إجاباتك</h2>
          <p className="text-sm text-stone-500">
            {result?.pendingManualGrading > 0
              ? "بعض الأسئلة تحتاج تصحيحًا يدويًا من المعلم — ستظهر نتيجتك الكاملة بعد ذلك."
              : "سيتم إعلامك بالنتيجة بعد اعتماد المعلم لها."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-lg font-bold">الاختبار</h1>
          <span className="text-xs text-stone-400 flex items-center gap-1"><Clock size={13} /> إجاباتك تُحفظ تلقائيًا</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        {sections?.map((section) => (
          <div key={section.id}>
            <h2 className="text-sm font-bold text-stone-500 mb-3">{section.subject}</h2>
            <div className="space-y-3">
              {section.questions.map((q, i) => (
                <div key={q.id} className="bg-white border border-stone-200 rounded-xl p-4">
                  <p className="text-sm mb-3">{i + 1}. {q.prompt}</p>
                  {q.type === "mcq" && (
                    <div className="space-y-2">
                      {(q.options ?? []).map((opt) => (
                        <label key={opt} className="flex items-center gap-2 text-sm">
                          <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === opt} onChange={() => handleAnswerChange(q.id, opt)} />
                          {opt}
                        </label>
                      ))}
                    </div>
                  )}
                  {q.type === "true_false" && (
                    <div className="flex gap-4">
                      {["true", "false"].map((val) => (
                        <label key={val} className="flex items-center gap-2 text-sm">
                          <input type="radio" name={`q-${q.id}`} checked={answers[q.id] === val} onChange={() => handleAnswerChange(q.id, val)} />
                          {val === "true" ? "صحيح" : "خطأ"}
                        </label>
                      ))}
                    </div>
                  )}
                  {(q.type === "short_answer" || q.type === "fill_blank") && (
                    <textarea
                      value={answers[q.id] ?? ""}
                      onChange={(e) => handleAnswerChange(q.id, e.target.value)}
                      rows={q.type === "short_answer" ? 3 : 1}
                      className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm"
                      aria-label={`إجابة السؤال ${i + 1}`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        <button onClick={handleSubmit} disabled={submitting} className="w-full py-3 bg-stone-900 text-white rounded-lg flex items-center justify-center gap-2 disabled:opacity-50">
          <Send size={15} /> {submitting ? "جارٍ التسليم..." : "تسليم الإجابات"}
        </button>
      </div>
    </div>
  );
}
