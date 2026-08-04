import React from "react";
import { AlertCircle, RefreshCw, Inbox } from "lucide-react";

/**
 * اقرأ أكثر... ترى أكثر — SHARED FRONTEND INFRASTRUCTURE
 * UI Primitives (new — extracted from student-profile-page.jsx, which had
 * a local Skeleton/ErrorBlock that Student Dashboard was about to duplicate
 * a second time)
 */

export function Skeleton({ lines = 4 }) {
  return (
    <div className="space-y-2 animate-pulse" role="status" aria-label="جارٍ التحميل">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 bg-stone-200 rounded" style={{ width: `${90 - i * 10}%` }} />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, retry }) {
  return (
    <div className="p-6 text-center bg-white border border-red-200 rounded-xl" role="alert">
      <AlertCircle size={22} className="mx-auto mb-2 text-red-500" />
      <p className="text-sm text-stone-700 mb-3">{error?.message ?? "حدث خطأ أثناء تحميل البيانات"}</p>
      {retry && (
        <button onClick={retry} className="inline-flex items-center gap-1.5 px-4 py-2 bg-stone-900 text-white text-sm rounded-lg focus-visible:ring-2 focus-visible:ring-stone-400">
          <RefreshCw size={13} /> إعادة المحاولة
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message }) {
  return (
    <div className="p-10 text-center bg-white border border-stone-200 rounded-xl">
      <Inbox size={26} className="mx-auto mb-3 text-stone-300" />
      <p className="text-sm text-stone-400">{message}</p>
    </div>
  );
}

/** Visually-hidden live region for screen-reader status announcements — the
 * same pattern added to student-list-page.jsx during its audit, now shared. */
export function LiveStatusAnnouncer({ isLoading, error, successMessage }) {
  return (
    <div aria-live="polite" className="sr-only">
      {isLoading && "جارٍ التحميل"}
      {error && `حدث خطأ: ${error.message}`}
      {!isLoading && !error && successMessage}
    </div>
  );
}
