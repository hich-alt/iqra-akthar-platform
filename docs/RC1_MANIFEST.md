# RC1 Manifest & Go/No-Go Decision
### اقرأ أكثر... ترى أكثر

## Delivered
68 files: 12 SQL migrations, 18 JS hooks/shared utilities, 14 React
pages/components, 3 test files, 9 documentation files (including this one).

## Completed Modules (11, all Production Ready)
AI Module · Student Management · Student Dashboard · Parent Portal ·
Lesson Editor · Curriculum Manager · Exam System (Mission Critical, full
threat model) · Concours Module · Notifications · Media Upload & Storage ·
Reports & Analytics

Every module above was verified present on disk against its documented
file list in this pass (`check()` loop, POSIX `sh`, not asserted from memory).

## Deferred Items (deliberate, not oversights)
- Gamification (XP/levels/badges/achievements) — never started
- Student-visible ranking/leaderboards — considered and declined for child-wellbeing reasons; Owner-facing ranking exists instead
- Parent Portal write access — never built; read-only by original specification
- Certificate/graduation-portrait generation — separate pipeline from earlier work, intentionally not merged
- 3 standalone prototype pages (`ai-review-center.jsx`, `homework-authoring-ui.jsx`, `question-bank-browser-ui.jsx`) not yet migrated to shared architecture

## Known Limitations
- Caching inconsistent across hook files (7 of 11 don't use `query-cache.js`)
- `prompt_success_rates` SQL view is dead code
- No E2E, load, or penetration testing has been executed anywhere in this project

## Requires Production Validation (full list: `PRODUCTION_VALIDATION.md`)
Highlights: the 12-file migration sequence has never run against a real
database; `submit_exam_attempt`'s edge cases and concurrency behavior are
reasoned through, not executed; Storage bucket policies untested against
real uploads; accessibility untested with a real screen reader.

## Security Assumptions
- Supabase Auth is configured such that `user_roles` (zero client write
  access) is the sole source `current_user_role()` reads — this migration
  eliminates the JWT-claim-source risk that existed for most of this
  project's development, verified by `grep` returning zero remaining
  `auth.jwt() ->> 'role'` policy usages platform-wide.
- No raw-SQL-execution endpoint is exposed to `authenticated` anywhere —
  standard Supabase REST/RPC surface only, a deployment assumption, not
  something this codebase enforces itself.
- `service_role` key is never bundled into any client-side code — verified
  by `CLIENT-SERVER-BOUNDARY.md`'s explicit file-by-file categorization.

## Operational Prerequisites
- `user_roles` must be populated per-account via `service_role`/Admin API
  at provisioning time — there is no self-service or automatic path.
- Anthropic API key configured server-side only, with a spend limit set
  independently (the cost-monitoring code observes, it does not cap).
- Storage buckets created (`homework-uploads` private, `lesson-attachments`
  private, `avatars` public) before any upload feature is used.
- `ai-job-queue.js`'s worker deployed on a schedule; nothing processes AI
  generation jobs without it running.

## Cross-Check Summary (this session, tool-verified, not asserted)
- Zero `auth.jwt() ->> 'role'` outside comments — confirmed via `grep`.
- Zero direct `supabase.*` calls outside `api-client.js` — confirmed via `grep`.
- Zero circular dependencies among hook/shared files — confirmed via script.
- Zero broken imports across all `.jsx` pages — confirmed after correcting
  a bug in the first version of that check (documented in `RELEASE_NOTES.md`
  rather than silently fixed and unmentioned).
- All 11 modules' claimed files verified present on disk.

## P1 Issue Status
Every P1 issue identified during this release cycle was fixed before this
document was written: grade tampering, post-submission answer editing, the
recurring security_invoker masking flaw, the `concours_mock_exam_archive`
data leak, the missing `notifications` RLS, the `homework_submissions`
status-tampering gap, the JWT privilege-escalation risk (platform-wide
migration completed), and the `useExamAnswers` runtime bug found during
convergence audit.

**No unresolved P1 issue remains.**

---

## GO / NO-GO DECISION

# GO

Release Candidate 1 is declared.

This decision is scoped precisely: it means the codebase is internally
consistent, every identified P1-class issue has been fixed and verified by
inspection or tooling available in this environment, and the documented
gaps are genuinely non-blocking (deliberate scope decisions, or
performance/completeness items rather than correctness or security holes).

It does **not** mean the platform has run successfully against a real
database, a real browser, or real user traffic — nothing in this session
could make that claim true, and `PRODUCTION_VALIDATION.md` exists
specifically so that distinction is never blurred. RC2 begins only after
the production validation items in that document have actual results, per
standing instruction.
