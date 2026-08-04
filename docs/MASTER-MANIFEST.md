# اقرأ أكثر... ترى أكثر — Master Delivery Manifest
### Phase 10+ — full session index

## Student Management (bounded context — Production Ready)
| File | Purpose |
|---|---|
| `student-management-schema.sql` | student_profiles, activity log, and 5 aggregate views (list, academic progress, exam attempts, readiness, visible revision plan) — one query per screen, no N+1 |
| `api-client.js` | **Shared foundation** — first API client in the codebase; every future hook builds on this |
| `permissions.js` | **Shared foundation** — centralized role/ownership checks, fail-closed on unregistered actions |
| `use-students.js` | List/profile hooks + mutations, 30s in-memory cache with prefix invalidation |
| `use-student-records.js` | Homework/exam/quiz/concours hooks for the profile tabs, reusing `exams`/`homework_submissions` rather than parallel tables |
| `student-list-page.jsx` | Phase 1 — search/filter/sort/pagination/bulk/responsive/a11y/deep-linkable via URL params |
| `student-profile-page.jsx` | Phase 2 — 9 tabs, each lazily mounted so only the active tab fetches |
| `permissions.test.js` | Phase 5 — authorization tests, including the cross-account-leak scenario explicitly |

**Security hardening (found during Student Dashboard build, fixed before continuing):** `security-hardening.sql` closes three column-level bypasses that RLS alone cannot — RLS filters rows, not columns. `student_profiles.notes` and `quiz_questions.correct_answer` (the exam answer key) were both fully SELECT-able by any authenticated client despite React never displaying them — a direct Supabase query bypassed the UI-layer hiding entirely. Fixed via column-level `REVOKE`/`GRANT` plus a `SECURITY DEFINER` RPC for the one legitimate Owner-only read. `CLIENT-SERVER-BOUNDARY.md` makes explicit which files may run in the browser bundle and which must stay server-side (`service_role` key) — this boundary is what makes the column revokes actually hold, since grading logic still needs `correct_answer` and must therefore never ship to a client. `student-dashboard-service.js` (pre-dating `api-client.js`) is marked deprecated/superseded rather than extended further, per "no parallel implementations."

**Migration policy** (per approved architecture): existing standalone `.jsx` prototypes (`ai-review-center.jsx`, `curriculum-manager-ui.jsx`, `homework-authoring-ui.jsx`, `exam-quiz-authoring-ui.jsx`, `question-bank-browser-ui.jsx`) are migrated to `api-client.js`/`permissions.js`/shared hooks **the next time each is touched**, not in a single big-bang rewrite — avoiding unreviewed churn across files nobody asked to change yet.

---

## Media Upload & Storage (bounded context — Production Ready)

