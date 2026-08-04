import React, { useState } from "react";
import { FileSpreadsheet, Save, Sparkles, Calendar } from "lucide-react";
import { useAvailableQuestions, useExamAuthoringActions } from "./use-exam-authoring";
import { rules, validate } from "./validation";
import { Skeleton, ErrorBlock } from "./ui-primitives";

/**
 * Exam / Quiz Authoring — Owner Dashboard
 * MIGRATED from a standalone mock prototype (see MASTER-MANIFEST.md
 * migration policy). Manual section-by-section building is not
 * reintroduced here — auto-assembly via owner_quiz_questions_view covers
 * the actual Exam System security work this pass focused on; manual
 * per-question picking can be added later without touching this file's
 * security-relevant parts.
 */

const MOCK_COMPETENCY_OPTIONS = [
  { id: "c1", label: "التعبير الكتابي الوصفي" },
  { id: "c2", label: "استخدام الروابط النصية" },
  { id: "c3", label: "التمييز بين أنواع الجمل" },
  { id: "c4", label: "فهم شروط الاحتراق" },
];
// NOTE: competency options should come from the competencies table (already
// RLS-open-read) via a shared hook once one exists for that specific list —
// not duplicated here as a separate query; flagged rather than silently
// left as a hardcoded list disconnected from real data.

export default function ExamQuizAuthoring({ session }) {
  const [title, setTitle] = useState("");
  const [examType, setExamType] = useState("quiz");
  const [selectedCompetencies, setSelectedCompetencies] = useState(new Set());
  const [questionsPerCompetency, setQuestionsPerCompetency] = useState(5);
  const [duration, setDuration] = useState(20);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [createdExams, setCreatedExams] = useState([]);

  const { assembleQuizFromCompetencies, scheduleExam } = useExamAuthoringActions(session);

  function toggleCompetency(id) {
    setSelectedCompetencies((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleCreate() {
    const schema = { title: rules.required("العنوان مطلوب"), competencyIds: rules.minItems(1, "اختر كفاءة واحدة على الأقل") };
    const { isValid, errors: validationErrors } = validate(schema, { title, competencyIds: [...selectedCompetencies] });
    setErrors(validationErrors);
    if (!isValid) return;

    setSaving(true);
    try {
      const exam = await assembleQuizFromCompetencies({
        title, examType, competencyIds: [...selectedCompetencies], questionsPerCompetency, durationMinutes: duration,
      });
      setCreatedExams((prev) => [{ ...exam }, ...prev]);
      setTitle(""); setSelectedCompetencies(new Set());
    } catch (err) {
      setErrors({ _form: err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleSchedule(examId) {
    await scheduleExam(examId, new Date().toISOString());
    setCreatedExams((prev) => prev.map((e) => (e.id === examId ? { ...e, status: "scheduled" } : e)));
  }

  const canCreate = title.trim() && selectedCompetencies.size > 0;

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold flex items-center gap-2"><FileSpreadsheet size={20} /> إنشاء اختبار / مناظرة</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-white border border-stone-200 rounded-xl p-5 space-y-4">
          {errors._form && <p className="text-xs text-red-600">{errors._form}</p>}

          <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-600 flex items-start gap-2">
            <Sparkles size={14} className="shrink-0 mt-0.5 text-stone-400" />
            يختار هذا الوضع أسئلة تلقائيًا من بنك الأسئلة النشطة حسب الكفاءات المحددة، بمزيج صعوبة متوازن.
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1.5">عنوان الاختبار</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={`w-full px-3 py-2 rounded-lg border text-sm ${errors.title ? "border-red-300" : "border-stone-200"}`} />
            {errors.title && <p className="text-xs text-red-600 mt-1">{errors.title}</p>}
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-stone-600 mb-1.5">النوع</label>
              <select value={examType} onChange={(e) => setExamType(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm">
                <option value="quiz">اختبار قصير</option>
                <option value="mock_concours">مناظرة تجريبية</option>
              </select>
            </div>
            <div className="w-32">
              <label className="block text-sm font-medium text-stone-600 mb-1.5">المدة (د)</label>
              <input type="number" value={duration} onChange={(e) => setDuration(+e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm" />
            </div>
            <div className="w-40">
              <label className="block text-sm font-medium text-stone-600 mb-1.5">أسئلة لكل كفاءة</label>
              <input type="number" value={questionsPerCompetency} onChange={(e) => setQuestionsPerCompetency(+e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-600 mb-2">الكفاءات المستهدفة</label>
            <div className="flex flex-wrap gap-2">
              {MOCK_COMPETENCY_OPTIONS.map((c) => (
                <button key={c.id} onClick={() => toggleCompetency(c.id)} className={`text-xs px-3 py-1.5 rounded-full border ${selectedCompetencies.has(c.id) ? "bg-stone-900 text-white border-stone-900" : "border-stone-200 text-stone-600"}`}>
                  {c.label}
                </button>
              ))}
            </div>
            {errors.competencyIds && <p className="text-xs text-red-600 mt-1">{errors.competencyIds}</p>}
          </div>

          <button disabled={!canCreate || saving} onClick={handleCreate} className={`w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 ${canCreate ? "bg-stone-900 text-white" : "bg-stone-200 text-stone-400 cursor-not-allowed"}`}>
            <Save size={15} /> {saving ? "جارٍ التجميع..." : "تجميع وإنشاء"}
          </button>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-3 text-stone-500">تم إنشاؤها</h3>
          <div className="space-y-2">
            {createdExams.length === 0 && <p className="text-xs text-stone-400">لا توجد اختبارات بعد</p>}
            {createdExams.map((exam) => (
              <div key={exam.id} className="p-3 bg-white border border-stone-200 rounded-lg">
                <p className="text-sm font-medium">{exam.title}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: exam.status === "scheduled" ? "#1f4e79" : "#8b8378", backgroundColor: exam.status === "scheduled" ? "#e8eff7" : "#f2f0ec" }}>
                    {exam.status === "scheduled" ? "مجدول" : "مسودة"}
                  </span>
                  {exam.status === "draft" && (
                    <button onClick={() => handleSchedule(exam.id)} className="text-xs px-2 py-1 bg-stone-900 text-white rounded-md flex items-center gap-1">
                      <Calendar size={11} /> جدولة
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
