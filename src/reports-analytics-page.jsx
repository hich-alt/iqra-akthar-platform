import React from "react";
import { BarChart3, FileSpreadsheet, ClipboardList, Target, TrendingUp } from "lucide-react";
import { usePlatformReports } from "./use-platform-reports";
import { Skeleton, ErrorBlock } from "./ui-primitives";

function Stat({ label, value, icon: Icon }) {
  return (
    <div className="bg-white border border-stone-200 rounded-xl p-4">
      <p className="text-xs text-stone-500 mb-1 flex items-center gap-1.5"><Icon size={13} /> {label}</p>
      <p className="text-2xl font-bold">{value ?? "—"}</p>
    </div>
  );
}

export default function ReportsAnalytics({ session }) {
  const { data, isLoading, error, retry } = usePlatformReports(session);

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold flex items-center gap-2"><BarChart3 size={20} /> التقارير والتحليلات</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">
        {isLoading && <Skeleton lines={6} />}
        {error && <ErrorBlock error={error} retry={retry} />}

        {!isLoading && !error && data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="معدل الاختبارات" icon={FileSpreadsheet} value={data.examSummary.averagePct ? `${data.examSummary.averagePct}%` : "—"} />
              <Stat label="واجبات بانتظار التصحيح" icon={ClipboardList} value={data.homeworkSummary.pendingCount} />
              <Stat label="متوسط الجاهزية" icon={Target} value={data.readinessDistribution.average} />
              <Stat label="تسليمات متأخرة" icon={TrendingUp} value={data.examSummary.lateCount} />
            </div>

            <div className="bg-white border border-stone-200 rounded-xl p-4">
              <h3 className="text-sm font-bold mb-3">الأداء حسب المادة</h3>
              {data.competencyHeatmap.length === 0 ? (
                <p className="text-xs text-stone-400">لا توجد بيانات كافية بعد</p>
              ) : (
                <div className="space-y-2">
                  {data.competencyHeatmap.map((s) => (
                    <div key={s.subject} className="flex items-center gap-3">
                      <span className="text-sm w-32 shrink-0">{s.subject}</span>
                      <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${s.averageScore}%`, backgroundColor: s.averageScore >= 60 ? "#2f6b52" : "#a13c3c" }} />
                      </div>
                      <span className="text-xs text-stone-500 w-12 text-left">{s.averageScore}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-stone-200 rounded-xl p-4">
              <h3 className="text-sm font-bold mb-3">توزيع الجاهزية ({data.readinessDistribution.studentCount ?? 0} تلميذ)</h3>
              {Object.entries(data.readinessDistribution.distribution ?? {}).map(([bucket, count]) => (
                <div key={bucket} className="flex items-center justify-between text-sm py-1">
                  <span className="text-stone-500">{bucket}</span>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
