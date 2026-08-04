# Client / Server Boundary

This distinction was implicit for most of this project and is now made
explicit, because `security-hardening.sql` only actually protects anything
if it's respected: **grading logic needs `correct_answer`; students must
never receive it. The only way both are true is if grading never runs in
code that ships to the browser.**

## Client-side (browser bundle, `anon`/`authenticated` key, RLS + column
grants are the enforcement boundary)

| File | Notes |
|---|---|
| `api-client.js` | The only file that should hold a Supabase client instance in the browser |
| `permissions.js` | UX-layer only — see repeated note throughout: this is not a security boundary |
| `use-async.js`, `logger.js` | Generic utilities, no data access |
| `use-students.js`, `use-student-records.js`, `use-student-dashboard.js`, `use-parent-dashboard.js`, `use-lessons.js`, `use-curriculum-structure.js`, `use-exam-attempts.js`, `use-exam-authoring.js`, `use-concours-ranking.js`, `use-notifications.js` | Query hooks — every query here is scoped by RLS/column grants, not by these hooks' own logic |
| `validation.js`, `query-cache.js` | Shared utilities — form validation and the in-memory query cache, both extracted the moment a second/third consumer needed them |
| `ui-primitives.jsx` | Presentational only |
| `student-list-page.jsx`, `student-profile-page.jsx`, `student-dashboard-page.jsx`, `parent-dashboard-page.jsx`, `curriculum-manager-ui.jsx`, `curriculum-structure-page.jsx`, `exam-quiz-authoring-ui.jsx`, `exam-taking-page.jsx` | React pages |
| `ai-review-center.jsx`, `homework-authoring-ui.jsx`, `question-bank-browser-ui.jsx` | Still standalone prototypes — migrate to this same client boundary when next touched |

## Status correction: exam-attempt-service.js and quiz-assembly-service.js

Both were originally marked "must stay server-side." That's been superseded
by `exam-security-hardening.sql`:

- **`exam-attempt-service.js`**: its `autoGrade`/`_compareAnswer` logic is
  now the **reference implementation only**. The actually-enforced grading
  runs inside `submit_exam_attempt()` (a Postgres `SECURITY DEFINER`
  function), because relying on a separate JS worker to grade after a
  client sets `status='submitted'` would leave a window where that status
  change succeeds but grading hasn't happened yet — a gap a client can't
  exploit for a better score, but one that's simply unnecessary risk when
  the grading can be atomic with the submission itself. Do not deploy this
  file as a live grading path; it exists for readability and as the source
  the SQL function's logic was transcribed from.
- **`quiz-assembly-service.js`**: its constraint was specifically "must not
  run where a student session could read `correct_answer`" — not "must
  never run in a browser." Now that `owner_quiz_questions_view` gives Owner
  sessions a safe, column-complete read path, `use-exam-authoring.js` runs
  the equivalent assembly logic **client-side, for the Owner only**. This
  file remains the original algorithm reference; the live implementation is
  the hook.

## Server-side only (`service_role` key — bypasses RLS and column grants
entirely; must run in an Edge Function, cron worker, or equivalent, and must
never be imported into anything bundled for the browser)

| File | Why it must stay server-side |
|---|---|
| `exam-attempt-service.js` | `_compareAnswer` reads `correct_answer` — the exact column revoked from `authenticated` in `security-hardening.sql` |
| `homework-grading-service.js` | Writes feedback/scores; also the authoritative source `student_homework_view` mirrors |
| `readiness-service.js` | Computes scores from cross-student aggregates in ways RLS-scoped client queries can't (and shouldn't) do |
| `quiz-assembly-service.js` | Reads `correct_answer` implicitly via full question rows during assembly |
| `ai-draft-service.js`, `ai-validation.js`, `ai-job-queue.js`, `prompt-library-service.js`, `ai-cost-monitor.js` | Hold/relay the Anthropic API key; `ai-job-queue.js` additionally never belonged in a browser regardless of key handling (long-running polling/retry loop) |
| `recommendation-engine.js` | Reads other students' aggregate patterns in ways an individual student's RLS-scoped session shouldn't |
| `integration-adapters.js` | Orchestrates the above |

## Deprecated by this session's architecture change

`student-dashboard-service.js` (built earlier, before `api-client.js` existed)
duplicates what `use-student-records.js` + a forthcoming `use-student-
dashboard.js` now do through the real client/RLS boundary. Per "do not
create parallel implementations": **do not extend `student-dashboard-
service.js` further.** It's superseded, not deleted outright only because
removing files outside `/mnt/user-data/outputs` isn't meaningful in this
delivery format — treat it as dead code in any real repository.

## The actual rule going forward

Before adding any new hook or service file, ask one question: *does this
code need to read a column a student must never see (`correct_answer`,
`.notes`, ungraded `feedback`/`total_score`)?* If yes, it is server-side by
definition, regardless of how the module is otherwise organized.
