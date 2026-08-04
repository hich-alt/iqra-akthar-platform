/**
 * اقرأ أكثر... ترى أكثر — PROGRESSIVE WEEKLY PUBLISHING (student-facing)
 *
 * New file — justified per the "can this be solved by existing X" check:
 * no existing hook computes per-subject week availability. Reuses
 * published_lessons entirely (already the correct, RLS-enforced source of
 * truth after 13-progressive-weekly-publishing.sql) — this file adds zero
 * new SQL objects and zero new authorization logic. "Locked" here is a
 * PRESENTATION label for the absence of visible rows; the actual
 * enforcement is the RLS policy on `lessons`, not this hook.
 */

import { listResource } from "./api-client";
import { useAsync } from "./use-async";
import { cacheGet, cacheSet } from "./query-cache";

export function useSubjectWeeklyProgress(subjectId, session) {
  return useAsync(async () => {
    const cacheKey = `weekly-progress:${subjectId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    // published_lessons already returns ONLY what RLS permits — a locked
    // week simply produces zero rows here, it is never fetched and then
    // hidden client-side. If a student session somehow bypassed this hook
    // entirely and queried published_lessons directly, they'd get the
    // identical result, which is the point.
    const result = await listResource("published_lessons", {
      filters: { subject_id: subjectId },
      sort: { column: "week_id", ascending: true },
      page: 1, pageSize: 200,
    });

    const weeksWithLessons = new Set(result.data.map((l) => l.week_id));
    // Reconstructing week ORDER requires curriculum_weeks (week_number),
    // which is safe to read for any authenticated user (open-read policy,
    // security-hardening.sql) — no additional authorization concern.
    const weeks = await listResource("curriculum_weeks", {
      sort: { column: "week_number", ascending: true }, page: 1, pageSize: 60,
    });

    let highestAvailableIndex = -1;
    const rows = weeks.data.map((w, i) => {
      const isAvailable = weeksWithLessons.has(w.id);
      if (isAvailable) highestAvailableIndex = i;
      return { weekId: w.id, weekNumber: w.week_number, isAvailable };
    });

    const progress = rows.map((r, i) => ({
      ...r,
      status: !r.isAvailable ? "locked" : i === highestAvailableIndex ? "current" : "completed",
    }));

    cacheSet(cacheKey, progress, 60_000); // publish_date-driven auto-unlocks shouldn't need a full-page refresh to appear, but 30s default felt too aggressive for a value that changes at most a few times a week
    return progress;
  }, [subjectId, session?.userId]);
}
