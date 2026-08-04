import React, { useState, useCallback, useMemo } from "react";
import { Search, ChevronUp, ChevronDown, MoreVertical, Users, Eye, Ban, CheckCircle2 } from "lucide-react";
import { useStudentList, useStudentMutations } from "./use-students";
import { ErrorBlock, LiveStatusAnnouncer } from "./ui-primitives";

/**
 * Student List — Phase 1
 *
 * Built on the real query hooks in use-students.js. This will not render
 * live data in this environment (no Supabase connection here), but it is
 * production code, not a mocked prototype like the earlier UI deliverables —
 * every data operation goes through the shared hook/client/permission layer.
 *
 * Filters are synced to the URL via useFiltersFromSearchParams so a filtered
 * view is shareable/deep-linkable, per the Phase 1 requirement.
 */

const STATUS_META = {
  active:    { label: "نشط", color: "#2f6b52", bg: "#e8f3ed" },
  inactive:  { label: "غير نشط", color: "#8b8378", bg: "#f2f0ec" },
  suspended: { label: "موقوف", color: "#a13c3c", bg: "#faeaea" },
};

function useFiltersFromSearchParams() {
  const [params, setParams] = useState(() => new URLSearchParams(window.location.search));

  const update = useCallback((patch) => {
    const next = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === null || value === "" || value === "all") next.delete(key);
      else next.set(key, value);
    }
    window.history.replaceState(null, "", `?${next.toString()}`);
    setParams(next);
  }, []);

  return {
    search: params.get("q") ?? "",
    status: params.get("status") ?? "all",
    sortColumn: params.get("sort") ?? "full_name",
    sortDir: params.get("dir") ?? "asc",
    page: parseInt(params.get("page") ?? "1", 10),
    update,
  };
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-3 border-b border-stone-100 animate-pulse">
      <div className="w-4 h-4 bg-stone-200 rounded" />
      <div className="w-9 h-9 bg-stone-200 rounded-full" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-stone-200 rounded w-1/3" />
        <div className="h-2.5 bg-stone-100 rounded w-1/5" />
      </div>
      <div className="w-16 h-5 bg-stone-200 rounded-full" />
      <div className="w-12 h-5 bg-stone-100 rounded" />
    </div>
  );
}

