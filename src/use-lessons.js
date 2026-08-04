/**
 * اقرأ أكثر... ترى أكثر — LESSON EDITOR
 * Query Hooks — reuses api-client.js, permissions.js, query-cache.js,
 * use-async.js, logger.js. No new infrastructure introduced; this file is
 * proof the shared foundation from Student Management/Parent Portal
 * generalizes to a third, structurally different domain without needing
 * its own cache, its own error type, or its own async wrapper.
 */

import { listResource, insertResource, updateResource, callRpc, ApiError } from "./api-client";
import { can } from "./permissions";
import { useAsync } from "./use-async";
import { cacheGet, cacheSet, cacheInvalidate } from "./query-cache";
import { log } from "./logger";

/**
 * One query against owner_lesson_browser_view (curriculum-manager-schema.sql),
 * grouped client-side into field -> subject -> week -> lessons. This is
 * presentation-shaping, not a second data-fetching implementation — the
 * grouping logic could move into the view itself later if a second
 * consumer ever needs it flat instead of grouped, per "keep it generic
 * only once a second real consumer justifies it."
 */
export function useLessonTree(session) {
  return useAsync(async () => {
    if (!can(session, "lesson.create") && !can(session, "lesson.edit")) {
      throw new ApiError("ليست لديك صلاحية إدارة المنهج", { code: "FORBIDDEN", status: 403 });
    }
    const cacheKey = "lessons:tree";
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    const result = await listResource("owner_lesson_browser_view", {
      sort: { column: "display_order", ascending: true },
      page: 1, pageSize: 500, // authoring screen; a real pagination pass belongs to whichever school's curriculum outgrows this
    });

    const tree = groupIntoTree(result.data);
    cacheSet(cacheKey, tree);
    return tree;
  }, [session?.userId]);
}

function groupIntoTree(rows) {
  const fields = new Map();
  for (const row of rows) {
    if (!fields.has(row.field_id)) fields.set(row.field_id, { id: row.field_id, name: row.field_name, subjects: new Map() });
    const field = fields.get(row.field_id);

    if (!field.subjects.has(row.subject_id)) field.subjects.set(row.subject_id, { id: row.subject_id, name: row.subject_name, weeks: new Map() });
    const subject = field.subjects.get(row.subject_id);

    if (!subject.weeks.has(row.week_id)) subject.weeks.set(row.week_id, { id: row.week_id, weekNumber: row.week_number, lessons: [] });
    subject.weeks.get(row.week_id).lessons.push({
      id: row.id, title: row.title, status: row.status, competencyIds: row.competency_ids ?? [],
    });
  }
  return [...fields.values()].map((f) => ({
    ...f, subjects: [...f.subjects.values()].map((s) => ({ ...s, weeks: [...s.weeks.values()] })),
  }));
}

export function useCompetencies() {
  return useAsync(async () => {
    const cacheKey = "competencies:all";
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const result = await listResource("competencies", { page: 1, pageSize: 500 });
    cacheSet(cacheKey, result.data, 5 * 60_000); // competencies change rarely — longer TTL than the 30s default
    return result.data;
  }, []);
}

export function useLessonMutations(session) {
  function assertCanEdit() {
    if (!can(session, "lesson.edit") && !can(session, "lesson.create")) {
      throw new ApiError("ليست لديك صلاحية تعديل هذا الدرس", { code: "FORBIDDEN", status: 403 });
    }
  }

  async function createLesson(weekId, subjectId, data) {
    assertCanEdit();
    const created = await insertResource("lessons", {
      week_id: weekId, subject_id: subjectId, owner_id: session?.userId,
      title: data.title, content_body: data.content_body,
      competency_ids: data.competencyIds, status: data.status ?? "draft",
      publish_date: data.publishDate ?? null,
    });
    log.info("Lesson created", { actorId: session?.userId, lessonId: created.id, status: created.status, publishDate: created.publish_date });
    cacheInvalidate("lessons:");
    return created;
  }

  async function updateLesson(lessonId, data) {
    assertCanEdit();
    const updated = await updateResource("lessons", lessonId, {
      title: data.title, content_body: data.content_body,
      competency_ids: data.competencyIds, status: data.status,
      publish_date: data.publishDate ?? null,
    });
    log.info("Lesson updated", { actorId: session?.userId, lessonId, status: data.status, publishDate: data.publishDate });
    cacheInvalidate("lessons:");
    return updated;
  }

  async function setLessonStatus(lessonId, status) {
    if (!can(session, "lesson.publish") && !can(session, "lesson.archive")) {
      throw new ApiError("ليست لديك صلاحية تغيير حالة هذا الدرس", { code: "FORBIDDEN", status: 403 });
    }
    // 'published' is deliberately rejected here — see publishNow()/
    // reopenHomework() below. Those RPCs are now the only paths that
    // reach 'published', since they're also the only paths that fire the
    // required notifications (14-lesson-publishing-modes.sql). This
    // function remains valid for draft/scheduled/archived/closed, which
    // fire no notification and stay as plain column-privileged updates.
    if (status === "published") {
      throw new ApiError("استخدم publishNow أو reopenHomework للنشر — لا يمكن تعيين الحالة مباشرة", { code: "INVALID_TRANSITION" });
    }
    const updated = await updateResource("lessons", lessonId, { status });
    log.info("Lesson status changed", { actorId: session?.userId, lessonId, newStatus: status });
    cacheInvalidate("lessons:");
    return updated;
  }

  async function publishNow(lessonId) {
    if (!can(session, "lesson.publish")) {
      throw new ApiError("ليست لديك صلاحية نشر هذا الدرس", { code: "FORBIDDEN", status: 403 });
    }
    await callRpc("publish_lesson", { p_lesson_id: lessonId });
    log.info("Lesson published (manual)", { actorId: session?.userId, lessonId });
    cacheInvalidate("lessons:");
  }

  async function reopenHomework(lessonId, newDeadlineIso) {
    if (!can(session, "lesson.publish")) {
      throw new ApiError("ليست لديك صلاحية إعادة فتح هذا الواجب", { code: "FORBIDDEN", status: 403 });
    }
    await callRpc("reopen_lesson_homework", { p_lesson_id: lessonId, p_new_deadline: newDeadlineIso });
    log.info("Lesson homework reopened", { actorId: session?.userId, lessonId, newDeadlineIso });
    cacheInvalidate("lessons:");
  }

  return { createLesson, updateLesson, setLessonStatus, publishNow, reopenHomework };
}
