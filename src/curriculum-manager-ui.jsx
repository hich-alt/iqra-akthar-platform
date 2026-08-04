import React, { useState, useMemo } from "react";
import { ChevronDown, ChevronLeft, Plus, Edit3, Eye, EyeOff, Archive, Tag, BookOpen, Search, X, Save } from "lucide-react";
import { useLessonTree, useCompetencies, useLessonMutations } from "./use-lessons";
import { rules, composeRules, validate } from "./validation";
import { Skeleton, ErrorBlock, EmptyState, LiveStatusAnnouncer } from "./ui-primitives";

/**
 * Curriculum & Lesson Manager — Owner Dashboard
 * مدير المنهج والدروس
 *
 * MIGRATED (was a standalone prototype with mocked useState data — see
 * MASTER-MANIFEST.md's migration policy: "migrated to shared hooks the
 * next time each is touched"). This is that migration. The obsolete mock
 * data and inline validation are removed, not left alongside this version.
 *
 * Every read/write now goes through use-lessons.js, which goes through
 * api-client.js, which is bound by RLS (security-hardening.sql). No client-
 * side permission check here is the actual security boundary — same
 * disclaimer as every other page in this codebase.
 */

const STATUS_META = {
  draft:     { label: "مسودة", color: "#8b8378", bg: "#f2f0ec" },
  scheduled: { label: "مجدول", color: "#a8641a", bg: "#fbf0e3" },
  published: { label: "منشور", color: "#2f6b52", bg: "#e8f3ed" },
  closed:    { label: "مغلق", color: "#1f4e79", bg: "#e8eff7" },
  archived:  { label: "مؤرشف", color: "#6b6b6b", bg: "#efefef" },
};

// 'published' is intentionally excluded from the directly-selectable
// status dropdown in the editor modal — reaching Published now requires
// "Publish Now" or the scheduled job, both of which fire the required
// notification. Selecting it manually here would silently bypass that.
const MANUALLY_SELECTABLE_STATUSES = ["draft", "scheduled", "archived"];

const lessonSchema = {
  title: rules.required("عنوان الدرس مطلوب"),
  content_body: composeRules(rules.required("محتوى الدرس مطلوب"), rules.minLength(20, "المحتوى قصير جدًا — أضف تفاصيل أكثر")),
  competencyIds: rules.minItems(1, "اختر كفاءة واحدة على الأقل"),
};

function StatusPill({ status }) {
  const meta = STATUS_META[status];
  return <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ color: meta.color, backgroundColor: meta.bg }}>{meta.label}</span>;
}

