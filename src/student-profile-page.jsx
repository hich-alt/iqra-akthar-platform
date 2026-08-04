import React, { useState } from "react";
import {
  User, ClipboardList, FileSpreadsheet, Target, Activity, BarChart3,
  Edit3, Save, X,
} from "lucide-react";
import { useStudentProfile, useStudentAcademicProgress, useStudentActivityTimeline, useStudentMutations } from "./use-students";
import { useStudentHomework, useStudentExams, useStudentConcoursSummary, useStudentAnalytics } from "./use-student-records";
import { can } from "./permissions";
import { Skeleton, ErrorBlock } from "./ui-primitives";

/**
 * Student Profile — Phase 2
 *
 * Each tab is its own component calling its own hook, and only the active
 * tab is mounted — this is the lazy-fetch strategy: no tab fetches data
 * until the Owner actually clicks into it, and switching back to a
 * previously-viewed tab hits the 30s cache in use-students.js/
 * use-student-records.js rather than re-fetching immediately.
 */

const TABS = [
  { key: "overview", label: "نظرة عامة", icon: User },
  { key: "personal", label: "المعلومات الشخصية", icon: User },
  { key: "academic", label: "التقدم الأكاديمي", icon: Target },
  { key: "homework", label: "الواجبات", icon: ClipboardList },
  { key: "quizzes", label: "الاختبارات القصيرة", icon: FileSpreadsheet },
  { key: "exams", label: "المناظرات", icon: FileSpreadsheet },
  { key: "concours", label: "الاستعداد للمناظرة", icon: Target },
  { key: "activity", label: "سجل النشاط", icon: Activity },
  { key: "analytics", label: "التحليلات", icon: BarChart3 },
];

function OverviewTab({ studentId, session }) {
  const { data: profile, isLoading, error, retry } = useStudentProfile(studentId, session);
  const { data: concours } = useStudentConcoursSummary(studentId, session);
  if (isLoading) return <Skeleton />;
  if (error) return <ErrorBlock error={error} retry={retry} />;
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="col-span-2 bg-white border border-stone-200 rounded-xl p-4">
        <h3 className="font-bold mb-1">{profile.full_name}</h3>
        <p className="text-sm text-stone-500">مسجّل منذ {profile.enrollment_date}</p>
      </div>
      <div className="bg-white border border-stone-200 rounded-xl p-4">
        <p className="text-xs text-stone-500 mb-1">درجة الجاهزية</p>
        <p className="text-2xl font-bold">{concours?.readiness?.score ?? "—"}</p>
      </div>
    </div>
  );
}

