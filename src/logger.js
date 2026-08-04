/**
 * اقرأ أكثر... ترى أكثر — SHARED FRONTEND INFRASTRUCTURE
 * Logger (new — no logging existed anywhere in the frontend before this)
 *
 * Deliberately minimal: console-based with a consistent shape, so it's a
 * single-line swap to a real provider (Sentry, LogRocket, etc.) later
 * without touching every call site. Every shared hook/client error path
 * now routes through this rather than silently swallowing or inconsistently
 * console.log-ing.
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS.info; // adjust per environment when a real config system exists

function emit(level, message, context) {
  if (LEVELS[level] < MIN_LEVEL) return;
  const entry = { level, message, timestamp: new Date().toISOString(), ...context };
  // eslint-disable-next-line no-console
  console[level === "debug" ? "log" : level](`[${entry.timestamp}] ${message}`, context ?? "");
  return entry;
}

export const log = {
  debug: (message, context) => emit("debug", message, context),
  info: (message, context) => emit("info", message, context),
  warn: (message, context) => emit("warn", message, context),
  error: (message, context) => emit("error", message, context),
};
