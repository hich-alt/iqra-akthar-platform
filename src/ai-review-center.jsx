import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Check, X, Archive, RotateCcw, Copy, Star, Tag, Eye, GitCompare, ChevronDown, Search, FileText, Image as ImageIcon, Music, Video, History } from "lucide-react";

/**
 * AI Review Center — Owner Dashboard
 * مركز مراجعة الذكاء الاصطناعي
 *
 * Data here is mocked to demonstrate the full workflow end-to-end.
 * Wire `drafts`, `onApprove`, `onReject`, etc. to ai-draft-service.js in production.
 */

const STATUS_META = {
  generated:       { label: "تم التوليد",      color: "#8b8378", bg: "#f2f0ec" },
  pending_review:  { label: "بانتظار المراجعة", color: "#a8641a", bg: "#fbf0e3" },
  approved:        { label: "معتمد",           color: "#2f6b52", bg: "#e8f3ed" },
  published:       { label: "منشور",           color: "#1f4e79", bg: "#e8eff7" },
  rejected:        { label: "مرفوض",           color: "#a13c3c", bg: "#faeaea" },
  archived:        { label: "مؤرشف",           color: "#6b6b6b", bg: "#efefef" },
};

const TYPE_LABELS = {
  question: "سؤال",
  mock_exam: "مناظرة تجريبية",
  weakness_analysis: "تحليل نقاط الضعف",
  revision_plan: "خطة مراجعة",
  readiness_summary: "ملخص الجاهزية",
  tutor_response: "رد المساعد",
};

const MOCK_DRAFTS = [
  { id: "1", draft_type: "question", status: "pending_review", tags: ["نحو", "أسبوع6"], is_favorite: false,
    created_at: "2026-07-28T09:12:00Z", version: 1,
    payload: { questions: [{ prompt: "استخرج اسم الإشارة من الجملة: 'هذا الكتاب مفيد.'", correct_answer: "هذا", competency_id: "c-104", difficulty: "easy" }] } },
  { id: "2", draft_type: "revision_plan", status: "pending_review", tags: ["مناظرة"], is_favorite: true,
    created_at: "2026-07-28T08:40:00Z", version: 1,
    payload: { weekly_plan: [{ week_number: 1, focus_competencies: ["c-104", "c-112"] }] } },
  { id: "3", draft_type: "mock_exam", status: "approved", tags: ["مناظرة", "تجريبي1"], is_favorite: false,
    created_at: "2026-07-27T14:20:00Z", version: 2,
    payload: { exam_title: "مناظرة تجريبية رقم 1" } },
  { id: "4", draft_type: "question", status: "rejected", tags: ["علوم"], is_favorite: false,
    created_at: "2026-07-27T11:05:00Z", version: 1,
    payload: { questions: [{ prompt: "سؤال يحتوي على مفهوم خارج المنهج", correct_answer: "-", competency_id: "c-201", difficulty: "medium" }] } },
  { id: "5", draft_type: "weakness_analysis", status: "published", tags: [], is_favorite: false,
    created_at: "2026-07-26T16:00:00Z", version: 1,
    payload: { summary_ar: "التلميذ يحتاج تعزيزًا في كفاءة القراءة الاستنتاجية." } },
];

function timeAgo(iso) {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 60) return `منذ ${diffMin} د`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `منذ ${diffH} سا`;
  return `منذ ${Math.round(diffH / 24)} يوم`;
}

function StatusPill({ status }) {
  const meta = STATUS_META[status];
  return (
    <span
      className="px-2.5 py-1 rounded-full text-xs font-medium"
      style={{ color: meta.color, backgroundColor: meta.bg }}
    >
      {meta.label}
    </span>
  );
}

function DraftPreview({ draft }) {
  if (draft.draft_type === "question") {
    const q = draft.payload.questions?.[0];
    return <p className="text-sm text-stone-700 leading-relaxed">{q?.prompt}</p>;
  }
  if (draft.draft_type === "mock_exam") {
    return <p className="text-sm text-stone-700">{draft.payload.exam_title}</p>;
  }
  if (draft.draft_type === "revision_plan") {
    return <p className="text-sm text-stone-700">خطة من {draft.payload.weekly_plan?.length ?? 0} أسبوع</p>;
  }
  return <p className="text-sm text-stone-700 leading-relaxed">{draft.payload.summary_ar}</p>;
}

/**
 * RichPreviewModal — switches rendering strategy by media type.
 * PDF/image/audio/video use native browser rendering (iframe/img/audio/video);
 * JSON falls back to a formatted, syntax-lightweight code view.
 * NOTE: PDF/audio/video sources here are illustrative — wire `mediaUrl` to
 * the real Media table once that module exists (see integration-adapters.js
 * SearchEngineAdapter/CertificatesAdapter notes on media handling).
 */