function PersonalInfoTab({ studentId, session }) {
  const { data: profile, isLoading, error, retry } = useStudentProfile(studentId, session);
  const { updateProfile } = useStudentMutations(session);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorBlock error={error} retry={retry} />;

  const canEdit = can(session, "student.profile.edit");

  function startEdit() {
    setForm({ full_name: profile.full_name, guardian_name: profile.guardian_name ?? "", guardian_contact: profile.guardian_contact ?? "" });
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    const previous = { ...profile }; // for rollback narration — no optimistic UI applied here, we wait for confirmation
    try {
      await updateProfile(studentId, form);
      setEditing(false);
    } catch (err) {
      alert(`فشل الحفظ: ${err.message}`); // rollback is implicit: local `form` state is untouched, profile re-fetches unchanged on retry
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-sm">المعلومات الشخصية</h3>
        {canEdit && !editing && (
          <button onClick={startEdit} className="text-xs flex items-center gap-1 text-stone-600 hover:text-stone-900"><Edit3 size={12} /> تعديل</button>
        )}
      </div>
      {!editing ? (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-stone-400 text-xs">الاسم الكامل</dt><dd>{profile.full_name}</dd></div>
          <div><dt className="text-stone-400 text-xs">تاريخ الميلاد</dt><dd>{profile.date_of_birth ?? "—"}</dd></div>
          <div><dt className="text-stone-400 text-xs">ولي الأمر</dt><dd>{profile.guardian_name ?? "—"}</dd></div>
          <div><dt className="text-stone-400 text-xs">وسيلة الاتصال</dt><dd>{profile.guardian_contact ?? "—"}</dd></div>
        </dl>
      ) : (
        <div className="space-y-3">
          <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm" placeholder="الاسم الكامل" />
          <input value={form.guardian_name} onChange={(e) => setForm({ ...form, guardian_name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm" placeholder="اسم ولي الأمر" />
          <input value={form.guardian_contact} onChange={(e) => setForm({ ...form, guardian_contact: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm" placeholder="وسيلة الاتصال" />
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="px-4 py-2 bg-stone-900 text-white text-sm rounded-lg flex items-center gap-1.5 disabled:opacity-50"><Save size={13} /> حفظ</button>
            <button onClick={() => setEditing(false)} className="px-4 py-2 border border-stone-200 text-sm rounded-lg flex items-center gap-1.5"><X size={13} /> إلغاء</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AcademicProgressTab({ studentId, session }) {
  const { data, isLoading, error, retry } = useStudentAcademicProgress(studentId);
  if (isLoading) return <Skeleton />;
  if (error) return <ErrorBlock error={error} retry={retry} />;
  if (!data?.length) return <p className="text-sm text-stone-400 text-center py-8">لا توجد بيانات كفاءات بعد</p>;
  return (
    <div className="space-y-2">
      {data.map((row) => (
        <div key={row.competency_id} className="flex items-center gap-3 p-3 bg-white border border-stone-200 rounded-lg">
          <span className="text-sm flex-1">{row.competency_label}</span>
          <span className="text-xs text-stone-400">{row.subject}</span>
          <div className="w-24 h-2 bg-stone-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${row.score}%`, backgroundColor: row.score >= 60 ? "#2f6b52" : "#a13c3c" }} />
          </div>
          <span className="text-xs font-medium w-10 text-left">{row.score}%</span>
        </div>
      ))}
    </div>
  );
}

function HomeworkTab({ studentId, session }) {
  const { data, isLoading, error, retry } = useStudentHomework(studentId, session);
  if (isLoading) return <Skeleton />;
  if (error) return <ErrorBlock error={error} retry={retry} />;
  if (!data?.data.length) return <p className="text-sm text-stone-400 text-center py-8">لا توجد واجبات مسجّلة</p>;
  return (
    <div className="space-y-2">
      {data.data.map((hw) => (
        <div key={hw.id} className="flex items-center justify-between p-3 bg-white border border-stone-200 rounded-lg text-sm">
          <span>{hw.status === "graded" ? `النتيجة: ${hw.total_score}/${hw.max_score}` : "بانتظار التصحيح"}</span>
          <span className="text-xs text-stone-400">{hw.submitted_at?.slice(0, 10) ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

function ExamsTab({ studentId, session, examType }) {
  const { data, isLoading, error, retry } = useStudentExams(studentId, session, { examType });
  if (isLoading) return <Skeleton />;
  if (error) return <ErrorBlock error={error} retry={retry} />;
  if (!data?.length) return <p className="text-sm text-stone-400 text-center py-8">لا توجد نتائج بعد</p>;
  return (
    <div className="space-y-2">
      {data.map((exam) => (
        <div key={exam.attempt_id} className="flex items-center justify-between p-3 bg-white border border-stone-200 rounded-lg text-sm">
          <span>{exam.title}</span>
          <span className="text-xs text-stone-400">{exam.status === "graded" ? `${exam.total_score}/${exam.max_score}` : exam.status}</span>
        </div>
      ))}
    </div>
  );
}

function ConcoursTab({ studentId, session }) {
  const { data, isLoading, error, retry } = useStudentConcoursSummary(studentId, session);
  if (isLoading) return <Skeleton />;
  if (error) return <ErrorBlock error={error} retry={retry} />;
  return (
    <div className="space-y-4">
      <div className="bg-white border border-stone-200 rounded-xl p-4">
        <p className="text-xs text-stone-500 mb-1">درجة الجاهزية الحالية</p>
        <p className="text-2xl font-bold">{data.readiness?.score ?? "—"}</p>
      </div>
      {data.revisionPlan ? (
        <div className="bg-white border border-stone-200 rounded-xl p-4">
          <h4 className="text-sm font-semibold mb-2">خطة المراجعة الظاهرة للتلميذ</h4>
          <p className="text-xs text-stone-500">{data.revisionPlan.weekly_plan?.length ?? 0} أسبوع</p>
        </div>
      ) : (
        <p className="text-sm text-stone-400">لا توجد خطة مراجعة ظاهرة للتلميذ بعد</p>
      )}
    </div>
  );
}

function ActivityTab({ studentId, session }) {
  const { data, isLoading, error, retry } = useStudentActivityTimeline(studentId);
  if (isLoading) return <Skeleton />;
  if (error) return <ErrorBlock error={error} retry={retry} />;
  if (!data?.data.length) return <p className="text-sm text-stone-400 text-center py-8">لا يوجد نشاط مسجّل بعد</p>;
  return (
    <div className="space-y-2">
      {data.data.map((entry) => (
        <div key={entry.id} className="flex items-start gap-3 p-3 bg-white border border-stone-200 rounded-lg text-sm">
          <span className="text-xs text-stone-400 shrink-0 w-16">{entry.occurred_at?.slice(0, 10)}</span>
          <span>{entry.summary}</span>
        </div>
      ))}
    </div>
  );
}

function AnalyticsTab({ studentId, session }) {
  const { data, isLoading, error, retry } = useStudentAnalytics(studentId, session);
  if (isLoading) return <Skeleton />;
  if (error) return <ErrorBlock error={error} retry={retry} />;
  return (
    <div className="space-y-4">
      <div className="bg-white border border-stone-200 rounded-xl p-4">
        <p className="text-xs text-stone-500 mb-1">المعدل العام للكفاءات</p>
        <p className="text-2xl font-bold">{data.overallAverage ?? "—"}%</p>
      </div>
      {Object.entries(data.bySubject).map(([subject, competencies]) => (
        <div key={subject} className="bg-white border border-stone-200 rounded-xl p-4">
          <h4 className="text-sm font-semibold mb-2">{subject}</h4>
          {competencies.map((c) => <p key={c.competency} className="text-xs text-stone-500">{c.competency}: {c.score}%</p>)}
        </div>
      ))}
    </div>
  );
}

export default function StudentProfile({ studentId, session }) {
  const [activeTab, setActiveTab] = useState("overview");

  const TAB_COMPONENTS = {
    overview: <OverviewTab studentId={studentId} session={session} />,
    personal: <PersonalInfoTab studentId={studentId} session={session} />,
    academic: <AcademicProgressTab studentId={studentId} session={session} />,
    homework: <HomeworkTab studentId={studentId} session={session} />,
    quizzes: <ExamsTab studentId={studentId} session={session} examType="quiz" />,
    exams: <ExamsTab studentId={studentId} session={session} examType="mock_concours" />,
    concours: <ConcoursTab studentId={studentId} session={session} />,
    activity: <ActivityTab studentId={studentId} session={session} />,
    analytics: <AnalyticsTab studentId={studentId} session={session} />,
  };

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <nav className="flex gap-1 overflow-x-auto" role="tablist" aria-label="أقسام ملف التلميذ">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-3 py-2 text-xs whitespace-nowrap rounded-lg flex items-center gap-1.5 ${activeTab === tab.key ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100"}`}
              >
                <tab.icon size={13} /> {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
      <div className="max-w-4xl mx-auto px-6 py-6" role="tabpanel">
        {TAB_COMPONENTS[activeTab]}
      </div>
    </div>
  );
}
