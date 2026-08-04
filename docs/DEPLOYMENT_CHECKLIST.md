# Deployment Checklist
### اقرأ أكثر... ترى أكثر — Release Candidate 1

## 1. Supabase project
- [ ] Create project.
- [ ] Confirm `users` table strategy: `auth.users` directly, or a mirrored `public.users` — every schema file assumes `references users(id)`; adjust if using `auth.users` directly.

## 2. Run migrations in this exact order
```
0.  00-users-bootstrap.sql          (GAP found during production validation —
                                      not originally in RC1; every other file
                                      assumes this table already exists)
1.  ai-module-schema.sql
2.  question-bank-homework-schema.sql
3.  curriculum-manager-schema.sql
4.  exam-system-schema.sql
5.  student-management-schema.sql
6.  parent-portal-schema.sql
7.  concours-module-schema.sql
8.  notification-center-schema.sql
9.  security-hardening.sql        (defines user_roles + current_user_role())
10. exam-security-hardening.sql
11. exam-threat-model-fixes.sql
12. storage-security.sql
13. 13-progressive-weekly-publishing.sql   (lesson lifecycle: draft/scheduled/published/closed/archived)
14. 14-lesson-publishing-modes.sql         (shared publish transition, manual + automatic)
15. 15-homework-correction-workflow.sql    (grading RPC, correction PDF, teacher correction queue views)
16. 16-view-grants.sql                     (explicit SELECT grants for all 18 views — see below)
17. 17-owner-lesson-view-fields.sql        (extends owner_lesson_browser_view: publish_date, homework_deadline)
18. 18-current-lesson-subject-name.sql     (extends student_current_lesson_view: subject_name)
```
- [ ] Each file runs without error, in this order, on a clean database.

**Critical, found during Milestone 1**: no view anywhere in this platform had an explicit `GRANT SELECT` to `authenticated`. Postgres does not give implicit access to a new view. File 16 fixes this — without it, every `listResource`/`queryView` call against any view in the app would likely fail with a permission error. This does not change any view's row/column-level security, only whether it's reachable at all.

**Also new in this milestone**: `process_lesson_lifecycle_transitions()` needs `pg_cron` scheduled — see §6a below.
- [ ] `Requires Production Validation`: this is the first time this exact 12-file sequence has been executed anywhere — no live run has occurred in this session.

## 3. Custom access token hook (CRITICAL — do not skip)
- [ ] Configure Supabase Auth's custom access token hook, OR ensure your account-provisioning flow otherwise ensures the JWT reflects the correct role.
- [ ] **This is now less critical than it would have been**: since every policy uses `current_user_role()` (reads `user_roles`, not the JWT), a misconfigured JWT claim no longer causes a privilege-escalation bug the way it would have pre-migration. It still matters for anything outside this codebase's own policies that might read the JWT claim directly (e.g. a future Edge Function).

## 4. Populate `user_roles` for every account
- [ ] `user_roles` has **zero client write access** — not even Owner. Every account (Owner, each student, each parent) needs a row inserted via the `service_role` key or Supabase Admin API as part of provisioning.
- [ ] Recommended: a small provisioning script run once during initial setup, and again whenever a new student/parent account is created — this is now a required manual/scripted step, not automatic.

## 5. Storage buckets
- [ ] Confirm `storage-security.sql`'s bucket inserts succeeded: `homework-uploads` (private), `lesson-attachments` (private), `avatars` (public).
- [ ] Test upload as a student session: confirm a file at `{other_student_id}/...` is rejected, and `{own_id}/...` succeeds.

## 6. Anthropic API integration
- [ ] Set the Anthropic API key as a server-side secret (never exposed to the client) for whatever runs `ai-job-queue.js`'s worker loop.
- [ ] Deploy `ai-job-queue.js`'s `processNext()` on a schedule (Supabase Edge Function + cron, every 10–30s).
- [ ] Call `recoverStuckJobs()` once on worker cold-start.
- [ ] Set a spend limit/alert on the Anthropic account — the cost-monitoring code (`ai-cost-monitor.js`) observes spend, it does not cap it.

## 6a. Lesson lifecycle background job (new, post-RC1)
- [ ] Enable the `pg_cron` extension: Supabase dashboard → Database → Extensions → search "pg_cron" → Enable.
- [ ] Schedule the job: `select cron.schedule('lesson-lifecycle', '*/2 * * * *', 'select process_lesson_lifecycle_transitions();');` — run this once in the SQL Editor after `13-progressive-weekly-publishing.sql` completes.
- [ ] If `pg_cron` isn't available on your Supabase plan: deploy an external scheduled Edge Function calling `process_lesson_lifecycle_transitions()` via the `service_role` key every 1–5 minutes instead — this RPC has no `authenticated` execute grant at all, by design, so it cannot be called from the browser under any circumstance.
- [ ] Without this job running, lessons will never transition from Scheduled to Published or from Published to Closed, regardless of dates set — this is the actual enforcement mechanism, not a convenience feature.

## 7. RLS smoke test (do this manually, with two real test accounts)
- [ ] A student account cannot read another student's `student_profiles` row, `homework_submissions`, `exam_attempts`, or `competency_scores`.
- [ ] A student account querying `quiz_questions` directly (not through `quiz_questions_safe_view`) gets a column-privilege error, not data.
- [ ] A student cannot set their own `exam_attempts.status` to `'graded'` via a direct API call.
- [ ] A parent account only sees data for students with a `verified = true` row in `parent_student_links`.
- [ ] An unverified parent link (`verified = false`) grants zero access — confirm by toggling the flag and re-querying.

## 8. Full manual walkthrough (the one true end-to-end test this session couldn't run)
- [ ] Owner publishes a lesson.
- [ ] Owner generates an AI question draft from it, approves it.
- [ ] Owner assembles a quiz from the approved question(s).
- [ ] A test student account takes the quiz: autosave works, submission grades automatically, `is_late` is correctly false.
- [ ] Competency score updates; AI weakness analysis reflects it on next generation.
- [ ] A test parent account (linked + verified) sees the same quiz result for that student.
- [ ] Owner views the result in Reports & Analytics and the readiness ranking.

## 9. Backups & monitoring
- [ ] Supabase project backup schedule configured.
- [ ] `security_audit_log` is Owner-readable in the dashboard — confirm Owner actually checks it periodically; nothing in this codebase surfaces it proactively.

## 10. Known outstanding item
- [ ] The `ai-review-center.jsx`, `homework-authoring-ui.jsx`, `question-bank-browser-ui.jsx` standalone prototypes are not wired to live data. Do not deploy them expecting real functionality until migrated (see `FINAL_ARCHITECTURE.md`).
