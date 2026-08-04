import React, { useState, useEffect } from "react";
import { Users, CheckCircle2, Clock, FileSpreadsheet } from "lucide-react";
import { useLinkedChildren, useChildDashboard } from "./use-parent-dashboard";
import { Skeleton, ErrorBlock, EmptyState, LiveStatusAnnouncer } from "./ui-primitives";

/**
 * Parent Dashboard — Milestone 2 redesign.
 *
 * THREE-PERSPECTIVE TEST: "can a parent monitor progress in under a
 * minute?" The previous version had four detailed sections including a
 * competency-by-competency breakdown — informative, but not a one-minute
 * glance. This version leads with THREE numbers (homework done this week,
 * pending, latest exam result) a parent reads at a glance, then a short
 * list underneath for anyone who wants more detail. No numeric scores
 * beyond exam results (which the vision doc explicitly asks for);
 * "readiness" and competency detail are gone entirely, not hidden — a
 * parent isn't the audience for either.
 *
 * Still read-only, matching the original "Parents never edit educational
 * content" rule — no change to that from Milestone 2.
 */

function BigStat({ icon: Icon, label, value, tone }) {
  const tones = { good: "#2f6b52", warn: "#a8641a", neutral: "#57534e" };
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4 text-center">
      <Icon size={20} className="mx-auto mb-1" style={{ color: tones[tone] ?? tones.neutral }} />
      <p className="text-2xl font-bold" style={{ color: tones[tone] ?? tones.neutral }}>{value}</p>
      <p className="text-xs text-stone-500 mt-0.5">{label}</p>
    </div>
  );
}

export default function ParentDashboard({ session }) {
  const { data: children, isLoading: childrenLoading, error: childrenError, retry: retryChildren } = useLinkedChildren(session);
  const [selectedChildId, setSelectedChildId] = useState(null);

  useEffect(() => {
    if (children?.length && !selectedChildId) setSelectedChildId(children[0].student_id);
  }, [children, selectedChildId]);

  const { data, isLoading, error, retry } = useChildDashboard(selectedChildId, session);

  const doneCount = data?.homeworkSummary.filter((h) => h.status === "graded" || h.status === "submitted").length ?? 0;
  const pendingCount = data?.homeworkSummary.filter((h) => h.status === "not_submitted").length ?? 0;
  const latestExam = data?.examAttempts?.[0];

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold flex items-center gap-2"><Users size={20} /> متابعة ابني/ابنتي</h1>
        </div>
      </div>

      <LiveStatusAnnouncer isLoading={childrenLoading || isLoading} error={childrenError || error} successMessage="تم تحميل البيانات" />

      <div className="max-w-4xl mx-auto px-6 py-6">
        {childrenLoading && <Skeleton lines={3} />}
        {childrenError && <ErrorBlock error={childrenError} retry={retryChildren} />}

        {!childrenLoading && !childrenError && children?.length === 0 && (
          <EmptyState message="لا يوجد أبناء مرتبطون بحسابك بعد. يرجى التواصل مع إدارة المدرسة." />
        )}

        {!childrenLoading && !childrenError && children?.length > 0 && (
          <>
            {children.length > 1 && (
              <div className="flex gap-2 mb-5 overflow-x-auto">
                {children.map((child) => (
                  <button
                    key={child.student_id}
                    onClick={() => setSelectedChildId(child.student_id)}
                    className={`px-4 py-2 text-sm rounded-lg whitespace-nowrap ${selectedChildId === child.student_id ? "bg-stone-900 text-white" : "bg-white border border-stone-200 text-stone-600"}`}
                  >
                    {child.studentName}
                  </button>
                ))}
              </div>
            )}

            {isLoading && <Skeleton lines={4} />}
            {error && <ErrorBlock error={error} retry={retry} />}

            {!isLoading && !error && data && (
              <>
                {/* The one-minute glance: three numbers, nothing to read */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  <BigStat icon={CheckCircle2} label="واجبات منجزة" value={doneCount} tone="good" />
                  <BigStat icon={Clock} label="لم تُسلَّم بعد" value={pendingCount} tone={pendingCount > 0 ? "warn" : "good"} />
                  <BigStat icon={FileSpreadsheet} label="آخر نتيجة" value={latestExam ? `${latestExam.total_score}/${latestExam.max_score}` : "—"} tone="neutral" />
                </div>

                {/* Detail underneath, for anyone who wants more than the glance */}
                <div className="bg-white border border-stone-200 rounded-xl p-4">
                  <h3 className="text-sm font-bold mb-3">آخر الواجبات</h3>
                  {data.homeworkSummary.length === 0 ? (
                    <p className="text-xs text-stone-400">لا توجد واجبات بعد</p>
                  ) : (
                    <ul className="space-y-2">
                      {data.homeworkSummary.slice(0, 5).map((hw) => (
                        <li key={hw.id} className="text-sm">
                          <div className="flex justify-between">
                            <span>{hw.status === "graded" ? "✅ تم التصحيح" : "⏳ بانتظار التصحيح"}</span>
                            {hw.status === "graded" && <span className="text-stone-500">{hw.total_score}/{hw.max_score}</span>}
                          </div>
                          {hw.status === "graded" && hw.feedback && <p className="text-xs text-stone-500 mt-0.5">{hw.feedback}</p>}
                          {hw.status === "graded" && hw.correction_file_url && (
                            <a href={hw.correction_file_url} target="_blank" rel="noreferrer" className="text-xs text-stone-500 underline">عرض التصحيح</a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