function LessonEditorModal({ lesson, competencies, onSave, onClose }) {
  const [title, setTitle] = useState(lesson?.title ?? "");
  const [body, setBody] = useState(lesson?.content_body ?? "");
  const [selectedCompetencies, setSelectedCompetencies] = useState(new Set(lesson?.competencyIds ?? []));
  const [status, setStatus] = useState(lesson?.status ?? "draft");
  const [publishDate, setPublishDate] = useState(lesson?.publish_date ? lesson.publish_date.slice(0, 16) : "");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  function toggleCompetency(id) {
    setSelectedCompetencies((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSave() {
    const values = { title, content_body: body, competencyIds: [...selectedCompetencies] };
    const { isValid, errors: validationErrors } = validate(lessonSchema, values);
    setErrors(validationErrors);
    if (!isValid) return;

    setSaving(true);
    try {
      await onSave({ ...values, status, publishDate: publishDate ? new Date(publishDate).toISOString() : null });
    } catch (err) {
      setErrors({ _form: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div dir="rtl" className="fixed inset-0 bg-black/30 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-xl max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg">{lesson ? "تعديل الدرس" : "درس جديد"}</h3>
          <button onClick={onClose} aria-label="إغلاق" className="text-stone-400 hover:text-stone-700"><X size={18} /></button>
        </div>

        {errors._form && <p className="text-xs text-red-600 mb-3">{errors._form}</p>}

        <label className="block text-sm font-medium text-stone-600 mb-1.5">عنوان الدرس</label>
        <input
          value={title} onChange={(e) => setTitle(e.target.value)}
          aria-invalid={!!errors.title} aria-describedby={errors.title ? "title-error" : undefined}
          className={`w-full mb-1 px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-stone-300 ${errors.title ? "border-red-300" : "border-stone-200"}`}
        />
        {errors.title && <p id="title-error" className="text-xs text-red-600 mb-3">{errors.title}</p>}
        {!errors.title && <div className="mb-3" />}

        <label className="block text-sm font-medium text-stone-600 mb-1.5">محتوى الدرس</label>
        <textarea
          value={body} onChange={(e) => setBody(e.target.value)} rows={6}
          aria-invalid={!!errors.content_body} aria-describedby={errors.content_body ? "content-error" : undefined}
          className={`w-full mb-1 px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-stone-300 ${errors.content_body ? "border-red-300" : "border-stone-200"}`}
        />
        {errors.content_body && <p id="content-error" className="text-xs text-red-600 mb-3">{errors.content_body}</p>}
        {!errors.content_body && <div className="mb-3" />}

        <label className="block text-sm font-medium text-stone-600 mb-1.5">الكفاءات المستهدفة</label>
        <div className="flex flex-wrap gap-2 mb-1">
          {competencies.map((c) => (
            <button
              key={c.id}
              onClick={() => toggleCompetency(c.id)}
              className={`text-xs px-3 py-1.5 rounded-full border flex items-center gap-1 ${selectedCompetencies.has(c.id) ? "bg-stone-900 text-white border-stone-900" : "border-stone-200 text-stone-600"}`}
            >
              <Tag size={11} /> {c.label}
            </button>
          ))}
        </div>
        {errors.competencyIds && <p className="text-xs text-red-600 mb-3">{errors.competencyIds}</p>}
        {!errors.competencyIds && <div className="mb-3" />}

        <label className="block text-sm font-medium text-stone-600 mb-1.5">الحالة</label>
        {(lesson?.status === "published" || lesson?.status === "closed") ? (
          <div className="mb-6 p-3 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-500">
            الحالة الحالية: <span className="font-semibold">{STATUS_META[lesson.status].label}</span>.
            لتغيير هذا، استخدم زر "نشر الآن" أو "إعادة فتح الواجب" من القائمة الرئيسية — وليس من هنا،
            حتى يتم إرسال الإشعارات اللازمة تلقائيًا.
          </div>
        ) : (
          <div className="flex gap-2 mb-6">
            {MANUALLY_SELECTABLE_STATUSES.map((key) => {
              const meta = STATUS_META[key];
              return (
                <button
                  key={key}
                  onClick={() => setStatus(key)}
                  className="text-xs px-3 py-1.5 rounded-full border"
                  style={status === key ? { backgroundColor: meta.bg, color: meta.color, borderColor: meta.color } : { borderColor: "#e7e5e4", color: "#78716c" }}
                >
                  {meta.label}
                </button>
              );
            })}
          </div>
        )}

        <label className="block text-sm font-medium text-stone-600 mb-1.5">تاريخ النشر التلقائي (اختياري)</label>
        <input
          type="datetime-local" value={publishDate} onChange={(e) => setPublishDate(e.target.value)}
          className="w-full mb-2 px-3 py-2 rounded-lg border border-stone-200 text-sm"
        />
        <p className="text-xs text-stone-400 mb-6">
          إذا تُرك فارغًا: يظهر الدرس للتلاميذ فقط عند اختيار "منشور" يدويًا أعلاه.
          إذا حُدد تاريخ: سيظهر الدرس تلقائيًا في هذا التاريخ، حتى لو بقيت الحالة "مسودة".
        </p>

        {status === "scheduled" && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
            سيُنشر هذا الدرس تلقائيًا في تاريخ النشر المحدد أعلاه، ويصبح ظاهرًا للتلاميذ فور ذلك مع إشعارهم تلقائيًا.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-stone-200 text-stone-600">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-stone-900 text-white flex items-center gap-1.5 disabled:opacity-50">
            <Save size={14} /> {saving ? "جارٍ الحفظ..." : "حفظ"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CurriculumManager({ session }) {
  const { data: tree, isLoading, error, retry } = useLessonTree(session);
  const { data: competencies } = useCompetencies();
  const { createLesson, updateLesson, setLessonStatus, publishNow, reopenHomework } = useLessonMutations(session);

  const [expandedSubjects, setExpandedSubjects] = useState(new Set());
  const [query, setQuery] = useState("");
  const [editingLesson, setEditingLesson] = useState(null); // { weekId, subjectId, lesson } or lesson: null for new
  const [statusFilter, setStatusFilter] = useState("all");

  function toggleSubject(id) {
    setExpandedSubjects((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const filteredFields = useMemo(() => {
    if (!tree) return [];
    if (!query && statusFilter === "all") return tree;
    return tree.map((field) => ({
      ...field,
      subjects: field.subjects.map((subject) => ({
        ...subject,
        weeks: subject.weeks.map((week) => ({
          ...week,
          lessons: week.lessons.filter((l) => {
            if (statusFilter !== "all" && l.status !== statusFilter) return false;
            if (query && !l.title.includes(query)) return false;
            return true;
          }),
        })).filter((w) => w.lessons.length > 0 || !query),
      })),
    }));
  }, [tree, query, statusFilter]);

  async function handleSaveLesson(values) {
    if (editingLesson.lesson) {
      await updateLesson(editingLesson.lesson.id, values);
    } else {
      await createLesson(editingLesson.weekId, editingLesson.subjectId, values);
    }
    setEditingLesson(null);
    retry();
  }

  async function handleStatusChange(lessonId, status) {
    await setLessonStatus(lessonId, status);
    retry();
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold flex items-center gap-2"><BookOpen size={20} /> مدير المنهج والدروس</h1>
          <p className="text-sm text-stone-500 mt-1">السنة الدراسية ← المجال ← المادة ← الأسبوع ← الدرس</p>
        </div>
      </div>

      <LiveStatusAnnouncer isLoading={isLoading} error={error} successMessage="تم تحميل المنهج" />

      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="بحث عن درس..."
              className="w-full pr-9 pl-3 py-2 rounded-lg border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 rounded-lg border border-stone-200 text-sm bg-white">
            <option value="all">كل الحالات</option>
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {isLoading && <Skeleton lines={6} />}
        {error && <ErrorBlock error={error} retry={retry} />}
        {!isLoading && !error && filteredFields.length === 0 && <EmptyState message="لا توجد دروس بعد" />}

        {!isLoading && !error && filteredFields.map((field) => (
          <div key={field.id} className="mb-6">
            <h2 className="text-sm font-bold text-stone-500 mb-2">{field.name}</h2>
            {field.subjects.map((subject) => (
              <div key={subject.id} className="bg-white border border-stone-200 rounded-xl mb-3 overflow-hidden">
                <button onClick={() => toggleSubject(subject.id)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium">
                  <span>{subject.name}</span>
                  {expandedSubjects.has(subject.id) ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}
                </button>

                {expandedSubjects.has(subject.id) && (
                  <div className="border-t border-stone-100">
                    {subject.weeks.map((week) => (
                      <div key={week.id} className="px-4 py-3 border-b border-stone-50 last:border-0">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-stone-400">الأسبوع {week.weekNumber}</span>
                          <button
                            onClick={() => setEditingLesson({ weekId: week.id, subjectId: subject.id, lesson: null })}
                            className="text-xs flex items-center gap-1 text-stone-500 hover:text-stone-900"
                          >
                            <Plus size={12} /> إضافة درس
                          </button>
                        </div>
                        <div className="space-y-2">
                          {week.lessons.map((lesson) => (
                            <div key={lesson.id} className="flex items-center gap-2 p-2.5 rounded-lg hover:bg-stone-50">
                              <span className="text-sm flex-1">{lesson.title}</span>
                              <StatusPill status={lesson.status} />
                              <button onClick={() => setEditingLesson({ weekId: week.id, subjectId: subject.id, lesson })} aria-label="تعديل" className="p-1.5 hover:bg-stone-100 rounded-md text-stone-500">
                                <Edit3 size={13} />
                              </button>
                              {(lesson.status === "draft" || lesson.status === "scheduled") && (
                                <button
                                  onClick={async () => { await publishNow(lesson.id); retry(); }}
                                  aria-label="نشر الآن" title="نشر الآن"
                                  className="p-1.5 hover:bg-emerald-50 rounded-md text-emerald-700"
                                >
                                  <Eye size={13} />
                                </button>
                              )}
                              {lesson.status === "published" && (
                                <button
                                  onClick={async () => { await setLessonStatus(lesson.id, "closed"); retry(); }}
                                  aria-label="إغلاق الواجب" title="إغلاق الواجب يدويًا"
                                  className="p-1.5 hover:bg-stone-100 rounded-md text-stone-500"
                                >
                                  <EyeOff size={13} />
                                </button>
                              )}
                              {lesson.status === "closed" && (
                                <button
                                  onClick={async () => {
                                    const newDeadline = window.prompt("أدخل الموعد الجديد لتسليم الواجب (YYYY-MM-DD HH:MM):");
                                    if (!newDeadline) return;
                                    await reopenHomework(lesson.id, new Date(newDeadline).toISOString());
                                    retry();
                                  }}
                                  aria-label="إعادة فتح الواجب" title="إعادة فتح الواجب"
                                  className="p-1.5 hover:bg-emerald-50 rounded-md text-emerald-700"
                                >
                                  <Eye size={13} />
                                </button>
                              )}
                              {lesson.status !== "archived" && (
                                <button onClick={() => handleStatusChange(lesson.id, "archived")} aria-label="أرشفة" className="p-1.5 hover:bg-stone-100 rounded-md text-stone-400">
                                  <Archive size={13} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {editingLesson && (
        <LessonEditorModal
          lesson={editingLesson.lesson}
          competencies={competencies ?? []}
          onClose={() => setEditingLesson(null)}
          onSave={handleSaveLesson}
        />
      )}
    </div>
  );
}
