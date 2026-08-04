import React from "react";
import { BookOpen, ClipboardList, Bell, CheckCircle2, Lock, CheckCheck, Download, Send, FileCheck2, Megaphone } from "lucide-react";
import { useStudentDashboard, markNotificationRead } from "./use-student-dashboard";
import { useSubjectWeeklyProgress } from "./use-weekly-progress";
import { Skeleton, ErrorBlock, LiveStatusAnnouncer } from "./ui-primitives";

/**
 * Student Dashboard — Milestone 2, third pass: task-driven, not
 * subject-driven.
 *
 * HERO TASK PRIORITY (exactly as specified):
 * 1. Homework waiting for submission
 * 2. Newly published lesson (published within the last 3 days, not yet
 *    superseded by a submission-needed item)
 * 3. Teacher correction to review (graded within the last 3 days)
 * 4. Upcoming assessment (within 7 days)
 * 5. General announcement (any other unread notification)
 * Recomputed fresh from live data every load — completing a task (a
 * submission goes through, a notification gets marked read) changes what
 * the NEXT fetch returns, so the Hero naturally advances without any
 * separate "completed tasks" tracking needed.
 *
 * Below the Hero: Weekly Progress, Notifications, Recent Corrections,
 * Subject Overview — all visible by default now (not collapsed), but
 * visually secondary (smaller type, no border-2, lower on the page) so
 * the Hero remains the one thing that dominates.
 */

const WEEK_STATUS_META = {
  completed: { icon: CheckCheck, color: "#2f6b52", bg: "#e8f3ed" },
  current:   { icon: BookOpen,   color: "#1f4e79", bg: "#e8eff7" },
  locked:    { icon: Lock,       color: "#a8a29e", bg: "#f5f5f4" },
};

const DAY_MS = 86_400_000;

function computeHeroTask(data) {
  // 1. Homework waiting for submission — matched to its lesson via
  // homework_id, so we can name the subject and lesson specifically.
  for (const lesson of data.currentLessons) {
    if (!lesson.homework_id) continue;
    const hw = data.homeworkSummary.find((h) => h.homework_id === lesson.homework_id);
    if (!hw || hw.status === "not_submitted") {
      return {
        kind: "submit_homework", subjectName: lesson.subject_name, lessonTitle: lesson.title,
        actionLabel: "تسليم الواجب", icon: Send,
      };
    }
  }

  // 2. Newly published lesson (last 3 days)
  const recentLesson = data.currentLessons.find(
    (l) => l.published_at && Date.now() - new Date(l.published_at).getTime() < 3 * DAY_MS
  );
  if (recentLesson) {
    return {
      kind: "new_lesson", subjectName: recentLesson.subject_name, lessonTitle: recentLesson.title,
      actionLabel: "عرض الدرس", icon: Download,
    };
  }

  // 3. Teacher correction to review (graded in the last 3 days)
  const recentCorrection = data.homeworkSummary.find(
    (h) => h.status === "graded" && h.correction_file_url && h.correction_published_at
      && Date.now() - new Date(h.correction_published_at).getTime() < 3 * DAY_MS
  );
  if (recentCorrection) {
    return { kind: "review_correction", subjectName: null, lessonTitle: null, actionLabel: "عرض التصحيح", icon: FileCheck2, url: recentCorrection.correction_file_url };
  }

  // 4. Upcoming assessment (within 7 days)
  const upcoming = data.upcomingExams.find((e) => new Date(e.scheduled_start) - Date.now() < 7 * DAY_MS);
  if (upcoming) {
    return { kind: "upcoming_exam", subjectName: null, lessonTitle: upcoming.title, actionLabel: "استعد الآن", icon: BookOpen };
  }

  // 5. General announcement
  if (data.unreadNotifications.length > 0) {
    return { kind: "announcement", subjectName: null, lessonTitle: data.unreadNotifications[0].title, actionLabel: "عرض", icon: Megaphone, notificationId: data.unreadNotifications[0].id };
  }

  return { kind: "none" };
}

