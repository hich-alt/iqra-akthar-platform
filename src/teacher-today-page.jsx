import React from "react";
import { CheckCircle2, ClipboardCheck, Users, Send } from "lucide-react";
import { useTeacherToday } from "./use-teacher-today";
import { useLessonMutations } from "./use-lessons";
import { Skeleton, ErrorBlock } from "./ui-primitives";

/**
 * Teacher Today — the new default landing screen. Answers exactly one
 * question: "what do I need to publish today?" Everything else (the full
 * lesson tree, curriculum structure, reports) is reachable from secondary
 * navigation, not shown here by default — per this milestone's "one
 * obvious action per screen" principle.
 */

export default function TeacherToday({ session }) {
  const { data, isLoading, error, retry } = useTeacherToday(session);
  const { publishNow } = useLessonMutations(session);

  async function handlePublish(lessonId) {
    await publishNow(lessonId);
    retry();
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold">اليوم</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6">
        {isLoading && <Skeleton lines={5} />}
        {error && <ErrorBlock error={error} retry={retry} />}

        {!isLoading && !error && data && (
          <div className="space-y-4">
            {data.needsAttention.length === 0 ? (
              <div className="bg-white border border-stone-200 rounded-xl p-8 text-center">
                <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-600" />
                <p className="text-sm text-stone-600">لا يوجد ما ينتظر النشر اليوم</p>
              </div>
            ) : (
              <div className="bg-white border border-stone-200 rounded-xl p-4">
                <h2 className="text-sm font-bold mb-3">جاهز للنشر ({data.needsAttention.length})</h2>
                <div className="space-y-2">
                  {data.needsAttention.map((l) => (
                    <div key={l.id} className="flex items-center justify-between p-2.5 bg-stone-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium">{l.title}</p>
                        <p className="text-xs text-stone-400">{l.subject_name}</p>
                      </div>
                      <button
                        onClick={() => handlePublish(l.id)}
                        className="px-3 py-1.5 bg-stone-900 text-white text-xs rounded-md flex items-center gap-1.5"
                      >
                        <Send size={12} /> نشر الآن
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Secondary — visible but visually quieter, reachable, not the hero */}
            <div className="grid grid-cols-2 gap-3">
              <a href="#/correction-queue" className="bg-white border border-stone-200 rounded-xl p-4 flex items-center gap-3 hover:border-stone-300">
                <ClipboardCheck size={20} className="text-stone-400" />
                <div>
                  <p className="text-lg font-bold">{data.pendingCorrectionCount}</p>
                  <p className="text-xs text-stone-500">بانتظار التصحيح</p>
                </div>
              </a>
              <a href="#/non-submitters" className="bg-white border border-stone-200 rounded-xl p-4 flex items-center gap-3 hover:border-stone-300">
                <Users size={20} className="text-stone-400" />
                <div>
                  <p className="text-lg font-bold">{data.nonSubmitterCount}</p>
                  <p className="text-xs text-stone-500">لم يسلّموا بعد</p>
                </div>
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
