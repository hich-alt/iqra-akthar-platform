# RC1 → Grade 6 Refocus: Audit Report
### Analysis only. No code changed. Every claim below was checked against actual files this session, not recalled from memory.

## 1. Modules to KEEP (as-is, or near-as-is)
- **Student Management** — student list/profile, RLS, permissions. Directly needed.
- **Notifications infrastructure** (table, RLS, hooks, bell UI) — the *pipe* is right; see §5 for what's missing.
- **Media Upload & Storage** — PDF/image/multi-file upload already supports the notebook-photo and correction-PDF workflow structurally.
- **Parent Portal** (read-only model) — matches "Parents never edit educational content" exactly, already enforced at the RLS layer, not just the UI.
- **AI Module's underlying safety architecture** (draft queue, Owner approval gate) — even if AI generation itself goes unused in v1.0, the review/approval pattern this module established is reused by nothing else, so keep the code; see §3 for why it should be *hidden*.
- **Shared architecture** (`api-client.js`, `permissions.js`, `validation.js`, `query-cache.js`, `SECURITY_STANDARDS.md`) — foundation-level, applies regardless of product scope.

## 2. Modules to MODIFY
| Module | What's missing, verified | Why |
|---|---|---|
| **Curriculum Manager** | `subjects` table has no `is_active` column. Nothing filters "only Arabic/Math/Science visible" anywhere. | New vision requires other subjects to exist in the DB but be hidden from UI — currently there's no mechanism to hide one at all. |
| **Lesson Editor** | `lessons` table has no `objectives`, no `submission_deadline`, no `teacher_notes` (distinct from `content_body`), no `correction_pdf_url`, and no direct link to a `homework` row. | New vision's lesson = objectives + PDF + homework instructions + deadline + correction, as one authored unit. Currently `lessons` and `homework` are only loosely related (both reference a competency, not each other). |
| **Exam System** | `exams.scheduled_end` **exists but is never enforced anywhere** — confirmed by searching every file; it's stored and displayed, never checked. `start_exam_attempt()` currently only checks `status in ('scheduled','active')`, not the actual time window. No separate "opening time" distinct from "scheduled_start" either. | New vision explicitly requires "No access outside the allowed period" — this is currently not true, even though the schema looks like it should be. |
| **Reports & Analytics** | Currently surfaces exam averages, readiness distribution, competency heatmap — no "students who need intervention" or "participation rate" view specifically. | Vision's analytics list is narrower and more specific than what exists; mostly composable from existing data, not missing data. |
| **Owner/Teacher Dashboard** | Doesn't exist as a single page. `student-list-page.jsx`, `curriculum-structure-page.jsx`, `reports-analytics-page.jsx`, `ai-review-center.jsx` are separate pages Owner navigates between. | Vision wants one dashboard: pending corrections, non-submitters, today's notifications, quick-publish — this is a composition task over existing hooks, not new data. |

## 3. Modules to DISABLE (hide from UI, keep in DB/code — per your "do not delete" instruction)
- **Concours Module** (readiness scoring, revision plans, mock-concours archive, ranking) — the new vision document doesn't mention concours/entrance-exam prep anywhere. This was built for a different scope (exam preparation for the model-school entrance exam) that the refocused v1.0 doesn't describe. Recommend: hide from Student/Parent/Owner UI, keep all tables and RPCs intact.
- **AI Module's generation UI** (`ai-review-center.jsx`, the "generate AI question draft" actions) — the new vision never mentions AI-assisted content generation. Recommend: hide the Review Center from the Owner UI; keep the underlying draft-queue/approval architecture, since disabling ≠ deleting and it may return in a later version.
- **Non-active subjects** (everything except Arabic, Math, Science) — per your explicit instruction: exists in DB, hidden in UI, once §2's `is_active` flag is added.

## 4. Modules to REMOVE
**None.** Nothing in RC1 conflicts with the new vision badly enough to warrant deletion — "disable and hide" covers every case found. Recommending removal would also contradict your own instruction to preserve extensibility.

