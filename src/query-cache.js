/**
 * اقرأ أكثر... ترى أكثر — SHARED FRONTEND INFRASTRUCTURE
 * Query Cache (extracted from use-students.js, which had the only copy of
 * this logic — a module-scope in-memory cache, not a real library, since
 * adopting React Query/SWR wholesale mid-module would be an architecture
 * change nobody asked for. This is the minimum viable shared version.)
 *
 * Namespaced by key prefix (e.g. "students:", "lessons:") so invalidating
 * one hook file's cache never touches another's, without needing separate
 * Map instances per file.
 */

const store = new Map();
const DEFAULT_TTL_MS = 30_000;

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry || Date.now() - entry.time > entry.ttl) return null;
  return entry.value;
}

export function cacheSet(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, { value, time: Date.now(), ttl: ttlMs });
}

export function cacheInvalidate(prefix) {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}