function SortableHeader({ label, column, currentColumn, currentDir, onSort }) {
  const isActive = currentColumn === column;
  return (
    <button
      onClick={() => onSort(column)}
      className="flex items-center gap-1 text-xs font-semibold text-stone-500 hover:text-stone-900"
      aria-sort={isActive ? (currentDir === "asc" ? "ascending" : "descending") : "none"}
    >
      {label}
      {isActive && (currentDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
    </button>
  );
}

export default function StudentList({ session }) {
  const { search, status, sortColumn, sortDir, page, update } = useFiltersFromSearchParams();
  const [selected, setSelected] = useState(new Set());
  const [searchInput, setSearchInput] = useState(search);
  const { bulkUpdateStatus } = useStudentMutations(session);
  const [bulkActionPending, setBulkActionPending] = useState(false);

  const { data: result, isLoading, error, retry } = useStudentList({
    search, filters: { status }, sort: { column: sortColumn, ascending: sortDir === "asc" },
    page, pageSize: 25, session,
  });

  function handleSort(column) {
    if (sortColumn === column) update({ sort: column, dir: sortDir === "asc" ? "desc" : "asc" });
    else update({ sort: column, dir: "asc" });
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    update({ q: searchInput, page: 1 });
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!result?.data) return;
    setSelected((prev) => (prev.size === result.data.length ? new Set() : new Set(result.data.map((s) => s.user_id))));
  }

  async function handleBulkStatus(newStatus) {
    setBulkActionPending(true);
    try {
      await bulkUpdateStatus([...selected], newStatus);
      setSelected(new Set());
      retry();
    } catch (err) {
      // Rollback is implicit here — we never applied an optimistic update
      // for bulk status changes, since a wrong bulk suspend/activate is
      // high-blast-radius; we wait for server confirmation before UI changes.
      alert(err.message); // replace with the platform's toast system once one exists
    } finally {
      setBulkActionPending(false);
    }
  }

  const columns = useMemo(() => ([
    { key: "full_name", label: "الاسم" },
    { key: "enrollment_date", label: "تاريخ التسجيل" },
    { key: "exam_average", label: "معدل الاختبارات" },
    { key: "latest_readiness_score", label: "الجاهزية" },
    { key: "pending_grading_count", label: "بانتظار التصحيح" },
  ]), []);

  return (
    <div dir="rtl" className="min-h-screen bg-[#faf9f7] text-stone-900" style={{ fontFamily: "'Noto Kufi Arabic', 'Segoe UI', sans-serif" }}>
      <div className="border-b border-stone-200 bg-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <h1 className="text-xl font-bold flex items-center gap-2"><Users size={20} /> إدارة التلاميذ</h1>
          <p className="text-sm text-stone-500 mt-1">{result?.total ?? 0} تلميذ</p>
        </div>
      </div>

      {/* WCAG: announces loading/result/error transitions to screen readers,
          which the visual-only skeleton/error blocks below do not do on their own. */}
      <LiveStatusAnnouncer isLoading={isLoading} error={error} successMessage={result && `تم العثور على ${result.total} تلميذ`} />

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Search + filters */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <form onSubmit={handleSearchSubmit} className="relative flex-1 min-w-[200px]">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
              placeholder="بحث بالاسم..." aria-label="بحث عن تلميذ"
              className="w-full pr-9 pl-3 py-2 rounded-lg border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-stone-300"
            />
          </form>
          <select
            value={status} onChange={(e) => update({ status: e.target.value, page: 1 })}
            aria-label="تصفية حسب الحالة"
            className="px-3 py-2 rounded-lg border border-stone-200 text-sm bg-white"
          >
            <option value="all">كل الحالات</option>
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 mb-4 p-3 bg-stone-900 text-white rounded-lg text-sm">
            <span>{selected.size} محدد</span>
            <div className="flex-1" />
            <button disabled={bulkActionPending} onClick={() => handleBulkStatus("active")} className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-md disabled:opacity-50">
              <CheckCircle2 size={14} /> تفعيل
            </button>
            <button disabled={bulkActionPending} onClick={() => handleBulkStatus("suspended")} className="flex items-center gap-1 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-md disabled:opacity-50">
              <Ban size={14} /> إيقاف
            </button>
          </div>
        )}

        {/* Error state */}
        {error && <ErrorBlock error={error} retry={retry} />}

        {/* Loading skeleton */}
        {isLoading && !error && (
          <div className="bg-white border border-stone-200 rounded-xl overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && result?.data.length === 0 && (
          <div className="p-10 text-center bg-white border border-stone-200 rounded-xl">
            <Users size={28} className="mx-auto mb-3 text-stone-300" />
            <p className="text-sm text-stone-500">لا يوجد تلاميذ مطابقون لهذا البحث</p>
          </div>
        )}

        {/* Desktop table */}
        {!isLoading && !error && result?.data.length > 0 && (
          <>
            <div className="hidden md:block bg-white border border-stone-200 rounded-xl overflow-hidden" role="table" aria-label="قائمة التلاميذ">
              <div className="flex items-center gap-3 p-3 border-b border-stone-200 bg-stone-50" role="row">
                <input type="checkbox" checked={selected.size === result.data.length} onChange={toggleSelectAll} aria-label="تحديد الكل" />
                {columns.map((col) => (
                  <div key={col.key} className="flex-1" role="columnheader">
                    <SortableHeader label={col.label} column={col.key} currentColumn={sortColumn} currentDir={sortDir} onSort={handleSort} />
                  </div>
                ))}
                <div className="w-20" role="columnheader"><span className="text-xs font-semibold text-stone-500">إجراءات</span></div>
              </div>

              {result.data.map((student) => (
                <div key={student.user_id} tabIndex={0} role="row" className="flex items-center gap-3 p-3 border-b border-stone-100 last:border-0 hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-stone-300">
                  <input type="checkbox" checked={selected.has(student.user_id)} onChange={() => toggleSelect(student.user_id)} aria-label={`تحديد ${student.full_name}`} />
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{student.full_name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full shrink-0" style={{ color: STATUS_META[student.status].color, backgroundColor: STATUS_META[student.status].bg }}>
                      {STATUS_META[student.status].label}
                    </span>
                  </div>
                  <div className="flex-1 text-sm text-stone-500">{student.enrollment_date}</div>
                  <div className="flex-1 text-sm text-stone-500">{student.exam_average ?? "—"}%</div>
                  <div className="flex-1 text-sm text-stone-500">{student.latest_readiness_score ?? "—"}</div>
                  <div className="flex-1 text-sm text-stone-500">{student.pending_grading_count}</div>
                  <div className="w-20 flex items-center gap-1">
                    <a href={`/students/${student.user_id}`} aria-label={`عرض ملف ${student.full_name}`} className="p-1.5 hover:bg-stone-100 rounded-md text-stone-500 focus-visible:ring-2 focus-visible:ring-stone-400">
                      <Eye size={14} />
                    </a>
                    <button aria-label="مزيد من الإجراءات" className="p-1.5 hover:bg-stone-100 rounded-md text-stone-400 focus-visible:ring-2 focus-visible:ring-stone-400">
                      <MoreVertical size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {result.data.map((student) => (
                <div key={student.user_id} className="bg-white border border-stone-200 rounded-xl p-3.5">
                  <div className="flex items-center gap-2 mb-2">
                    <input type="checkbox" checked={selected.has(student.user_id)} onChange={() => toggleSelect(student.user_id)} aria-label={`تحديد ${student.full_name}`} />
                    <span className="text-sm font-medium flex-1">{student.full_name}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ color: STATUS_META[student.status].color, backgroundColor: STATUS_META[student.status].bg }}>
                      {STATUS_META[student.status].label}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-stone-500 mb-2">
                    <span>الاختبارات: {student.exam_average ?? "—"}%</span>
                    <span>الجاهزية: {student.latest_readiness_score ?? "—"}</span>
                    <span>للتصحيح: {student.pending_grading_count}</span>
                  </div>
                  <a href={`/students/${student.user_id}`} className="text-xs text-stone-900 font-medium flex items-center gap-1">
                    <Eye size={12} /> عرض الملف
                  </a>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 text-sm">
              <span className="text-stone-500">صفحة {result.page} من {result.totalPages || 1}</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => update({ page: page - 1 })} className="px-3 py-1.5 rounded-lg border border-stone-200 disabled:opacity-40">السابق</button>
                <button disabled={page >= result.totalPages} onClick={() => update({ page: page + 1 })} className="px-3 py-1.5 rounded-lg border border-stone-200 disabled:opacity-40">التالي</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
