import React, { useState } from "react";
import { Calendar, Layers, Plus, Star, Save } from "lucide-react";
import { useAcademicYears, useFieldsAndSubjects, useTermsAndWeeks, useCurriculumStructureMutations } from "./use-curriculum-structure";
import { rules, validate } from "./validation";
import { Skeleton, ErrorBlock, EmptyState } from "./ui-primitives";

/**
 * Curriculum Structure Manager — Owner Dashboard
 * إدارة هيكل المنهج (السنوات، الفصول، الأسابيع، المجالات، المواد)
 *
 * Distinct from curriculum-manager-ui.jsx (Lesson Editor, which manages
 * lesson CONTENT within this structure). This page manages the scaffolding
 * Lesson Editor's field→subject→week tree is built from.
 */

function AddYearForm({ onCreate, onClose }) {
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const schema = { label: rules.required("مطلوب"), startDate: rules.required("مطلوب"), endDate: rules.required("مطلوب") };

  async function handleSave() {
    const { isValid, errors: validationErrors } = validate(schema, { label, startDate, endDate });
    setErrors(validationErrors);
    if (!isValid) return;
    setSaving(true);
    try {
      await onCreate({ label, startDate, endDate });
      onClose();
    } catch (err) {
      setErrors({ _form: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 bg-stone-50 border border-stone-200 rounded-lg mb-3">
      {errors._form && <p className="text-xs text-red-600 mb-2">{errors._form}</p>}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثال: 2026-2027" className={`px-3 py-2 rounded-lg border text-sm ${errors.label ? "border-red-300" : "border-stone-200"}`} />
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`px-3 py-2 rounded-lg border text-sm ${errors.startDate ? "border-red-300" : "border-stone-200"}`} />
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={`px-3 py-2 rounded-lg border text-sm ${errors.endDate ? "border-red-300" : "border-stone-200"}`} />
      </div>
      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-stone-900 text-white text-sm rounded-lg flex items-center gap-1.5 disabled:opacity-50"><Save size={13} /> حفظ</button>
        <button onClick={onClose} className="px-4 py-2 border border-stone-200 text-sm rounded-lg">إلغاء</button>
      </div>
    </div>
  );
}

function AcademicYearsSection({ session }) {
  const { data: years, isLoading, error, retry } = useAcademicYears();
  const { createAcademicYear, setCurrentAcademicYear } = useCurriculumStructureMutations(session);
  const [adding, setAdding] = useState(false);

  async function handleSetCurrent(yearId) {
    await setCurrentAcademicYear(yearId);
    retry();
  }

  if (isLoading) return <Skeleton lines={3} />;
  if (error) return <ErrorBlock error={error} retry={retry} />;

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold flex items-center gap-2"><Calendar size={16} className="text-stone-400" /> السنوات الدراسية</h3>
        {!adding && <button onClick={() => setAdding(true)} className="text-xs flex items-center gap-1 text-stone-600 hover:text-stone-900"><Plus size={12} /> سنة جديدة</button>}
      </div>

      {adding && <AddYearForm onCreate={(v) => createAcademicYear(v).then(retry)} onClose={() => setAdding(false)} />}

      {years?.length === 0 ? (
        <EmptyState message="لا توجد سنوات دراسية بعد" />
      ) : (
        <div className="space-y-2">
          {years?.map((year) => (
            <div key={year.id} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-stone-50">
              <span className="text-sm">{year.label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-stone-400">{year.start_date} — {year.end_date}</span>
                {year.is_current ? (
                  <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full flex items-center gap-1"><Star size={10} /> الحالية</span>
                ) : (
                  <button onClick={() => handleSetCurrent(year.id)} className="text-xs px-2 py-0.5 border border-stone-200 rounded-full text-stone-500 hover:bg-stone-100">تعيين كحالية</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldsSubjectsSection({ session }) {
  const { data: fields, isLoading, error, retry } = useFieldsAndSubjects();
  const { createField, createSubject } = useCurriculumStructureMutations(session);
  const [newFieldName, setNewFieldName] = useState("");
  const [newSubjectByField, setNewSubjectByField] = useState({});

  if (isLoading) return <Skeleton lines={4} />;
  if (error) return <ErrorBlock error={error} retry={retry} />;

  async function handleAddField() {
    if (!newFieldName.trim()) return;
    await createField(newFieldName.trim());
    setNewFieldName("");
    retry();
  }

  async function handleAddSubject(fieldId) {
    const name = newSubjectByField[fieldId]?.trim();
    if (!name) return;
    await createSubject(fieldId, name);
    setNewSubjectByField((prev) => ({ ...prev, [fieldId]: "" }));
    retry();
  }

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4">
      <h3 className="text-sm font-bold flex items-center gap-2 mb-3"><Layers size={16} className="text-stone-400" /> المجالات والمواد</h3>

      <div className="flex gap-2 mb-4">
        <input value={newFieldName} onChange={(e) => setNewFieldName(e.target.value)} placeholder="مجال جديد..." className="flex-1 px-3 py-2 rounded-lg border border-stone-200 text-sm" />
        <button onClick={handleAddField} className="px-3 py-2 bg-stone-900 text-white text-sm rounded-lg flex items-center gap-1"><Plus size={13} /> إضافة</button>
      </div>

      {fields?.length === 0 ? (
        <EmptyState message="لا توجد مجالات بعد" />
      ) : (
        <div className="space-y-4">
          {fields?.map((field) => (
            <div key={field.id} className="border border-stone-100 rounded-lg p-3">
              <p className="text-sm font-semibold mb-2">{field.name}</p>
              <ul className="space-y-1 mb-2">
                {field.subjects.map((s) => <li key={s.id} className="text-xs text-stone-500">{s.name}</li>)}
              </ul>
              <div className="flex gap-2">
                <input
                  value={newSubjectByField[field.id] ?? ""}
                  onChange={(e) => setNewSubjectByField((prev) => ({ ...prev, [field.id]: e.target.value }))}
                  placeholder="مادة جديدة..."
                  className="flex-1 px-2 py-1.5 rounded-md border border-stone-200 text-xs"
                />
                <button onClick={() => handleAddSubject(field.id)} className="px-2 py-1.5 bg-stone-100 text-xs rounded-md">إضافة</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TermsWeeksSection({ session, years }) {
  const [selectedYearId, setSelectedYearId] = useState(years?.find((y) => y.is_current)?.id ?? years?.[0]?.id ?? null);
  const { data: terms, isLoading, error, retry } = useTermsAndWeeks(selectedYearId);
  const { createTerm, createWeek } = useCurriculumStructureMutations(session);
  const [newWeekByTerm, setNewWeekByTerm] = useState({});

  async function handleAddTerm(termNumber) {
    await createTerm(selectedYearId, termNumber, {});
    retry();
  }

  async function handleAddWeek(termId) {
    const weekNumber = parseInt(newWeekByTerm[termId], 10);
    if (!weekNumber) return;
    await createWeek(termId, weekNumber, null);
    setNewWeekByTerm((prev) => ({ ...prev, [termId]: "" }));
    retry();
  }

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold flex items-center gap-2"><Calendar size={16} className="text-stone-400" /> الفصول والأسابيع</h3>
        <select value={selectedYearId ?? ""} onChange={(e) => setSelectedYearId(e.target.value)} className="px-2 py-1 rounded-lg border border-stone-200 text-xs">
          {years?.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
        </select>
      </div>

      {isLoading && <Skeleton lines={2} />}
      {error && <ErrorBlock error={error} retry={retry} />}

      {!isLoading && !error && (
        <div className="space-y-3">
          {[1, 2, 3].map((termNumber) => {
            const term = terms?.find((t) => t.term_number === termNumber);
            return (
              <div key={termNumber} className="border border-stone-100 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold">الفصل {termNumber}</span>
                  {!term && <button onClick={() => handleAddTerm(termNumber)} className="text-xs text-stone-600 hover:text-stone-900 flex items-center gap-1"><Plus size={11} /> إنشاء الفصل</button>}
                </div>
                {term && (
                  <>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {term.weeks.map((w) => <span key={w.id} className="text-xs px-2 py-0.5 bg-stone-100 rounded-full">أسبوع {w.week_number}</span>)}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="number" placeholder="رقم الأسبوع الجديد"
                        value={newWeekByTerm[term.id] ?? ""}
                        onChange={(e) => setNewWeekByTerm((prev) => ({ ...prev, [term.id]: e.target.value }))}
                        className="w-32 px-2 py-1.5 rounded-md border border-stone-200 text-xs"
                      />
                      <button onClick={() => handleAddWeek(term.id)} className="px-2 py-1.5 bg-stone-100 text-xs rounded-md">إضافة أسبوع</button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CurriculumStructureManager({ session }) {
  const { data: years } = useAcademicYears();

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold">إدارة هيكل المنهج</h1>
          <p className="text-sm text-stone-500 mt-1">السنوات الدراسية، الفصول، الأسابيع، المجالات، والمواد — الهيكل الذي يُبنى عليه محرر الدروس</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6 space-y-4">
        <AcademicYearsSection session={session} />
        <TermsWeeksSection session={session} years={years} />
        <FieldsSubjectsSection session={session} />
      </div>
    </div>
  );
}
