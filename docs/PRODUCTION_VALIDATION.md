# Production Validation
### Items this session could not verify by execution — only by inspection/tracing

Nothing in this document is a failure. It's the honest boundary between
"internally consistent by careful inspection" and "actually run." No
Supabase instance, browser, or Anthropic API connection existed in this
session at any point.

## Critical — verify before trusting any RLS policy in production
- [ ] `current_user_role()` correctly returns `null`/no role for a session with no `user_roles` row, and every policy correctly denies access in that case (traced through, not executed).
- [ ] `user_roles` is genuinely unreachable by any client write — confirmed by policy definition (`using (false) with check (false)`), not by attempting a write against a live database.
- [ ] Every column-level `REVOKE`/`GRANT` pair actually behaves as described: a direct `select *` against `quiz_questions`/`student_profiles`/`homework_submissions`/`exam_attempts`/`exam_answers` from an authenticated non-owner session errors or returns only safe columns, per table.

## Critical — Exam System (Mission Critical subsystem)
- [ ] `submit_exam_attempt()`'s grading logic against every question type, including edge cases: empty `student_answer`, malformed jsonb, a `fill_blank` answer containing mixed tashkeel and non-Arabic characters.
- [ ] The advisory lock (`pg_advisory_xact_lock`) actually serializes `autosave_exam_answer`/`submit_exam_attempt` under real concurrent load — reasoned through by design, never executed under concurrency.
- [ ] `is_late` computation across a DST transition or timezone misconfiguration between the DB server and `exam.duration_minutes`' implicit assumption of minutes-as-wall-clock-time.
- [ ] RPC performance at realistic exam-end submission spikes (many students submitting within the same minute).

## High — cross-cutting
- [ ] The full manual walkthrough in `DEPLOYMENT_CHECKLIST.md` §8, end to end, with real accounts.
- [ ] `ai-job-queue.js`'s worker actually deployed and processing a real job against the real Anthropic API (every AI Module test in this codebase uses a fake in-memory DB and a mocked Anthropic client).
- [ ] Cost estimation (`ai-cost-monitor.js`) against Anthropic's actual current published pricing — the rate constant in `ai-job-queue.js` was written once and will drift.
- [ ] Storage bucket policies (`storage-security.sql`) against real file uploads — path-prefix authorization logic traced through, never exercised with an actual multipart upload.

## Medium
- [ ] Accessibility: `aria-live`, `aria-label`, `role="tablist"` usage was written to spec but never tested with an actual screen reader (VoiceOver/NVDA/JAWS).
- [ ] Responsive behavior: Tailwind breakpoints were chosen by convention (`md:`), never visually verified on real devices.
- [ ] The reading-level heuristic in `ai-validation.js` (word/sentence-length proxy) against real Grade 6 Arabic text — no corpus was available to calibrate against.

## Explicitly NOT verified, and why that's acceptable for RC1
- No load testing of any kind was performed — this platform is sized for one school, and premature load testing would have been effort spent on a risk this deployment doesn't yet have.
- No penetration testing was performed — the threat model review (Exam System) and the platform-wide security regression check are the substitute available in this environment; they are not equivalent to an external pentest and shouldn't be represented as one.

## What WAS verified in this session (not just claimed)
- Broken-import check across every `.jsx` page's imports against actual exports (`grep`-based, corrected once after an initial script bug — see `RELEASE_NOTES.md`).
- Circular-dependency check across every hook/shared file.
- Consistent API-layer usage (zero direct `supabase.*` calls outside `api-client.js`).
- `grep`-verified zero remaining `auth.jwt() ->> 'role'` occurrences outside comments, platform-wide.
- Manual trace-through of `submit_exam_attempt`'s SQL logic against each question type's comparison semantics (documented reasoning, not execution — listed above under "requires validation" for the *edge cases* specifically, but the base-case logic was traced carefully).