function WeekTimeline({ subjectId, session }) {
  const { data: weeks, isLoading } = useSubjectWeeklyProgress(subjectId, session);
  if (isLoading || !weeks?.length) return null;
  return (
    <div className="flex gap-1 overflow-x-auto pb-1">
      {weeks.map((w) => {
        const meta = WEEK_STATUS_META[w.status];
        const Icon = meta.icon;
        return (
          <div key={w.weekId} className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: meta.bg, color: meta.color }}>
            <Icon size={11} />
          </div>
        );
      })}
    </div>
  );
}

function HeroCard({ hero, onDismissAnnouncement }) {
  if (hero.kind === "none") {
    return (
      <div className="bg-white border-2 border-stone-900 rounded-2xl p-8 text-center">
        <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-600" />
        <p className="text-base font-bold">أنجزت كل شيء لهذا اليوم 🎉</p>
      </div>
    );
  }

  const Icon = hero.icon;
  return (
    <div className="bg-white border-2 border-stone-900 rounded-2xl p-6 text-center">
      <p className="text-xs text-stone-400 mb-2">ابدأ هنا</p>
      {hero.subjectName && <p className="text-sm text-stone-500 mb-1">{hero.subjectName}</p>}
      <p className="text-lg font-bold mb-4">{hero.lessonTitle}</p>
      <a
        href={hero.url ?? "#"}
        onClick={hero.kind === "announcement" ? () => onDismissAnnouncement(hero.notificationId) : undefined}
        target={hero.url ? "_blank" : undefined} rel="noreferrer"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-stone-900 text-white rounded-xl text-sm font-medium"
      >
        <Icon size={15} /> {hero.actionLabel}
      </a>
    </div>
  );
}

export default function StudentDashboard({ studentId, session }) {
  const { data, isLoading, error, retry } = useStudentDashboard(studentId, session);

  async function handleMarkRead(id) {
    await markNotificationRead(id);
    retry();
  }

  const hero = data ? computeHeroTask(data) : null;
  const recentCorrections = data?.homeworkSummary.filter((h) => h.status === "graded" && h.correction_file_url).slice(0, 3) ?? [];

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold">مرحبًا 👋</h1>
        </div>
      </div>

      <LiveStatusAnnouncer isLoading={isLoading} error={error} successMessage="تم تحميل لوحتك" />

      <div className="max-w-2xl mx-auto px-6 py-6">
        {isLoading && <Skeleton lines={6} />}
        {error && <ErrorBlock error={error} retry={retry} />}

        {!isLoading && !error && data && (
          <div className="space-y-6">
            <HeroCard hero={hero} onDismissAnnouncement={handleMarkRead} />

            {/* Everything below is visible by default, but visually
                secondary — smaller text, thinner borders, lower emphasis —
                so it never competes with the Hero for attention. */}

            <div>
              <h3 className="text-xs font-semibold text-stone-400 mb-2">التقدم الأسبوعي</h3>
              <div className="bg-white border border-stone-100 rounded-xl p-3 space-y-2">
                {data.currentLessons.map((l) => (
                  <div key={l.lesson_id} className="flex items-center gap-3">
                    <span className="text-xs text-stone-500 w-16 shrink-0">{l.subject_name}</span>
                    <WeekTimeline subjectId={l.subject_id} session={session} />
                  </div>
                ))}
              </div>
            </div>

            {data.unreadNotifications.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-stone-400 mb-2 flex items-center gap-1"><Bell size={12} /> الإشعارات</h3>
                <div className="bg-white border border-stone-100 rounded-xl p-3 space-y-1.5">
                  {data.unreadNotifications.map((n) => (
                    <div key={n.id} className="flex items-center justify-between text-xs p-1.5">
                      <span className="text-stone-600">{n.title}</span>
                      <button onClick={() => handleMarkRead(n.id)} aria-label="تمت القراءة" className="text-stone-300"><CheckCircle2 size={13} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {recentCorrections.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-stone-400 mb-2 flex items-center gap-1"><ClipboardList size={12} /> آخر التصحيحات</h3>
                <div className="bg-white border border-stone-100 rounded-xl p-3 space-y-1.5">
                  {recentCorrections.map((hw) => (
                    <div key={hw.id} className="flex items-center justify-between text-xs">
                      <span className="text-stone-500 font-medium">{hw.total_score}/{hw.max_score}</span>
                      <a href={hw.correction_file_url} target="_blank" rel="noreferrer" className="text-stone-400 underline">عرض</a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
