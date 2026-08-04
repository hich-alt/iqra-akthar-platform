/**
 * اقرأ أكثر... ترى أكثر — SHARED FRONTEND INFRASTRUCTURE
 * API Client (new — this is the first shared client in the codebase)
 *
 * Every prior .jsx deliverable in this project used local mocked state
 * because no shared client existed. This is that client: a thin, typed
 * wrapper over Supabase with consistent error shapes, so every future
 * hook (useStudents, useHomework, useExams, ...) calls the same primitives
 * instead of each screen inventing its own fetch logic.
 */

import { createClient } from "@supabase/supabase-js";
import { log } from "./logger";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export class ApiError extends Error {
  constructor(message, { code, status, cause } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.cause = cause;
  }
}

function wrapError(error, context) {
  if (!error) return null;
  log.error(`API call failed: ${context}`, { code: error.code, status: error.status, message: error.message });
  return new ApiError(error.message ?? `Request failed: ${context}`, {
    code: error.code, status: error.status, cause: error,
  });
}

/**
 * Generic list query with search/filter/sort/pagination — every resource
 * hook (students, homework, exams) builds on this rather than reimplementing
 * pagination math per screen.
 */
export async function listResource(table, {
  search, searchColumns = [], filters = {}, sort = { column: "created_at", ascending: false },
  page = 1, pageSize = 25,
} = {}) {
  let query = supabase.from(table).select("*", { count: "exact" });

  if (search && searchColumns.length) {
    const orClause = searchColumns.map((col) => `${col}.ilike.%${search}%`).join(",");
    query = query.or(orClause);
  }

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "all") continue;
    if (Array.isArray(value)) query = query.in(key, value);
    else query = query.eq(key, value);
  }

  query = query.order(sort.column, { ascending: sort.ascending });

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw wrapError(error, `listResource(${table})`);

  return { data, total: count ?? 0, page, pageSize, totalPages: Math.ceil((count ?? 0) / pageSize) };
}

export async function getResource(table, id) {
  const { data, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw wrapError(error, `getResource(${table}, ${id})`);
  return data;
}

export async function updateResource(table, id, patch) {
  const { data, error } = await supabase.from(table).update(patch).eq("id", id).select().maybeSingle();
  if (error) throw wrapError(error, `updateResource(${table}, ${id})`);
  return data;
}

export async function bulkUpdateResource(table, ids, patch) {
  const { data, error } = await supabase.from(table).update(patch).in("id", ids).select();
  if (error) throw wrapError(error, `bulkUpdateResource(${table})`);
  return data;
}

export async function insertResource(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().maybeSingle();
  if (error) throw wrapError(error, `insertResource(${table})`);
  return data;
}

/** For the aggregate views (student_list_view, student_academic_progress_view, etc.) */
export async function queryView(viewName, { filters = {}, orderBy } = {}) {
  let query = supabase.from(viewName).select("*");
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) query = query.eq(key, value);
  }
  if (orderBy) query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
  const { data, error } = await query;
  if (error) throw wrapError(error, `queryView(${viewName})`);
  return data;
}

/**
 * Calls a Postgres RPC function (e.g. set_current_academic_year,
 * get_student_notes) — the single entry point for RPC calls, so no hook
 * file reaches for `supabase.rpc()` directly and reinvents error handling.
 */
export async function callRpc(functionName, params = {}) {
  const { data, error } = await supabase.rpc(functionName, params);
  if (error) throw wrapError(error, `callRpc(${functionName})`);
  return data;
}

/**
 * Storage — path convention {userId}/{filename} is the authorization
 * boundary (see storage-security.sql); this function does not add any
 * access logic of its own, matching every other function in this file.
 */
export async function uploadFile(bucket, path, file) {
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) throw wrapError(error, `uploadFile(${bucket}/${path})`);
  return data;
}

export function getPublicUrl(bucket, path) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteFile(bucket, path) {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw wrapError(error, `deleteFile(${bucket}/${path})`);
}

export { supabase };
