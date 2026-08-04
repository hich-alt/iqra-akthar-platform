/**
 * اقرأ أكثر... ترى أكثر — CURRICULUM MANAGER
 * Structure Hooks — academic years, terms, weeks, fields, subjects.
 * Distinct from use-lessons.js (which handles lesson CONTENT within this
 * structure). No overlap: this file never touches the `lessons` table.
 */

import { listResource, insertResource, updateResource, callRpc, ApiError } from "./api-client";
import { can } from "./permissions";
import { useAsync } from "./use-async";
import { cacheGet, cacheSet, cacheInvalidate } from "./query-cache";
import { log } from "./logger";

function assertCanManage(session) {
  if (!can(session, "curriculum.structure.manage")) {
    throw new ApiError("ليست لديك صلاحية إدارة هيكل المنهج", { code: "FORBIDDEN", status: 403 });
  }
}

export function useAcademicYears() {
  return useAsync(async () => {
    const cacheKey = "curriculum:years";
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const result = await listResource("academic_years", { sort: { column: "start_date", ascending: false }, page: 1, pageSize: 50 });
    cacheSet(cacheKey, result.data, 5 * 60_000); // rarely changes
    return result.data;
  }, []);
}

export function useFieldsAndSubjects() {
  return useAsync(async () => {
    const cacheKey = "curriculum:fields-subjects";
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const [fields, subjects] = await Promise.all([
      listResource("educational_fields", { sort: { column: "display_order", ascending: true }, page: 1, pageSize: 50 }),
      listResource("subjects", { sort: { column: "display_order", ascending: true }, page: 1, pageSize: 100 }),
    ]);
    const result = fields.data.map((f) => ({ ...f, subjects: subjects.data.filter((s) => s.field_id === f.id) }));
    cacheSet(cacheKey, result, 5 * 60_000);
    return result;
  }, []);
}

export function useTermsAndWeeks(academicYearId) {
  return useAsync(async () => {
    if (!academicYearId) return [];
    const terms = await listResource("terms", { filters: { academic_year_id: academicYearId }, sort: { column: "term_number", ascending: true }, page: 1, pageSize: 3 });
    const weeksByTerm = await Promise.all(
      terms.data.map((t) => listResource("curriculum_weeks", { filters: { term_id: t.id }, sort: { column: "week_number", ascending: true }, page: 1, pageSize: 20 }))
    );
    return terms.data.map((t, i) => ({ ...t, weeks: weeksByTerm[i].data }));
  }, [academicYearId]);
}

export function useCurriculumStructureMutations(session) {
  async function createAcademicYear({ label, startDate, endDate }) {
    assertCanManage(session);
    const created = await insertResource("academic_years", { label, start_date: startDate, end_date: endDate });
    log.info("Academic year created", { actorId: session?.userId, yearId: created.id, label });
    cacheInvalidate("curriculum:");
    return created;
  }

  async function setCurrentAcademicYear(yearId) {
    assertCanManage(session);
    // Atomic RPC (see security-hardening.sql) — not two sequential updates,
    // since that could race or transiently leave zero years marked current.
    await callRpc("set_current_academic_year", { p_year_id: yearId });
    log.info("Current academic year changed", { actorId: session?.userId, yearId });
    cacheInvalidate("curriculum:");
  }

  async function createTerm(academicYearId, termNumber, { startDate, endDate }) {
    assertCanManage(session);
    const created = await insertResource("terms", { academic_year_id: academicYearId, term_number: termNumber, start_date: startDate, end_date: endDate });
    cacheInvalidate("curriculum:");
    return created;
  }

  async function createWeek(termId, weekNumber, startDate) {
    assertCanManage(session);
    const created = await insertResource("curriculum_weeks", { term_id: termId, week_number: weekNumber, start_date: startDate });
    cacheInvalidate("curriculum:");
    return created;
  }

  async function createField(name, displayOrder = 0) {
    assertCanManage(session);
    const created = await insertResource("educational_fields", { name, display_order: displayOrder });
    cacheInvalidate("curriculum:");
    return created;
  }

  async function createSubject(fieldId, name, displayOrder = 0) {
    assertCanManage(session);
    const created = await insertResource("subjects", { field_id: fieldId, name, display_order: displayOrder });
    cacheInvalidate("curriculum:");
    return created;
  }

  return { createAcademicYear, setCurrentAcademicYear, createTerm, createWeek, createField, createSubject };
}
