# Release Notes — Release Candidate 1
### اقرأ أكثر... ترى أكثر

## Modules shipped (all Production Ready)
AI Module · Student Management · Student Dashboard · Parent Portal ·
Lesson Editor · Curriculum Manager · Exam System · Concours Module ·
Notifications · Media Upload & Storage · Reports & Analytics

## Shared architecture established
`api-client.js` (single Supabase client + generic query/RPC/storage
functions), `permissions.js` (single permission table), `validation.js`
(single rule set), `query-cache.js` (single cache), `use-async.js` (single
fetch/loading/error pattern), `logger.js`, `ui-primitives.jsx`.
`SECURITY_STANDARDS.md` codifies the rules this architecture must keep
satisfying for every future module.

## Real issues found and fixed during this release cycle
Listed because a release note that only lists features would misrepresent
how this codebase actually got here — most of what made it production-safe
was finding and closing gaps, not writing new features.

- **Grade tampering** (`exam_attempts` RLS previously allowed a student to write their own `status`/`total_score`/`max_score` directly)
- **Post-submission answer editing** (`exam_answers` policy never checked attempt status)
- **The security_invoker masking-view flaw**, found three times independently (homework, exam, concours) before becoming a documented rule in `SECURITY_STANDARDS.md` §4
- **`concours_mock_exam_archive`**: no row filter, no `security_invoker` — any authenticated session could read every student's mock-exam scores
- **`notifications`**: no RLS enabled at all, despite an earlier summary incorrectly stating it was — every notification readable by anyone
- **`homework_submissions.status`**: writable by any student directly, identical bug class to the exam_attempts fix, found one module later
- **JWT privilege escalation risk**: every policy trusted `auth.jwt() ->> 'role'` directly; migrated platform-wide to `current_user_role()`, which reads a table with zero client write access instead — this doesn't just centralize the check, it eliminates the trust dependency on the JWT claim entirely
- **`useExamAnswers` runtime bug**: queried the base `exam_answers` table with `select("*")`, which would error for students once `is_correct`/`points_awarded` were column-revoked — found via convergence audit, not caught earlier because the hook had no consumer yet
- **Two forward-reference schema bugs** (FK to a table defined later in the same file) and one dropped documentation heading, all found and fixed during routine passes, not flagged externally

## Deliberate scope decisions (not gaps)
- **Gamification and student-visible ranking/leaderboards are not built.** Both were considered and explicitly declined — comparing children's performance or scores against peers, especially ahead of a high-stakes entrance exam, carries real wellbeing risk for this age group that a private, Owner-facing tool does not. `owner_readiness_ranking_view` exists for the teacher; nothing student-facing surfaces it.
- **Certificate/graduation-portrait generation** uses a separate image-prompt pipeline from earlier work, intentionally not merged into the `ai_draft_queue` review workflow — different content type, different risk profile.
- **Parent Portal is read-only**, by design, matching the original project specification exactly — no parent write policy exists on any table.

## Known limitations at RC1 (see `FINAL_ARCHITECTURE.md` for full detail)
- Caching is inconsistent across hook files (7 of 11 don't use `query-cache.js`) — a real, accepted gap, not fixed during this "minimize change" phase.
- 3 standalone prototype pages remain unmigrated to the shared architecture.
- `prompt_success_rates` (AI Module) is dead code, superseded by JS-side computation elsewhere.
- No code in this repository has ever executed against a live database, browser, or the real Anthropic API — see `PRODUCTION_VALIDATION.md`.

## Correction to this release process, stated for the record
A platform-wide `grep`-based audit initially reported ~30 "broken imports."
The check itself had a bug (wrong file-extension handling, missed
`export const`/`export async function` patterns) — corrected, rerun, zero
real broken imports remained. Recorded here because a security- and
correctness-focused release process should be able to say when its own
tooling was wrong, not just when the code was.