## 5. Missing Educational Features (the real gap list)
1. **Automatic notification triggers.** Confirmed by search: nothing in the entire codebase currently calls `insert into notifications` or an equivalent for *any* real event — not homework submission, not grading, not exam scheduling. The table, RLS, and read-side hooks exist; the write-side triggers for the ~20 notification types your vision lists do not. This is the single largest gap between RC1 and this vision.
2. **Lesson↔Homework coupling.** Currently two loosely-related tables; vision wants one authored unit (lesson with embedded homework instructions/deadline/correction).
3. **Exam time-window enforcement** (§2, Exam System row) — a real, verified gap, not a hypothetical.
4. **Correction PDF as a first-class field** on both lessons and homework submissions — currently would have to be jammed into the generic `attachments`/`uploaded_files` jsonb without a clear "this one is the teacher's correction" marker.
5. **Subject enable/disable flag** (§2, Curriculum Manager row).
6. **Unified Teacher Dashboard** (§2) — composition, not new data, but currently doesn't exist as a page.
7. **"Student inactive" / "non-submitter" detection** — no existing query computes "which students have NOT submitted homework X" as a first-class, reusable thing; would need to be built (likely a straightforward `NOT IN` against `homework_submissions`, but doesn't exist yet).

## 6. Database Impact
- `subjects`: add `is_active boolean not null default true`.
- `lessons`: add `objectives text`, `teacher_notes text`, `submission_deadline timestamptz`, `correction_pdf_url text`, `homework_id uuid references homework(id)`.
- `exams`: add `opening_at timestamptz` (distinct from `scheduled_start`, if "publication date" and "opening date" need to differ per your spec — worth confirming with you whether these are meant to be the same or different).
- `notification_type` enum: expand from 6 values to roughly 20, matching your Teacher/Student/Parent lists exactly.
- New: a set of SECURITY DEFINER functions or triggers that *fire* notifications on the real events (homework submitted, graded, exam scheduled, etc.) — this is genuinely new work, not a modification.
- Every new SQL object still needs the `SECURITY_STANDARDS.md` checklist applied (RLS, `security_invoker` correctness, column privileges) — no exceptions for this being a "product" change rather than a "platform" change.

## 7. API Impact
- `use-lessons.js`, `use-curriculum-structure.js` need new fields wired through (mutations + reads).
- `use-exam-attempts.js`'s `start_exam_attempt()` RPC needs the time-window check added — a real code change to a Mission Critical function, requiring re-applying the full threat-model discipline, not just a field addition.
- New: a notification-triggering layer — likely as additional logic inside existing RPCs/functions (e.g., `submit_exam_attempt` also inserts a "teacher: exam submitted" notification) rather than a separate service, per "no duplicated business logic."

## 8. UI Impact
- Subject pickers (Lesson Editor, Curriculum Structure, Homework authoring) need an active-subjects-only filter.
- Student/Parent/Teacher dashboards need re-composition per the vision's specific "shows ONLY..." lists — mostly hiding sections that exist, not building new ones, except the unified Teacher Dashboard.
- Concours- and AI-generation-related UI needs hiding (navigation entries, not code deletion).

## 9. Security Impact
- No weakening required or implied by anything above — every addition is additive (new columns, new enum values, new notification triggers) and must independently pass `SECURITY_STANDARDS.md`, same as every prior module.
- The exam time-window fix is a *security tightening*, not a loosening — currently exams are more permissive than intended.
- Notification triggers need care: they must not leak data across roles (e.g., a "teacher: homework submitted" notification must not be readable by other students) — the existing `recipient_id`-scoped RLS already handles this correctly as long as new triggers set `recipient_id` properly.

## 10. Migration Roadmap (proposed, awaiting your approval)
1. Finish the current deployment (Step 2e verification, then the 13 migration files) — unrelated to this refocus, already in progress.
2. Add the DB changes in §6 as new, clearly-numbered migration files (not edits to already-shipped files, since RC1 is meant to be immutable history).
3. Build the notification-trigger layer — the biggest real chunk of new work.
4. Add the exam time-window enforcement fix — treated as a Mission Critical change, full threat-model checklist reapplied.
5. Add lesson↔homework coupling fields + UI.
6. Build the unified Teacher Dashboard (composition).
7. Hide Concours + AI-generation UI; add subject `is_active` filtering.
8. Re-run the full regression/convergence audit before calling this v1.1 (or whatever version number you want to assign a scoped product change like this).

**Waiting for your approval before any of the above is implemented**, per your instruction.
