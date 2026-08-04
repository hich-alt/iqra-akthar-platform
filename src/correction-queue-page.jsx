import React, { useState } from "react";
import { ClipboardCheck, Upload, Users, Save } from "lucide-react";
import { usePendingCorrections, useNonSubmitters, useHomeworkGradingActions } from "./use-homework-grading";
import { uploadFile, getPublicUrl } from "./api-client";
import { rules, validate } from "./validation";
import { Skeleton, ErrorBlock, EmptyState } from "./ui-primitives";

/**
 * Teacher Correction Queue — the workflow surface Milestone 1 required:
 * "students who did not submit" + "homework waiting for correction" in
 * one place, built on owner_grade_homework() and the two Owner-only views
 * from 15-homework-correction-workflow.sql.
 */

function GradeForm({ submission, session, onGraded }) {
  const { gradeHomework } = useHomeworkGradingActions(session);
  const [totalScore, setTotalScore] = useState("");
  const [maxScore, setMaxScore] = useState("10");
  const [feedback, setFeedback] = useState("");
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const schema = {
    totalScore: rules.required("العلامة مطلوبة"),
    feedback: rules.required("الملاحظات مطلوبة"),
  };

  async function handleSubmit() {
    const { isValid, errors: validationErrors } = validate(schema, { totalScore, feedback });
    setErrors(validationErrors);
    if (!isValid) return;

    setSaving(true);
    try {
      let correctionFileUrl = null;
      if (file) {
        const path = `${submission.student_id}/${submission.submission_id}-correction-${file.name}`;
        await uploadFile("homework-uploads", path, file);
        correctionFileUrl = getPublicUrl("homework-uploads", path);
      }
      await gradeHomework(submission.submission_id, {
        totalScore: Number(totalScore), maxScore: Number(maxScore), feedback, correctionFileUrl,
      });
      onGraded();
    } catch (err) {
      setErrors({ _form: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 p-3 bg-stone-50 border border-stone-200 rounded-lg space-y-2">
      {errors._form && <p className="text-xs text-red-600">{errors._form}</p>}
      <div className="flex gap-2">
        <input type="number" value={totalScore} onChange={(e) => setTotalScore(e.target.value)} placeholder="العلامة" className="w-24 px-2 py-1.5 rounded-md border border-stone-200 text-sm" />
        <span className="self-center text-stone-400 text-sm">/</span>
        <input type="number" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} className="w-24 px-2 py-1.5 rounded-md border border-stone-200 text-sm" />
      </div>
      {errors.totalScore && <p className="text-xs text-red-600">{errors.totalScore}</p>}
      <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="ملاحظات..." rows={2} className="w-full px-2 py-1.5 rounded-md border border-stone-200 text-sm" />
      {errors.feedback && <p className="text-xs text-red-600">{errors.feedback}</p>}
      <label className="flex items-center gap-2 text-xs text-stone-500 cursor-pointer">
        <Upload size={13} /> {file ? file.name : "إرفاق تصحيح (اختياري)"}
        <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setFile(e.target.files[0])} />
      </label>
      <button onClick={handleSubmit} disabled={saving} className="px-3 py-1.5 bg-stone-900 text-white text-xs rounded-md flex items-center gap-1 disabled:opacity-50">
        <Save size={12} /> {saving ? "جارٍ الحفظ..." : "حفظ التصحيح"}
      </button>
    </div>
  );
}

export default function CorrectionQueue({ session }) {
  const { data: pending, isLoading, error, retry } = usePendingCorrections(session);
  const { data: nonSubmitters, isLoading: nsLoading } = useNonSubmitters(session);
  const [openId, setOpenId] = useState(null);

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold flex items-center gap-2"><ClipboardCheck size={20} /> قائمة التصحيح</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <h3 className="text-sm font-bold mb-3">بانتظار التصحيح ({pending?.length ?? 0})</h3>
          {isLoading && <Skeleton lines={4} />}
          {error && <ErrorBlock error={error} retry={retry} />}
          {!isLoading && !error && pending?.length === 0 && <EmptyState message="لا توجد واجبات بانتظار التصحيح" />}
          <div className="space-y-2">
            {pending?.map((s) => (
              <div key={s.submission_id} className="bg-white border border-stone-200 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{s.student_name}</p>
                    <p className="text-xs text-stone-400">{s.lesson_title ?? "—"} · {s.submitted_at?.slice(0, 10)}</p>
                  </div>
                  <button onClick={() => setOpenId(openId === s.submission_id ? null : s.submission_id)} className="text-xs text-stone-600 hover:text-stone-900">
                    {openId === s.submission_id ? "إغلاق" : "تصحيح"}
                  </button>
                </div>
                {openId === s.submission_id && (
                  <GradeForm submission={s} session={session} onGraded={() => { setOpenId(null); retry(); }} />
                )}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold mb-3 flex items-center gap-1.5"><Users size={14} /> لم يسلّموا بعد</h3>
          {nsLoading && <Skeleton lines={3} />}
          {!nsLoading && nonSubmitters?.length === 0 && <p className="text-xs text-stone-400">الجميع سلّم واجباته</p>}
          <div className="space-y-1.5">
            {nonSubmitters?.slice(0, 15).map((n) => (
              <div key={`${n.homework_id}-${n.student_id}`} className="text-xs bg-white border border-stone-200 rounded-lg p-2">
                <span className="font-medium">{n.student_name}</span>
                <span className="text-stone-400"> — {n.homework_title}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
