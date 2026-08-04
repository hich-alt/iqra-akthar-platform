# اقرأ أكثر... ترى أكثر — Release Readiness
### Release Mode closure document

## What "ready for deployment" means here

This document is the honest boundary of what code alone can guarantee.
Every file listed is internally consistent — schemas reference each other
correctly, services call real query shapes, the AI Module's fundamental
rule (nothing reaches a student without explicit Owner approval) is
enforced at both the write layer and the read layer. What no amount of
further code-writing in this session can do: run these migrations against
a real database, call the real Anthropic API, or be clicked through in an
actual browser. That happens once you deploy. This document is the runbook
for that step.

## P1 — Launch scope (complete)

| Bounded context | Schema | Services | Owner UI | Tests |
|---|---|---|---|---|
| AI Module | ✅ | ✅ | ✅ (Review Center) | ✅ |
| Curriculum Manager | ✅ | — (CRUD only, UI covers it) | ✅ | — |
| Question Bank | ✅ | — (CRUD only, UI covers it) | ✅ | — |
| Homework System | ✅ | ✅ (grading) | ✅ | — |
| Exam System | ✅ | ✅ (attempts) | ✅ | — |
| Quiz System | (reuses Exam System) | ✅ (assembly) | ✅ (shared UI) | — |
| Concours Module | ✅ | ✅ (readiness) | — | — |
| Student Dashboard | — | ✅ (read aggregator) | — | — |
| Recommendation Engine | — (computed) | ✅ | — | — |
| Notification Center | ✅ | — (insert-only, simple) | — | — |

**Honest gap:** only the AI Module has real automated test coverage. The
newer schemas/services (Exam, Homework, Concours, Student Dashboard,
Recommendation Engine) are logically reviewed but not unit-tested the same
way. Before launch, at minimum: port the `FakeDb` pattern from
`ai-module.test.js` to cover `exam-attempt-service.js` (grading correctness
is the highest-risk area — a scoring bug affects every student) and
`homework-grading-service.js` (the pre-submission visibility rule is a
privacy-adjacent guarantee worth testing explicitly).

## P2 — Explicitly deferred post-launch

- Gamification (XP/levels/badges) — not started, and deliberately never
  auto-triggered by AI per the AI Module's design
- Certificates / graduation portrait pipeline — exists from earlier
  prompt-engineering work, intentionally not merged into this codebase
- Parent Portal — marked "Future" in the original project document
- Real Arabic readability formula (currently a word/sentence-length proxy
  in `ai-validation.js`)
- Live Anthropic pricing lookup (currently a hardcoded rate constant in
  `ai-job-queue.js` — update manually against published rates)
- Dedicated search infrastructure (currently Postgres full-text search;
  fine at this scale, revisit if the question/lesson corpus grows large)
- Browser E2E tests, load testing, formal accessibility audit, offline
  recovery testing — all require a deployed environment to run meaningfully

## Deployment runbook

### 1. Supabase project setup
```
1. Create a new Supabase project.
2. Run schema files in dependency order — see below.
3. Create Storage buckets: homework-uploads (private), lesson-attachments
   (private), avatars (public) — storage-security.sql's bucket inserts
   handle this via SQL directly; if running through the Supabase dashboard
   UI instead, match the same three bucket names/visibility exactly.
```

**Migration order has grown since this document was first written.** The
authoritative, current order (each file after the point it was added in
this manifest depends on tables/functions from files before it):

```
1. ai-module-schema.sql
2. question-bank-homework-schema.sql
3. curriculum-manager-schema.sql
4. exam-system-schema.sql
5. student-management-schema.sql
6. parent-portal-schema.sql          (defines is_verified_parent_of())
7. concours-module-schema.sql        (uses is_verified_parent_of())
8. notification-center-schema.sql
9. security-hardening.sql
10. exam-security-hardening.sql
11. exam-threat-model-fixes.sql      (defines current_user_role(), user_roles)
12. storage-security.sql             (uses current_user_role())
```

Item 9-11's `auth.jwt() ->> 'role'` policies described below have since
been migrated to `current_user_role()` — see `SECURITY_STANDARDS.md` §1,
now marked resolved rather than outstanding. `current_user_role()` itself
is defined in `security-hardening.sql` (moved there from
`exam-threat-model-fixes.sql` during that migration, since it needed to be
available to every policy from that point in the migration order onward).

### 2. Environment variables
- Anthropic API key (server-side only, never exposed to the client)
- Supabase URL + service role key (for the job worker) + anon key (for the client)

### 3. Background worker
Deploy `ai-job-queue.js`'s `processNext()` on a schedule — a Supabase Edge
Function on a cron trigger (every 10–30s) is the simplest option given the
existing stack (Supabase + Netlify/Vercel). Call `recoverStuckJobs()` once
on worker cold-start.

### 4. Row Level Security
Every table with an `owner_id` or `student_id` column needs RLS policies
restricting rows to that user (Owner sees only their own data; students see
only their own submissions/attempts/notifications). This was flagged as a
deployment requirement throughout the AI Module docs — apply it to every
new table added in this final pass too (`exams`, `homework`, `revision_plans`,
`notifications`, etc.), not just the AI Module's tables.

### 5. Frontend
Each `.jsx` file in this delivery is a standalone prototype with mocked
data. Replace the `MOCK_*` constants and local `useState` mutations with
real calls to the services/adapters built alongside them (e.g.
`ai-review-center.jsx` → `ai-draft-service.js`; `exam-quiz-authoring-ui.jsx`
→ `quiz-assembly-service.js` / `ExamSystemAdapter`).

## Final sign-off checklist before going live
- [ ] Schema migrations run in the corrected order above, no errors
- [ ] RLS policies applied and manually tested with two different user accounts
- [ ] Job worker deployed and processing a real test job end-to-end
- [ ] At least one full manual walkthrough: Owner publishes a lesson → generates
      an AI question draft → approves it → assembles a quiz → a test student
      account completes it → grade appears → competency score updates →
      weakness analysis reflects it
- [ ] Anthropic API key has a spend limit/alert configured (cost monitoring
      code exists; it doesn't prevent overspend by itself)
- [ ] Backup schedule configured for the Supabase project
