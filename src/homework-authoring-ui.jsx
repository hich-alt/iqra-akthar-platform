import React, { useState, useMemo } from "react";
import { ClipboardList, Plus, Search, X, Save, Upload, FileText, Users, Calendar, Trash2 } from "lucide-react";

/**
 * Homework Authoring — Owner Dashboard
 * إنشاء الواجبات المنزلية
 *
 * Mocked data demonstrating the workflow: pick questions from the bank
 * (question-bank-homework-schema.sql), configure submission rules, assign
 * with a due date. Wire onSave to HomeworkGradingService / homework tables.
 */

const MOCK_QUESTION_BANK = [
  { id: "q1", prompt: "استخرج اسم الإشارة من الجملة: 'هذا الكتاب مفيد.'", competency: "أسماء الإشارة", difficulty: "easy", source: "ai_generated" },
  { id: "q2", prompt: "اذكر شرطين من شروط الاحتراق.", competency: "الاحتراق", difficulty: "medium", source: "owner_authored" },
  { id: "q3", prompt: "حوّل الجملة التالية إلى صيغة الاستفهام.", competency: "أنواع الجملة", difficulty: "medium", source: "owner_authored" },
  { id: "q4", prompt: "اكتب فقرة وصفية قصيرة عن فصل الخريف.", competency: "التعبير الكتابي الوصفي", difficulty: "hard", source: "ai_generated" },
];

const DIFFICULTY_META = {
  easy: { label: "سهل", color: "#2f6b52" },
  medium: { label: "متوسط", color: "#a8641a" },
  hard: { label: "صعب", color: "#a13c3c" },
};

function QuestionPickerRow({ question, isSelected, onToggle }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${isSelected ? "border-stone-900 bg-stone-50" : "border-stone-200"}`}>
      <input type="checkbox" checked={isSelected} onChange={onToggle} className="shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-stone-800">{question.prompt}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs" style={{ color: DIFFICULTY_META[question.difficulty].color }}>{DIFFICULTY_META[question.difficulty].label}</span>
          <span className="text-xs text-stone-400">· {question.competency}</span>
          {question.source === "ai_generated" && <span className="text-xs text-stone-400">· مولّد بالذكاء الاصطناعي</span>}
        </div>
      </div>
    </div>
  );
}

export default function HomeworkAuthoring() {
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [selectedQuestions, setSelectedQuestions] = useState(new Set());
  const [query, setQuery] = useState("");
  const [allowPhoto, setAllowPhoto] = useState(true);
  const [allowPdf, setAllowPdf] = useState(true);
  const [allowGroup, setAllowGroup] = useState(false);
  const [savedHomeworkList, setSavedHomeworkList] = useState([]);

  const filteredQuestions = useMemo(
    () => MOCK_QUESTION_BANK.filter((q) => !query || q.prompt.includes(query) || q.competency.includes(query)),
    [query]
  );

  function toggleQuestion(id) {
    setSelectedQuestions((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function saveDraft() {
    setSavedHomeworkList((prev) => [
      { id: `hw_${Date.now()}`, title, questionCount: selectedQuestions.size, dueDate, status: "draft" },
      ...prev,
    ]);
    setTitle(""); setInstructions(""); setDueDate(""); setSelectedQuestions(new Set());
  }

  function assignHomework(id) {
    setSavedHomeworkList((prev) => prev.map((h) => (h.id === id ? { ...h, status: "assigned" } : h)));
  }

  const canSave = title.trim().length > 0 && selectedQuestions.size > 0;

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold flex items-center gap-2"><ClipboardList size={20} /> إنشاء واجب منزلي</h1>
          <p className="text-sm text-stone-500 mt-1">التصحيح لا يكون مرئيًا للتلميذ إلا بعد التسليم والتقييم</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 grid grid-cols-3 gap-6">
        {/* Form */}
        <div className="col-span-2 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1.5">عنوان الواجب</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-stone-300" placeholder="مثال: واجب مراجعة أنواع الجملة" />
          </div>

          <div>
            <label className="block text-sm font-medium text-stone-600 mb-1.5">التعليمات</label>
            <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={3} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:ring-2 focus:ring-stone-300" />
          </div>

          <div className="flex items-center gap-2">
            <Calendar size={15} className="text-stone-400" />
            <label className="text-sm font-medium text-stone-600">تاريخ التسليم</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="px-3 py-1.5 rounded-lg border border-stone-200 text-sm" />
          </div>

          <div className="border border-stone-200 rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-3">إعدادات التسليم</h3>
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={allowPhoto} onChange={(e) => setAllowPhoto(e.target.checked)} /><Upload size={14} className="text-stone-400" /> السماح برفع صور</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={allowPdf} onChange={(e) => setAllowPdf(e.target.checked)} /><FileText size={14} className="text-stone-400" /> السماح برفع ملفات PDF</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={allowGroup} onChange={(e) => setAllowGroup(e.target.checked)} /><Users size={14} className="text-stone-400" /> السماح بالعمل الجماعي</label>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold">الأسئلة المختارة ({selectedQuestions.size})</h3>
              <div className="relative">
                <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث في بنك الأسئلة..." className="pr-8 pl-3 py-1.5 rounded-lg border border-stone-200 text-xs" />
              </div>
            </div>
            <div className="space-y-2 max-h-72 overflow-auto">
              {filteredQuestions.map((q) => (
                <QuestionPickerRow key={q.id} question={q} isSelected={selectedQuestions.has(q.id)} onToggle={() => toggleQuestion(q.id)} />
              ))}
            </div>
          </div>

          <button
            disabled={!canSave}
            onClick={saveDraft}
            className={`w-full py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 ${canSave ? "bg-stone-900 text-white" : "bg-stone-200 text-stone-400 cursor-not-allowed"}`}
          >
            <Save size={15} /> حفظ كمسودة
          </button>
        </div>

        {/* Sidebar — saved homework list */}
        <div>
          <h3 className="text-sm font-semibold mb-3 text-stone-500">الواجبات المحفوظة</h3>
          <div className="space-y-2">
            {savedHomeworkList.length === 0 && <p className="text-xs text-stone-400">لا توجد واجبات محفوظة بعد</p>}
            {savedHomeworkList.map((hw) => (
              <div key={hw.id} className="p-3 bg-white border border-stone-200 rounded-lg">
                <p className="text-sm font-medium">{hw.title}</p>
                <p className="text-xs text-stone-400 mt-1">{hw.questionCount} سؤال · موعد التسليم {hw.dueDate || "غير محدد"}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: hw.status === "assigned" ? "#2f6b52" : "#8b8378", backgroundColor: hw.status === "assigned" ? "#e8f3ed" : "#f2f0ec" }}>
                    {hw.status === "assigned" ? "مُسند" : "مسودة"}
                  </span>
                  {hw.status === "draft" && (
                    <button onClick={() => assignHomework(hw.id)} className="text-xs px-2 py-1 bg-stone-900 text-white rounded-md">إسناد الآن</button>
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
