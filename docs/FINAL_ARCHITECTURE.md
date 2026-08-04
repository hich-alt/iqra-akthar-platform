# Final Architecture
### اقرأ أكثر... ترى أكثر — as of Release Candidate 1

## Layers

```
┌─────────────────────────────────────────────────────────┐
│ REACT PAGES (.jsx)                                        │
│ student-list-page, student-profile-page, student-         │
│ dashboard-page, parent-dashboard-page, curriculum-         │
│ manager-ui, curriculum-structure-page, exam-quiz-          │
│ authoring-ui, exam-taking-page, reports-analytics-page,    │
│ notification-bell, ai-review-center*, homework-            │
│ authoring-ui*, question-bank-browser-ui*                   │
│ (* = still standalone prototypes, migrate when touched)    │
├─────────────────────────────────────────────────────────┤
│ HOOKS (use-*.js)                                           │
│ use-students, use-student-records, use-student-dashboard,  │
│ use-parent-dashboard, use-lessons, use-curriculum-          │
│ structure, use-exam-attempts, use-exam-authoring,           │
│ use-concours-ranking, use-notifications, use-platform-      │
│ reports                                                     │
├─────────────────────────────────────────────────────────┤
│ SHARED INFRASTRUCTURE                                      │
│ api-client.js (Supabase client + generic query/RPC/storage │
│   functions — the ONLY file holding a Supabase instance)    │
│ permissions.js (UX-layer only — one table, `can()`)         │
│ validation.js (form rules)                                  │
│ query-cache.js (30s TTL, prefix-invalidated)                │
│ use-async.js (fetch/loading/error state, unmount-safe)      │
│ logger.js (client-side, non-authoritative)                  │
│ ui-primitives.jsx (Skeleton, ErrorBlock, EmptyState,         │
│   LiveStatusAnnouncer)                                       │
├─────────────────────────────────────────────────────────┤
│ AUTHORITATIVE DATA LAYER (Postgres/Supabase)                │
│ RLS on every table · SECURITY DEFINER RPCs for anything      │
│ RLS can't atomically enforce · column-level GRANT/REVOKE     │
│ for per-field secrecy · current_user_role() as the sole      │
│ role-trust boundary · security_audit_log as the durable      │
│ record of every sensitive RPC call                            │
├─────────────────────────────────────────────────────────┤
│ SERVER-SIDE ONLY (service_role, never bundled to browser)   │
│ ai-draft-service, ai-validation, ai-job-queue, prompt-       │
│ library-service, ai-cost-monitor, readiness-service,         │
│ recommendation-engine, integration-adapters                  │
│ (exam-attempt-service.js and quiz-assembly-service.js are    │
│  REFERENCE implementations — the enforced versions are SQL   │
│  RPCs / owner_quiz_questions_view; see CLIENT-SERVER-        │
│  BOUNDARY.md)                                                 │
└─────────────────────────────────────────────────────────┘
```

## Bounded Contexts (all Production Ready)

AI Module · Student Management · Student Dashboard · Parent Portal ·
Lesson Editor · Curriculum Manager · Exam System (Mission Critical —
full threat model) · Concours Module · Notifications · Media Upload &
Storage · Reports & Analytics

## The Security Model, End to End

1. A request originates from a React page, through a hook, through `api-client.js`.
2. **RLS decides which rows** a query can touch — every table, no exceptions, verified at Exam System's audit and the platform-wide regression check that followed.
3. **Column GRANT/REVOKE decides which fields** within a permitted row are visible — used for `student_profiles.notes`, `quiz_questions.correct_answer`/`.rationale`, `homework_submissions.{feedback,total_score,max_score,competency_evaluation}`, `exam_attempts.{total_score,max_score}`, `exam_answers.{is_correct,points_awarded}`.
4. **Views mask conditionally** (e.g. "hide the score until graded") — and MUST be `SECURITY DEFINER` with an explicit `WHERE` clause when they do, never `security_invoker` (see `SECURITY_STANDARDS.md` §4 — this exact mistake recurred three times before becoming a documented rule).
5. **RPCs are the only path** for any write that needs to cross a column-privilege boundary (grading, current-year switching, manual grading) or that needs cross-function serialization (advisory locks, `submit_exam_attempt`/`autosave_exam_answer`).
6. **`current_user_role()`**, not the raw JWT claim, is what every policy and RPC checks — migrated platform-wide, verified by `grep` returning zero remaining occurrences of the old pattern outside comments.
7. **`security_audit_log`** durably records every security-sensitive RPC call, independent of whether the client that triggered it went through React or called the API directly.

## Known, Documented, Accepted Gaps at RC1

- 7 of 11 hook files don't use `query-cache.js` (performance inconsistency, not correctness/security).
- `prompt_success_rates` (AI Module view) is dead code — superseded by JS-side computation in `prompt-library-service.js`.
- 3 standalone prototype pages (`ai-review-center.jsx`, `homework-authoring-ui.jsx`, `question-bank-browser-ui.jsx`) haven't been migrated to the shared hook architecture yet — migrate when next touched, per policy.
- No real E2E test execution has occurred anywhere in this project — this environment has no live Supabase instance or browser to run one in. Critical flows are identified in `PRODUCTION_VALIDATION.md`; running them is a deployment-time activity.
- Role assignment (`user_roles`) has zero client write path by design — it must be populated via `service_role`/Admin API as part of account provisioning, not automatically at signup. See `DEPLOYMENT_CHECKLIST.md`.