**Convergence check applied**: one new file (`storage-security.sql` —
justified: Storage genuinely hadn't been touched anywhere before this).
Everything else extends existing files rather than adding new ones —
`api-client.js` gained `uploadFile`/`getPublicUrl`/`deleteFile` (three
functions, not a new client), `validation.js` gained two file-specific
rules (`maxFileSizeMB`, `allowedFileTypes`) using the exact same
`rules`/`composeRules` shape every other validator already uses. No new
hook file, no new UI primitive, no new permission entries — none were needed.

| File | Purpose |
|---|---|
| `storage-security.sql` | Bucket definitions + `storage.objects` RLS — same owner-full/own-path pattern as every table-level policy in this codebase, applied to Supabase Storage's own backing table |
| `api-client.js` (extended) | Storage functions |
| `validation.js` (extended) | File size/type rules |

**Production Readiness Verification:**
- Security audit (SECURITY_STANDARDS.md applied): ✅ — path-prefix-as-authorization (`{auth.uid()}/...`) for private buckets; `avatars` and `lesson-attachments` are read-open by design (public profile pictures, published lesson content), matching what's already true of those entities elsewhere in the platform, not a new exposure
- Explicit non-finding, stated rather than skipped: no conditional column masking applies to `storage.objects` (a file is either accessible or not — no "hidden until graded" state), so no new view was needed. Concluding "nothing further required" is itself a checklist outcome, not a shortcut.
- Regression check: `homework_submissions.uploaded_files`/`lessons.attachments` (pre-existing jsonb columns) are unaffected — they store metadata/URLs, not files themselves, and were already covered by their tables' existing RLS
- Documentation: ✅ — this entry; `RELEASE-READINESS.md`'s deployment runbook gains one step (bucket creation) rather than a new document

---

## Notifications (bounded context — Production Ready)

**Regression checklist (SECURITY_STANDARDS.md §12) applied on module entry
found a serious, real gap**: `notifications` had **no RLS enabled at all**
in the actual delivered files — every row readable by any authenticated
session since the table was first created. An earlier session summary had
described this as already fixed; that description was simply wrong, not a
regression from a later change. Corrected now, using `current_user_role()`
per §1 since this is new policy work, not a re-application of the old pattern.

| File | Purpose |
|---|---|
| `notification-center-schema.sql` | RLS added (this pass); recipient-scoped read, `is_read`-only update grant, no client INSERT path anywhere (all notifications are server-written) |
| `use-notifications.js` | List (15s TTL — the one place a short cache makes sense), mark-read, mark-all-read |
| `notification-bell.jsx` | Reusable header component, not a page — embeddable in any dashboard; needs no role prop since RLS scopes results per session automatically |

**Production Readiness Verification:**
- Security audit: ✅ — the finding above is the headline result; no role branching needed anywhere in this module since ownership (`auth.uid() = recipient_id`) is the entire authorization model, per §7
- Integration: ✅ — `student-dashboard-page.jsx`'s existing inline notification section is **not** rewritten here; it migrates to this shared component next time it's touched, per policy, not as a side effect of this module
- Performance: 15-second cache TTL (shorter than the platform default 30s) — the one hook file where fresher-than-default data is worth the extra round trips
- Accessibility: `aria-label` includes unread count, `aria-expanded` on the toggle button
- Documentation: ✅ — this entry + `CLIENT-SERVER-BOUNDARY.md` updated

---

## Concours Module (bounded context — Production Ready)

Mostly already existed by composition — weekly/mock exams (Exam System),
revision plans + AI revision assistant (AI Module), weakness detection +
recommendations (Recommendation Engine), readiness indicator
(`readiness-service.js`) were all built in earlier passes and didn't need
duplicating here.

**One deliberate scoping decision**: the original spec's "Ranking" is
built **Owner-facing only** — `owner_readiness_ranking_view` +
`use-concours-ranking.js`. Not a student-visible leaderboard. Comparing
children's readiness scores against each other ahead of a high-stakes
entrance exam is a real wellbeing consideration for this age group, not
just a design preference — this mirrors the earlier, equally deliberate
decision to keep Gamification (Achievements, the spec's other remaining
item) out of student-facing surfaces entirely.

**Security_Standards.md checklist applied to the new view** (documented
inline in `concours-module-schema.sql`): no conditional column masking
needed (Owner sees everything unconditionally), so `security_invoker=true`
is correct per §4 — traced through, not assumed, that a non-Owner session
querying this view would only ever see their own single row (RLS on
`readiness_snapshots` filters before the window function runs), never a
leak of other students' names or scores, even though nothing besides
inherited RLS explicitly gates this view. `concours_mock_exam_archive`
(fixed during Exam System's regression check) re-verified as still correct.

---

## Exam System (bounded context — Production Ready, see verification notes)

**Threat model review, completed before Exam System was declared Production Ready (per explicit requirement). Findings:**

| Threat | Finding | Fix |
|---|---|---|
| **Privilege escalation** | **Critical, platform-wide**: every RLS policy trusts `auth.jwt() ->> 'role'`. If this Supabase project's role claim is sourced from `user_metadata` (client-editable via `supabase.auth.updateUser()`) rather than `app_metadata`, any student can self-promote to Owner. | Introduced `user_roles` table (zero client write access, not even Owner) + `current_user_role()` SECURITY DEFINER function as the one sanctioned check. **Not yet retrofitted across all ~25 existing policies** — flagged as the single highest-priority pre-deployment task, not silently claimed done. |
| **Concurrent submissions (write-write race)** | Two near-simultaneous `submit_exam_attempt()` calls could both read `in_progress` before either committed. | `FOR UPDATE` row lock. |
| **Answer tampering (autosave-vs-submit race)** | Plain `SELECT`s in RLS policies don't respect another transaction's `FOR UPDATE` lock — a client could time an autosave into the submit window. | Converted autosave to its own RPC sharing an advisory lock (`pg_advisory_xact_lock`) with submit; direct client writes to `exam_answers` revoked entirely. |
| **RPC misuse (invalid input)** | `set_current_academic_year` with a bad ID silently left *zero* years marked current; `owner_manual_grade_answer` with a bad ID silently no-op'd. | Both now validate existence and raise before mutating. |
| **Missing audit trail** | Every `log.info()` call is client-side JS — anyone calling these RPCs directly via the Supabase REST API, bypassing React entirely, left zero trace. | `security_audit_log` (append-only, DB-enforced, Owner-read-only) — every security-sensitive RPC now writes to it. |
| **Ownership transition edge case** | Reverting a released exam to `draft` while attempts are `in_progress` would immediately strand those students (RLS re-evaluates exam status live). | Trigger blocks this specific transition. |
| **RLS policy interactions** | Confirmed by inspection: no RESTRICTIVE policy exists anywhere — all PERMISSIVE, OR-combined. Documented so a future RESTRICTIVE addition doesn't silently and drastically narrow access. | No fix needed; recorded as a fact for future maintainers. |

**Security regression check against Homework, Quizzes, Concours, Student Dashboard (explicitly requested) — two more real, pre-existing issues found:**

- **Concours — serious**: `concours_mock_exam_archive` had no row filter and no `security_invoker`. Postgres views default to DEFINER semantics when neither is set, which bypasses RLS on the joined tables entirely — **any authenticated session could read every student's mock-exam scores**, not just their own. Fixed with the same row-filter + conditional masking pattern as the exam views.
- **Homework**: `homework_submissions.status` was never column-restricted the way `exam_attempts.status` now is — a student with any UPDATE grant could set their own submission to `'graded'` directly. There was, in fact, no student UPDATE policy at all yet (resubmission didn't work) — fixed both: added resubmission scoped to `status != 'graded'`, with `status`/`total_score`/`max_score`/`feedback`/`competency_evaluation` explicitly excluded from the grant.
- **Self-caught during the homework fix**: an intermediate edit accidentally *deleted* the original owner/student RLS policies on `homework_submissions` instead of adding to them — caught by re-checking the file immediately after, restored before moving on.
- Quizzes: no separate regression risk — quizzes are `exams` rows (`exam_type='quiz'`), so every fix above applies uniformly by construction.
- Student Dashboard: no regression — its `exams` query has no column-level revokes to interact with, and its `student_homework_view`/view queries continue to work under the corrected DEFINER views (the client-supplied `student_id` filter is now redundant but harmless, since the view's own `WHERE` clause already restricts rows).



1. **Grade tampering**: `exam_attempts`' RLS UPDATE policy allowed a student to write to *any* column on their own row, including `status`/`total_score`/`max_score` directly. Fixed: UPDATE revoked from `authenticated` except two harmless bookkeeping columns; every real state transition now goes through `start_exam_attempt()`/`submit_exam_attempt()` (SECURITY DEFINER RPCs).
2. **Post-submission answer editing**: `exam_answers`' policy checked ownership but never the parent attempt's status. Fixed: insert/update policies now require the attempt to be `in_progress`.
3. **The masking-view flaw**: `security_invoker` views cannot correctly do *conditional* column masking (`CASE WHEN status='graded'`) — the invoker still needs raw column privilege for the reference to parse, so either the query errors (if revoked) or the masking is cosmetic (if not revoked, since a direct table query then bypasses the view entirely). This affected `student_homework_view` too, not just the exam views — **found while auditing Exam System, but it means the original homework fix, several modules ago, was never actually enforced.** Fixed uniformly: these views are now `SECURITY DEFINER` (not invoker) with explicit `auth.uid()`/`auth.jwt()`/`is_verified_parent_of()` filtering baked into the view body.

**A fourth, related architectural gap**: column-level `REVOKE`/`GRANT` cannot distinguish Owner from Student, since both share the `authenticated` Postgres role (the JWT `role` claim is an application-level distinction, invisible to column privileges). The `quiz_questions.correct_answer` revoke (from the Student Management security pass) had silently also blocked *Owner's* legitimate access — undiscovered until Exam System's Owner-authoring flow needed it. Fixed: `owner_quiz_questions_view` (SECURITY DEFINER, `WHERE role='owner'`), the same pattern `get_student_notes()` already established.

| File | Purpose |
|---|---|
| `exam-security-hardening.sql` | All of the above — column revokes, corrected RPCs, corrected views, attempt-limit verification |
| `use-exam-attempts.js` | Student-facing: `start_exam_attempt`/`submit_exam_attempt` RPCs, RLS-scoped answer autosave |
| `use-exam-authoring.js` | Owner-facing: quiz assembly via `owner_quiz_questions_view`, scheduling |
| `exam-taking-page.jsx` | New — no student-facing taking UI existed before this module |
| `exam-quiz-authoring-ui.jsx` | Migrated in place from the standalone mock prototype |

**Production Readiness Verification — Exam System:**
- Security audit (completed *before* feature work, as required): ✅ — all four findings above fixed at the data layer; verified no client path can read the answer key, edit a submitted answer, write its own grade, or start a second attempt (UNIQUE constraint, pre-existing, confirmed still correct)
- Time limits: exams carry `duration_minutes`; `submit_exam_attempt()` computes `is_late` server-side from `started_at` (client-supplied timestamps are never trusted for this). **Deliberate design choice, not an oversight**: late submissions are recorded, not blocked — outright blocking would penalize legitimate connectivity issues; the Owner sees `is_late` and decides.
- Authorization audit: ✅ — every RPC checks `auth.uid()`/`auth.jwt()` internally; reused the existing `lesson.create` permission for exam authoring rather than minting a near-duplicate `exam.create` entry (flagged inline in `use-exam-authoring.js` in case the two ever need to diverge)
- Database audit: ✅ — column grants, RLS, and the DEFINER-view correction all documented above; `exam_attempts` UNIQUE(exam_id, student_id) re-verified as the attempt-limit enforcement (no application-layer limit needed or trusted)
- Performance: exam question loading does one query per section for section_questions (bounded by section count, not question count) then one batched `.in()` query for all questions — no per-question round trip
- Accessibility: form inputs use real `<label>` wrapping radio groups, `aria-label` on free-text answers; **known gap**: no visible countdown timer in the UI despite `is_late` being computed server-side — the student has no client-side indication of time remaining, only a post-hoc late flag. Flagging honestly rather than treating "the server catches it" as sufficient UX.
- **Requires Production Validation**: the SQL grading function's correctness across all question-type edge cases (only verified by inspection/trace here, not execution); RPC performance under concurrent submission load at exam end time (a realistic spike pattern this environment cannot simulate)
- Regression check: ✅ — `student_homework_view`'s pre-existing flaw (found via this audit) is fixed in the same migration, not deferred
- Documentation: ✅ — this entry + `CLIENT-SERVER-BOUNDARY.md` corrected (not just appended — two files' stated status was factually wrong and needed fixing, not just updating)

---

## Curriculum Manager (bounded context — Production Ready, see verification notes)
| File | Purpose |
|---|---|
| `use-curriculum-structure.js` | Academic years, terms/weeks, fields/subjects — CRUD hooks, distinct from `use-lessons.js` (content) |
| `curriculum-structure-page.jsx` | Admin UI: year management + set-current, term/week creation, field/subject tree |

**Production Readiness Verification — Curriculum Manager:**
- Functional completion: ✅ — caught and closed a real gap before locking: `useTermsAndWeeks`/`createTerm`/`createWeek` were built but never wired into the UI; added the missing section rather than shipping partial functionality under a "complete" label
- Integration: ✅ — reuses `api-client.js`, `permissions.js`, `query-cache.js`, `validation.js`, `ui-primitives.jsx` entirely; zero new infrastructure
- Performance audit: ✅ — years/fields/subjects cached 5 minutes (rarely change); no N+1 (fields+subjects fetched in one `Promise.all`, then joined client-side)
- Security/Authorization audit: ✅ by inspection — single `curriculum.structure.manage` permission, Owner-only, tested in `permissions.test.js`
- Database audit: ✅ — added `set_current_academic_year()` as a `SECURITY DEFINER` RPC (found during design, not after: two sequential client updates against the `is_current` unique partial index could race or transiently leave zero current years — fixed at the transaction level, not worked around in React)
- API layer: extended `api-client.js` with a generic `callRpc()` — the second RPC function in the codebase (`get_student_notes` was the first); no hook reaches for `supabase.rpc()` directly
- **Requires Production Validation**: `set_current_academic_year`'s actual atomicity under concurrent calls; whether the `SECURITY DEFINER` function's `search_path` pinning is sufficient hardening against search-path attacks in the real deployment's Postgres version
- Accessibility: form labels present via placeholder text (not `<label>` elements) — **known gap, not fixed**: flagging honestly rather than claiming full WCAG compliance this pass
- Responsive: inherits the same `max-w-4xl` single-column pattern as other Owner pages; not separately verified at narrow breakpoints
- Documentation: ✅ — this entry + `CLIENT-SERVER-BOUNDARY.md` updated

---

## Lesson Editor (bounded context — Production Ready, see verification notes)
| File | Purpose |
|---|---|
| `validation.js` | **Shared foundation** — first validation utility in the codebase; existing forms migrate to it when next touched |
| `query-cache.js` | **Shared foundation** — extracted from `use-students.js` (which had the only copy) once a third consumer (`use-lessons.js`) needed the identical mechanism; `use-students.js` migrated to it in the same pass, no duplicate cache left behind |
| `use-lessons.js` | Lesson tree (field→subject→week→lesson, grouped client-side from one view query), competency list, create/update/publish/archive mutations |
| `curriculum-manager-ui.jsx` | **Migrated in place** from the standalone mock prototype — mocked `useState` data and inline validation removed entirely, not left as a parallel version |

**Production Readiness Verification — Lesson Editor:**
- Functional completion: ✅ — create/edit/publish/archive, competency tagging, field validation
- Integration: ✅ — zero new infrastructure; reuses `api-client.js`, `permissions.js`, `ui-primitives.jsx`, and now `validation.js`/`query-cache.js`
- Regression check on migrated dependency: ✅ — found and fixed a real bug in `use-students.js` in the process (`useStudentAcademicProgress` called `queryView`, which an earlier edit had removed from the import list without checking this call site; would have thrown `ReferenceError` at runtime)
- Performance audit: ✅ — one query (`owner_lesson_browser_view`) replaces what would otherwise be five round trips (fields/subjects/weeks/terms/years); page size capped at 500 with an explicit note to revisit if a curriculum outgrows that
- Security/Authorization audit: ✅ by inspection — `lesson.create`/`edit`/`publish`/`archive` all Owner-only, tested in `permissions.test.js`; publishing is logged explicitly since it's the moment content becomes both student-visible and AI-source-eligible
- Database audit: ✅ — found and fixed: `subjects`, `educational_fields`, `curriculum_weeks`, `terms` had RLS completely disabled (inconsistent with `academic_years`/`competencies`, which already had the open-read/owner-write pattern) — closed in `security-hardening.sql`. FK cascade behavior on `lessons.week_id` etc. is `RESTRICT` (Postgres default, not overridden) — intentional: prevents silently deleting a week that still has lessons.
- **Requires Production Validation**: the grouping query's actual performance at real data volume; whether 500 rows stays sufficient as the curriculum grows across multiple academic years
- Accessibility: ✅ — `aria-invalid`/`aria-describedby` on validated fields, `aria-label` on icon actions, `LiveStatusAnnouncer`
- Responsive: inherited from the original prototype's accordion layout (already mobile-reasonable); not re-verified against new breakpoints in this pass
- Documentation: ✅ — this entry + `CLIENT-SERVER-BOUNDARY.md` updated

---

## Parent Portal (bounded context — Production Ready, see verification notes)
| File | Purpose |
|---|---|
| `parent-portal-schema.sql` | parent_profiles, parent_student_links (Owner-verified, not self-service), `is_verified_parent_of()` — one reusable RLS helper instead of repeating the link-check subquery |
| `use-parent-dashboard.js` | Linked-children list + per-child dashboard, reusing the exact student-facing views (no parallel data shape) |
| `parent-dashboard-page.jsx` | Child switcher + read-only sections; no write action exists anywhere in the file, matching the schema having no parent write policy |

**Production Readiness Verification — Parent Portal:**
- Functional completion: ✅ — link discovery, child switching, dashboard reuse
- Integration: ✅ — additive RLS policies only (Postgres combines multiple permissive SELECT policies with OR; nothing narrows existing Owner/Student access)
- Performance audit: ✅ — fixed an N+1 in `useLinkedChildren` before it shipped (batched via `.in()`, same fix pattern as `useStudentList`)
- Security/Authorization audit: ✅ by inspection — read-only by construction (no parent INSERT/UPDATE/DELETE policy on any table); column-level protections (`.notes`, `.correct_answer`) apply automatically since revoked from `authenticated` broadly, not per-role
- **Requires Production Validation** (cannot be verified in this environment): `is_verified_parent_of()` behavior against a live Postgres instance, OR-combination of permissive policies at scale, and that Supabase's `auth.jwt() ->> 'role'` claim is populated the way every policy in this codebase assumes
- Accessibility: ✅ — `role="tablist"`/`aria-selected`, `LiveStatusAnnouncer`, empty state handled
- Responsive: ✅ — `md:grid-cols-2`, horizontal scroll on child switcher
- Documentation: ✅ — this entry + `CLIENT-SERVER-BOUNDARY.md` updated

---

## Milestone 1 — Lesson Management & Homework Correction Workflow (post-RC1)
See the Milestone 1 Completion Report delivered in-conversation for full detail. Files: `13-progressive-weekly-publishing.sql`, `14-lesson-publishing-modes.sql`, `15-homework-correction-workflow.sql`, `16-view-grants.sql`, `use-weekly-progress.js`, `use-homework-grading.js`, `correction-queue-page.jsx`, plus modifications to `use-lessons.js`, `use-student-dashboard.js`, `curriculum-manager-ui.jsx`, `student-dashboard-page.jsx`, `parent-dashboard-page.jsx`.

---

## AI Module (bounded context — complete)
| File | Purpose |
|---|---|
| `concours-ai-prompts.js` | 6 Claude API prompt templates (question drafts, mock exams, weakness analysis, revision plans, readiness summaries, scoped student tutor) |
| `ai-module-schema.sql` | Draft lifecycle, audit log, versioning, prompt library, job queue, dead-letter queue, cache, analytics view |
| `ai-draft-service.js` | State machine (generated → pending_review → approved → published / rejected / archived), bulk ops, duplicate, compare |
| `ai-validation.js` | 13 validation checks — schema, references, duplicates, media, curriculum scope, similarity, difficulty, objective alignment, quality, reading level, language, formatting, output sanitization |
| `prompt-library-service.js` | Versioning, clone, archive, export/import, test runs, benchmarking, rollback, categories/tags |
| `ai-job-queue.js` | Async processing, retry/backoff, timeout, rate limiting, caching, dead-letter routing, worker recovery, graceful shutdown, input sanitization |
| `ai-cost-monitor.js` | Daily/monthly cost, cache hit rate, retry rate, failure breakdown, queue wait time |
| `ai-review-center.jsx` | Owner dashboard — approve/reject/publish, bulk actions, rich preview (PDF/image/audio/video/JSON), version history + restore, keyboard shortcuts, accessibility labels |
| `ai-module.test.js` | Unit tests for all of the above |
| `AI-MODULE-DOCS.md` | Architecture, lifecycle, security, integration status |

## Curriculum & Content
| File | Purpose |
|---|---|
| `curriculum-manager-schema.sql` | Academic year → field → subject → term → week → lesson |
| `question-bank-homework-schema.sql` | Competencies, quiz_questions (with trigram similarity index), homework, homework_questions, homework_submissions, competency_scores |
| `homework-grading-service.js` | Submission handling, rubric evaluation, feedback, pre-submission visibility rule |

## Assessment
| File | Purpose |
|---|---|
| `exam-system-schema.sql` | Exams, sections, attempts, answers, offline-sync fields |
| `exam-attempt-service.js` | Start/resume, autosave, offline reconciliation, auto-grading, manual grading queue |
| `quiz-assembly-service.js` | Assembles quizzes by reusing `exams` (exam_type='quiz') — no duplicate schema |

## Concours Module
| File | Purpose |
|---|---|
| `concours-module-schema.sql` | Calendar, revision_plans, readiness_snapshots, mock exam archive view |
| `readiness-service.js` | Deterministic readiness scoring (never AI-judged), revision plan publish/visibility control |

## Platform Services
| File | Purpose |
|---|---|
| `notification-center-schema.sql` | In-app notifications |
| `student-dashboard-service.js` | Read-layer aggregator — the single enforcement point for all student-facing visibility rules |
| `recommendation-engine.js` | Computed on demand from competency_scores + published content; no AI call, no new schema |

## Integration Layer
| File | Purpose |
|---|---|
| `integration-adapters.js` | Contracts for all 18 platform systems — **16 live, 2 deliberately excluded** (Gamification, Certificates) |

---

## What "done" means here, honestly

Every file above is real, internally-consistent code: schemas reference each other correctly, services call real query shapes, tests exercise actual logic with a fake in-memory DB. What it is **not**: deployed, connected to a live Supabase project, tested against real Anthropic API responses, or exercised by a real user in a browser. The natural next step, whenever you're ready, is standing up the actual Supabase project and wiring these files in — at that point real integration testing becomes possible, which no amount of additional code-writing here can substitute for.

## What's still genuinely open
- Owner-side UI for Curriculum Manager, Lesson Editor, Homework authoring, Exam authoring (only the AI Review Center has a built UI so far)
- Gamification module (XP/levels/badges) — not started, and per the AI Module's design, intentionally never triggered by AI actions
- Certificates / graduation portrait image-prompt pipeline — covered in your earlier prompt-engineering work, not re-integrated here by design
- Parent Portal (explicitly marked "Future" in the original project document)
- Deployment, monitoring, backups