function RichPreviewModal({ draft, onClose }) {
  const mediaType = draft.media_type ?? "json"; // 'pdf' | 'image' | 'audio' | 'video' | 'json'

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-30"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="معاينة المسودة"
    >
      <div className="bg-white rounded-xl p-5 w-full max-w-2xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm text-stone-500">
            {mediaType === "pdf" && <FileText size={16} />}
            {mediaType === "image" && <ImageIcon size={16} />}
            {mediaType === "audio" && <Music size={16} />}
            {mediaType === "video" && <Video size={16} />}
            {mediaType === "json" && <FileText size={16} />}
            <span>معاينة — {TYPE_LABELS[draft.draft_type]}</span>
          </div>
          <button onClick={onClose} aria-label="إغلاق المعاينة" className="text-stone-400 hover:text-stone-700">
            <X size={18} />
          </button>
        </div>

        {mediaType === "pdf" && draft.media_url && (
          <iframe title="PDF preview" src={draft.media_url} className="w-full h-96 rounded-md border border-stone-200" />
        )}
        {mediaType === "image" && draft.media_url && (
          <img src={draft.media_url} alt={`معاينة — ${TYPE_LABELS[draft.draft_type]}`} className="w-full rounded-md border border-stone-200" />
        )}
        {mediaType === "audio" && draft.media_url && (
          <audio controls src={draft.media_url} className="w-full" />
        )}
        {mediaType === "video" && draft.media_url && (
          <video controls src={draft.media_url} className="w-full rounded-md border border-stone-200" />
        )}
        {(mediaType === "json" || !draft.media_url) && (
          <pre dir="ltr" className="text-xs bg-stone-50 border border-stone-200 rounded-md p-4 overflow-auto text-left" style={{ fontFamily: "monospace" }}>
            {JSON.stringify(draft.payload, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

/** VersionHistoryPanel — lists snapshots for a draft with a one-click restore. */
function VersionHistoryPanel({ draft, versions, onRestore, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-30" onClick={onClose} role="dialog" aria-modal="true">
      <div className="bg-white rounded-xl p-5 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold flex items-center gap-2"><History size={16} /> سجل الإصدارات</h3>
          <button onClick={onClose} aria-label="إغلاق" className="text-stone-400 hover:text-stone-700"><X size={18} /></button>
        </div>
        <ul className="space-y-2">
          {versions.map((v) => (
            <li key={v.version} className="flex items-center justify-between p-3 border border-stone-200 rounded-lg">
              <div>
                <div className="text-sm font-medium">الإصدار {v.version}</div>
                <div className="text-xs text-stone-400">{v.statusAtSnapshot} — {new Date(v.createdAt ?? Date.now()).toLocaleString("ar-TN")}</div>
              </div>
              <button
                onClick={() => onRestore(draft.id, v.version)}
                className="text-xs px-3 py-1.5 bg-stone-900 text-white rounded-md flex items-center gap-1"
              >
                <RotateCcw size={12} /> استعادة
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function AiReviewCenter() {
  const [drafts, setDrafts] = useState(MOCK_DRAFTS);
  const [statusFilter, setStatusFilter] = useState("pending_review");
  const [typeFilter, setTypeFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [diffTarget, setDiffTarget] = useState(null);
  const [previewTarget, setPreviewTarget] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [focusedId, setFocusedId] = useState(null); // keyboard-navigation cursor

  const filtered = useMemo(() => {
    return drafts.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (typeFilter !== "all" && d.draft_type !== typeFilter) return false;
      if (query && !JSON.stringify(d.payload).includes(query) && !d.tags.some((t) => t.includes(query))) return false;
      return true;
    });
  }, [drafts, statusFilter, typeFilter, query]);

  useEffect(() => { filteredRef.current = filtered; }, [filtered]);

  const counts = useMemo(() => {
    const c = { pending_review: 0, approved: 0, rejected: 0, published: 0 };
    drafts.forEach((d) => { if (c[d.status] !== undefined) c[d.status]++; });
    return c;
  }, [drafts]);

  function transition(ids, toStatus, extra = {}) {
    setDrafts((prev) => prev.map((d) => (ids.includes(d.id) ? { ...d, status: toStatus, ...extra } : d)));
    setSelected(new Set());
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleFavorite(id) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, is_favorite: !d.is_favorite } : d)));
  }

  function duplicateDraft(id) {
    const src = drafts.find((d) => d.id === id);
    const copy = { ...src, id: `${id}-copy-${Date.now()}`, status: "generated", version: 1, created_at: new Date().toISOString() };
    setDrafts((prev) => [copy, ...prev]);
  }

  // -----------------------------------------------------------------
  // KEYBOARD SHORTCUTS — j/k navigate the list, a=approve, r=reject,
  // f=favorite, v=version history, Escape closes any open modal.
  // Ignored while typing in the search field.
  // -----------------------------------------------------------------
  const handleKeyDown = useCallback((e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (diffTarget || previewTarget || historyTarget) {
      if (e.key === "Escape") { setDiffTarget(null); setPreviewTarget(null); setHistoryTarget(null); }
      return;
    }
    const idx = filteredRef.current.findIndex((d) => d.id === focusedId);
    if (e.key === "j") setFocusedId(filteredRef.current[Math.min(idx + 1, filteredRef.current.length - 1)]?.id ?? filteredRef.current[0]?.id);
    if (e.key === "k") setFocusedId(filteredRef.current[Math.max(idx - 1, 0)]?.id);
    if (e.key === "a" && focusedId) transition([focusedId], "approved");
    if (e.key === "r" && focusedId) transition([focusedId], "rejected");
    if (e.key === "f" && focusedId) toggleFavorite(focusedId);
    if (e.key === "v" && focusedId) setHistoryTarget(drafts.find((d) => d.id === focusedId));
  }, [focusedId, diffTarget, previewTarget, historyTarget, drafts]);

  const filteredRef = React.useRef([]);
  useEffect(() => { document.addEventListener("keydown", handleKeyDown); return () => document.removeEventListener("keydown", handleKeyDown); }, [handleKeyDown]);

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold text-stone-900">مركز مراجعة الذكاء الاصطناعي</h1>
          <p className="text-sm text-stone-500 mt-1">كل عمل مولّد بالذكاء الاصطناعي يمر من هنا قبل نشره — لا شيء يُنشر تلقائيًا</p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { key: "pending_review", label: "بانتظار المراجعة" },
            { key: "approved", label: "معتمد (غير منشور)" },
            { key: "published", label: "منشور" },
            { key: "rejected", label: "مرفوض" },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={`text-right p-4 rounded-xl border transition-colors ${statusFilter === key ? "border-stone-900 bg-white" : "border-stone-200 bg-white/60 hover:border-stone-300"}`}
            >
              <div className="text-2xl font-bold" style={{ color: STATUS_META[key].color }}>{counts[key]}</div>
              <div className="text-xs text-stone-500 mt-1">{label}</div>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث في المحتوى أو الوسوم..."
              className="w-full pr-9 pl-3 py-2 rounded-lg border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
            />
          </div>
          <div className="relative">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="appearance-none pr-3 pl-8 py-2 rounded-lg border border-stone-200 text-sm bg-white"
            >
              <option value="all">كل الأنواع</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <ChevronDown size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          </div>
        </div>

        {/* Bulk actions */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 mb-4 p-3 bg-stone-900 text-white rounded-lg text-sm">
            <span>{selected.size} عنصر محدد</span>
            <div className="flex-1" />
            <button onClick={() => transition([...selected], "approved")} className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-md">
              <Check size={14} /> اعتماد الكل
            </button>
            <button onClick={() => transition([...selected], "rejected")} className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-md">
              <X size={14} /> رفض الكل
            </button>
          </div>
        )}

        {/* Draft list */}
        <div className="space-y-3">
          {filtered.length === 0 && (
            <div className="text-center py-16 text-stone-400 text-sm">لا توجد مسودات مطابقة لهذا الفلتر</div>
          )}
          {filtered.map((draft) => (
            <div
              key={draft.id}
              tabIndex={0}
              onFocus={() => setFocusedId(draft.id)}
              aria-selected={focusedId === draft.id}
              className={`bg-white border rounded-xl p-4 focus:outline-none ${focusedId === draft.id ? "border-stone-900 ring-2 ring-stone-300" : "border-stone-200"}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(draft.id)}
                  onChange={() => toggleSelect(draft.id)}
                  aria-label={`تحديد مسودة ${TYPE_LABELS[draft.draft_type]}`}
                  className="mt-1.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="text-xs font-semibold text-stone-600 bg-stone-100 px-2 py-0.5 rounded">{TYPE_LABELS[draft.draft_type]}</span>
                    <StatusPill status={draft.status} />
                    <span className="text-xs text-stone-400">{timeAgo(draft.created_at)}</span>
                    <span className="text-xs text-stone-400">· الإصدار {draft.version}</span>
                    {draft.tags.map((t) => (
                      <span key={t} className="text-xs text-stone-500 flex items-center gap-1">
                        <Tag size={10} /> {t}
                      </span>
                    ))}
                  </div>
                  <DraftPreview draft={draft} />
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => toggleFavorite(draft.id)} aria-label="تبديل المفضلة" title="مفضلة (f)" className="p-2 hover:bg-stone-100 rounded-md focus-visible:ring-2 focus-visible:ring-stone-400">
                    <Star size={15} fill={draft.is_favorite ? "#a8641a" : "none"} color={draft.is_favorite ? "#a8641a" : "#a8a29e"} />
                  </button>
                  <button onClick={() => setPreviewTarget(draft)} aria-label="معاينة المحتوى" title="معاينة" className="p-2 hover:bg-stone-100 rounded-md text-stone-500 focus-visible:ring-2 focus-visible:ring-stone-400">
                    <Eye size={15} />
                  </button>
                  <button onClick={() => setHistoryTarget(draft)} aria-label="سجل الإصدارات" title="سجل الإصدارات (v)" className="p-2 hover:bg-stone-100 rounded-md text-stone-500 focus-visible:ring-2 focus-visible:ring-stone-400">
                    <History size={15} />
                  </button>
                  <button onClick={() => setDiffTarget(draft)} aria-label="مقارنة الإصدارات" title="مقارنة الإصدارات" className="p-2 hover:bg-stone-100 rounded-md text-stone-500 focus-visible:ring-2 focus-visible:ring-stone-400">
                    <GitCompare size={15} />
                  </button>
                  <button onClick={() => duplicateDraft(draft.id)} aria-label="نسخ المسودة" title="نسخ" className="p-2 hover:bg-stone-100 rounded-md text-stone-500 focus-visible:ring-2 focus-visible:ring-stone-400">
                    <Copy size={15} />
                  </button>

                  {draft.status === "pending_review" && (
                    <>
                      <button onClick={() => transition([draft.id], "approved")} aria-label="اعتماد" className="p-2 hover:bg-emerald-50 rounded-md text-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-400" title="اعتماد (a)">
                        <Check size={15} />
                      </button>
                      <button onClick={() => transition([draft.id], "rejected")} aria-label="رفض" className="p-2 hover:bg-red-50 rounded-md text-red-700 focus-visible:ring-2 focus-visible:ring-red-400" title="رفض (r)">
                        <X size={15} />
                      </button>
                    </>
                  )}
                  {draft.status === "approved" && (
                    <button onClick={() => transition([draft.id], "published")} className="px-3 py-1.5 bg-stone-900 text-white text-xs rounded-md focus-visible:ring-2 focus-visible:ring-stone-400">
                      نشر الآن
                    </button>
                  )}
                  {(draft.status === "rejected" || draft.status === "archived") && (
                    <button onClick={() => transition([draft.id], "pending_review")} aria-label="استعادة" className="p-2 hover:bg-stone-100 rounded-md text-stone-500 focus-visible:ring-2 focus-visible:ring-stone-400" title="استعادة">
                      <RotateCcw size={15} />
                    </button>
                  )}
                  {draft.status !== "archived" && draft.status !== "published" && (
                    <button onClick={() => transition([draft.id], "archived")} aria-label="أرشفة" className="p-2 hover:bg-stone-100 rounded-md text-stone-400 focus-visible:ring-2 focus-visible:ring-stone-400" title="أرشفة">
                      <Archive size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rich preview modal */}
      {previewTarget && <RichPreviewModal draft={previewTarget} onClose={() => setPreviewTarget(null)} />}

      {/* Version history modal */}
      {historyTarget && (
        <VersionHistoryPanel
          draft={historyTarget}
          versions={[
            { version: historyTarget.version, statusAtSnapshot: historyTarget.status, createdAt: historyTarget.created_at },
            ...(historyTarget.version > 1 ? [{ version: historyTarget.version - 1, statusAtSnapshot: "generated", createdAt: historyTarget.created_at }] : []),
          ]}
          onRestore={(id, version) => {
            // In production: call AiDraftService.compareVersions + a restore
            // endpoint that re-inserts that version's payload as the current one.
            transition([id], "pending_review", { version });
            setHistoryTarget(null);
          }}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {/* Diff / version compare panel */}
      {diffTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-20" onClick={() => setDiffTarget(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">مقارنة الإصدارات — {TYPE_LABELS[diffTarget.draft_type]}</h3>
              <button onClick={() => setDiffTarget(null)} className="text-stone-400 hover:text-stone-700"><X size={18} /></button>
            </div>
            <p className="text-sm text-stone-500">
              يعرض هذا اللوح الفرق بين المسودة الحالية (الإصدار {diffTarget.version}) والنسخة المنشورة سابقًا، معتمدًا على ai_draft_versions.
              (في الإنتاج: استدعاء compareVersions من ai-draft-service.js)
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
