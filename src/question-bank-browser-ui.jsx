import React, { useState, useMemo } from "react";
import { Database, Search, Sparkles, User, Edit3, Archive, Plus, X, Save } from "lucide-react";

/**
 * Question Bank Browser — Owner Dashboard
 * بنك الأسئلة
 */

const MOCK_QUESTIONS = [
  { id: "q1", prompt: "استخرج اسم الإشارة من الجملة: 'هذا الكتاب مفيد.'", competency: "أسماء الإشارة", difficulty: "easy", source: "ai_generated", usageCount: 3, isActive: true },
  { id: "q2", prompt: "اذكر شرطين من شروط الاحتراق.", competency: "الاحتراق", difficulty: "medium", source: "owner_authored", usageCount: 7, isActive: true },
  { id: "q3", prompt: "حوّل الجملة التالية إلى صيغة الاستفهام.", competency: "أنواع الجملة", difficulty: "medium", source: "owner_authored", usageCount: 2, isActive: true },
  { id: "q4", prompt: "اكتب فقرة وصفية قصيرة عن فصل الخريف.", competency: "التعبير الكتابي الوصفي", difficulty: "hard", source: "ai_generated", usageCount: 0, isActive: true },
  { id: "q5", prompt: "سؤال قديم غير مستخدم حاليًا", competency: "أنواع الجملة", difficulty: "easy", source: "owner_authored", usageCount: 0, isActive: false },
];

const DIFFICULTY_META = {
  easy: { label: "سهل", color: "#2f6b52", bg: "#e8f3ed" },
  medium: { label: "متوسط", color: "#a8641a", bg: "#fbf0e3" },
  hard: { label: "صعب", color: "#a13c3c", bg: "#faeaea" },
};

function QuestionEditModal({ question, onSave, onClose }) {
  const [prompt, setPrompt] = useState(question.prompt);
  const [difficulty, setDifficulty] = useState(question.difficulty);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm">تعديل السؤال</h3>
          <button onClick={onClose} aria-label="إغلاق" className="text-stone-400 hover:text-stone-700"><X size={16} /></button>
        </div>
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className="w-full mb-3 px-3 py-2 rounded-lg border border-stone-200 text-sm" />
        <div className="flex gap-2 mb-4">
          {Object.entries(DIFFICULTY_META).map(([key, meta]) => (
            <button key={key} onClick={() => setDifficulty(key)} className="text-xs px-3 py-1.5 rounded-full border" style={difficulty === key ? { backgroundColor: meta.bg, color: meta.color, borderColor: meta.color } : { borderColor: "#e7e5e4", color: "#78716c" }}>
              {meta.label}
            </button>
          ))}
        </div>
        <button onClick={() => onSave({ prompt, difficulty })} className="w-full py-2 bg-stone-900 text-white text-sm rounded-lg flex items-center justify-center gap-1.5">
          <Save size={13} /> حفظ
        </button>
      </div>
    </div>
  );
}

export default function QuestionBankBrowser() {
  const [questions, setQuestions] = useState(MOCK_QUESTIONS);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [editing, setEditing] = useState(null);

  const filtered = useMemo(() => questions.filter((q) => {
    if (sourceFilter !== "all" && q.source !== sourceFilter) return false;
    if (difficultyFilter !== "all" && q.difficulty !== difficultyFilter) return false;
    if (query && !q.prompt.includes(query) && !q.competency.includes(query)) return false;
    return true;
  }), [questions, query, sourceFilter, difficultyFilter]);

  function archiveQuestion(id) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, isActive: false } : q)));
  }

  function saveEdit(id, patch) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
    setEditing(null);
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold flex items-center gap-2"><Database size={20} /> بنك الأسئلة</h1>
          <p className="text-sm text-stone-500 mt-1">{questions.filter((q) => q.isActive).length} سؤال نشط · {questions.filter((q) => q.source === "ai_generated").length} من الذكاء الاصطناعي</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="بحث..." className="w-full pr-9 pl-3 py-2 rounded-lg border border-stone-200 text-sm bg-white" />
          </div>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="px-3 py-2 rounded-lg border border-stone-200 text-sm bg-white">
            <option value="all">كل المصادر</option>
            <option value="ai_generated">ذكاء اصطناعي</option>
            <option value="owner_authored">إعداد المعلم</option>
          </select>
          <select value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value)} className="px-3 py-2 rounded-lg border border-stone-200 text-sm bg-white">
            <option value="all">كل المستويات</option>
            {Object.entries(DIFFICULTY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        <div className="space-y-2">
          {filtered.map((q) => (
            <div key={q.id} className={`p-3.5 bg-white border rounded-xl flex items-center gap-3 ${!q.isActive ? "opacity-50" : "border-stone-200"}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-stone-800">{q.prompt}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: DIFFICULTY_META[q.difficulty].color, backgroundColor: DIFFICULTY_META[q.difficulty].bg }}>
                    {DIFFICULTY_META[q.difficulty].label}
                  </span>
                  <span className="text-xs text-stone-400">{q.competency}</span>
                  <span className="text-xs text-stone-400 flex items-center gap-1">
                    {q.source === "ai_generated" ? <Sparkles size={10} /> : <User size={10} />}
                    {q.source === "ai_generated" ? "ذكاء اصطناعي" : "إعداد المعلم"}
                  </span>
                  <span className="text-xs text-stone-400">· استُخدم {q.usageCount} مرة</span>
                </div>
              </div>
              <button onClick={() => setEditing(q)} aria-label="تعديل" className="p-2 hover:bg-stone-100 rounded-md text-stone-500"><Edit3 size={14} /></button>
              {q.isActive && <button onClick={() => archiveQuestion(q.id)} aria-label="أرشفة" className="p-2 hover:bg-stone-100 rounded-md text-stone-400"><Archive size={14} /></button>}
            </div>
          ))}
        </div>
      </div>

      {editing && <QuestionEditModal question={editing} onClose={() => setEditing(null)} onSave={(patch) => saveEdit(editing.id, patch)} />}
    </div>
  );
}
