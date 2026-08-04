# AI Module — Architecture Documentation
### اقرأ أكثر... ترى أكثر — Phase 10+

## 1. Fundamental Rule

AI never teaches or publishes to students directly. Every AI-generated artifact
is a **draft** that must pass automated validation, then explicit Owner review,
before it becomes visible to a student. This rule is enforced at three layers:
the database (no direct write path from AI to domain tables), the service
layer (`AiDraftService`, state machine), and the job queue (drafts always land
as `generated`, never `published`).

## 2. Bounded Context Map

```
                    ┌─────────────────────┐
                    │   Prompt Library     │  (versioned, source of truth
                    │  prompt-library-     │   for system/user prompts)
                    │  service.js          │
                    └──────────┬───────────┘
                               │ getActivePrompt()
                               ▼
┌──────────────┐      ┌─────────────────┐      ┌──────────────────┐
│  Owner / App │─────▶│  AI Job Queue    │─────▶│ Anthropic API     │
│  enqueue()   │      │  ai-job-queue.js │      │ (Sonnet 4.6)      │
└──────────────┘      └────────┬─────────┘      └──────────────────┘
                                │ raw JSON payload
                                ▼
                       ┌──────────────────┐
                       │  AI Validator     │  schema, refs, dupes,
                       │  ai-validation.js │  curriculum scope
                       └────────┬─────────┘
                        pass │       │ fail
                             ▼       ▼
                    pending_review  rejected (automatic)
                             │
                    Owner reviews in
                    AI Review Center (ai-review-center.jsx)
                             │
                    approve ─┴─ reject
                             │
                        approved
                             │
                        publish() ──▶ writes into real domain table
                             │         (quiz_questions, revision_plans, ...)
                        published
```

## 3. Lifecycle States

| State | Meaning | Can transition to |
|---|---|---|
| `generated` | Raw AI output, not yet validated | `pending_review`, `rejected` |
| `pending_review` | Passed validation, awaiting Owner | `approved`, `rejected` |
| `approved` | Owner approved, not yet live | `published`, `archived` |
| `published` | Live and visible to students | `archived` |
| `rejected` | Owner or validator rejected | `pending_review` (restore), `archived` |
| `archived` | Retired | `pending_review` (restore) |

Every transition is written to `ai_draft_audit_log`, which is DB-enforced
append-only (update/delete trigger raises an exception).

## 4. Validation Rules (automatic, pre-review)

1. JSON schema conformance per draft type (Ajv)
2. Required-field presence (belt-and-suspenders beyond schema)
3. Referenced competency IDs and lesson IDs must exist in the DB
4. Duplicate question detection against the existing question bank
5. Unsupported/unresolved media references
6. Out-of-curriculum term detection against the Grade 6 curriculum index

Any failure => automatic rejection. Invalid generations never reach the
Owner's review queue.

## 5. Prompt Library

- Prompts are **versioned, not mutated**. Editing creates version N+1 and
  deactivates version N, so every draft remains traceable to the exact
  prompt (and its JSON schema) that produced it.
- `usage_count` / `success_count` / `failure_count` are updated by the job
  queue after every generation attempt, independent of Owner approval —
  "success" here means "passed validation," not "was approved."
- Export/import strips internal ids and counters so prompts are portable
  between environments (e.g. dev -> production).

## 6. Job Queue & Performance

- All generation is asynchronous via `ai_generation_jobs`. No request
  handler calls the Anthropic API synchronously.
- Retry: exponential backoff, up to `max_attempts` (default 3).
- Timeout: per-job `timeout_seconds`, enforced via `Promise.race`.
- Rate limiting: token-bucket-style limiter (`RateLimiter`), default 20
  calls/minute — tune against actual Anthropic tier limits.
- Result caching: identical `(prompt_id, version, input_variables)` tuples
  are cached for 1 hour by default, avoiding redundant spend on retries or
  accidental duplicate enqueues.
- Cancellation supported for `queued` and `processing` jobs.

## 7. Analytics

`ai_usage_analytics` (materialized view) aggregates daily per draft type:
total generations, approved/rejected/published counts, average review time
(time between `generated` and the first `approved`/`rejected` audit
entry), token consumption, and estimated cost. Refresh on a schedule
(hourly recommended via `pg_cron` or a scheduled Edge Function).

`prompt_success_rates` (view) surfaces per-prompt-version success rate for
the Prompt Library UI.

**Known limitation:** `estimated_cost_usd` uses a configurable rate constant
(`RATE_PER_MTOK` in `ai-job-queue.js`) — update it whenever Anthropic
publishes new pricing; this is not fetched live.

## 8. Security Notes

- The Owner is the only actor who can call `approve`/`reject`/`publish` —
  enforce this with Row Level Security on `ai_draft_queue` and
  `ai_generation_jobs` keyed to `owner_id`, in addition to app-layer checks.
- `ai_draft_audit_log` cannot be altered post-write (DB trigger), giving a
  tamper-evident trail for any dispute about what was approved and when.
- Student-facing tutor prompts (`buildStudentTutorPrompt`) are scoped to
  attached lesson text only — no open-web knowledge is exposed to a minor
  through this path.

## 9. Testing

See `ai-module.test.js`: unit coverage for the state machine (valid/invalid
transitions, bulk ops, duplication), the validation pipeline (schema,
references, duplicates, curriculum scope), and prompt versioning. An
integration test seam (`describe.skip`) is left for wiring against a real
test-schema Supabase project in CI, gated behind an explicit opt-in so
`npm test` never requires network access by default.

**Not yet covered by this pass** (flagged honestly, not silently skipped):
- End-to-end browser tests against the actual Review Center UI (Playwright/Cypress)
- Load testing of the job queue under concurrent enqueue bursts
- Accessibility audit of `ai-review-center.jsx` (keyboard nav, screen reader labels)
- Offline recovery behavior for the Review Center (relevant given the
  platform's broader PWA/offline requirements)

## 11. Integration Status (second pass)

See `integration-adapters.js` for the full contract layer. Honest status per system:

| System | Status | Notes |
|---|---|---|
| Question Bank | **Live** | Full write path implemented (`QuestionBankAdapter.publish`) |
| Owner Dashboard | **Live** | Review queue summary + cost summary implemented |
| Platform Reports / Analytics | **Live** | Reads from `ai_usage_analytics` view |
| Curriculum Manager | Stub | Contract defined; awaits real module |
| Lesson Editor | Stub | Contract defined; awaits real module |
| Homework System / Library | Stub | Contract defined; awaits real module |
| Quiz System / Quiz Library | Stub | Quiz assembly is intentionally NOT duplicated here — belongs to Quiz System |
| Exam System | Stub | Contract defined for `mock_exam` drafts |
| Concours Module | Stub | Needs concours calendar + revision plan tables |
| Student Dashboard | Stub | Contract enforces reading only from published domain tables, never `ai_draft_queue`, at the read layer |
| Recommendation Engine | Stub | Doesn't exist as a built module yet, per master doc |
| Gamification | **Deliberately not integrated** | AI draft approval must never itself trigger XP/badges |
| Certificates | **Deliberately separate** | Uses a distinct image-prompt pipeline, not `ai_draft_queue` |
| Notification Center | Stub | Integration point identified in `AiDraftService` (post-`validateAndQueue`) |
| Search Engine | Stub | Integration point identified in `publish()`, indexes published rows only |

## 12. Prompt Engineering Center

Extends the Prompt Library with:
- **Categories & tags** (`category`, `tags` columns) for organization
- **Test runs** (`prompt_test_runs` table): sandbox execution against sample
  input, fully isolated from `usage_count` and the live job queue
- **Benchmarking**: run identical test input across every version of a named
  prompt to compare before activating one
- **Rollback**: reactivate any previous version in one call, deactivating
  the current one — the same versioning discipline as `createNewVersion`,
  just in reverse

## 13. Expanded Validation (second pass)

Added to `ai-validation.js`, all gating (failure = automatic rejection)
except where noted as surfaced-only:

- Similarity score (numeric, surfaced on every question — not just a binary duplicate flag)
- Difficulty validity + a mismatch heuristic (structure vs. declared difficulty)
- Competency/objective alignment (keyword-overlap heuristic)
- Question quality score — **surfaced, not gating**, since it's a heuristic proxy, not ground truth
- Reading level estimation (word/sentence-length proxy for Grade 6 Arabic — flagged as needing a real Arabic readability formula later)
- Language validation (Arabic-script dominance check)
- Formatting validation (unfilled `{{placeholders}}`, raw HTML/markup leakage)

## 14. Security (second pass)

- **Output sanitization**: every string field in a payload is stripped of HTML/markup before persistence, independent of whether formatting validation also flags it (defense in depth)
- **Input sanitization**: lesson text / student data inserted into prompt templates is truncated and scanned for common injection phrasing ("ignore previous instructions", "you are now", etc.) before being sent to the model
- **Authorization**: approve/reject/publish must be restricted to `owner_id` via Row Level Security — noted as a deployment requirement, not re-implemented here since RLS policies belong in the Supabase project config, not application code
- **Audit logging**: unchanged from the first pass — DB-enforced append-only

**Known limitation, stated plainly**: no sanitizer makes prompt injection impossible. This reduces the most common vector (instructions hidden in source text) but should not be treated as a complete guarantee.

## 15. Cost & Operations Monitoring

`ai-cost-monitor.js` adds: daily/monthly cost, cache hit rate, retry rate,
failure-reason breakdown, average queue wait time, average response time,
and a rolling dead-letter count — composited into one `dashboardSnapshot()`
call for the Owner Dashboard widget.

## 16. Background Processing (second pass)

- **Dead-letter queue** (`ai_dead_letter_jobs`): jobs exhausting all retries move here with full context, replayable via `replayFromDeadLetter`
- **Worker recovery** (`recoverStuckJobs`): reclaims jobs left in `processing` by a crashed worker
- **Graceful shutdown** (`requestShutdown` / `drainAndShutdown`): stops pulling new jobs and waits for the in-flight one to finish before exit
- **Cache invalidation**: purges stale cache entries tied to a specific prompt version

## 17. Testing (second pass)

`ai-module.test.js` now also covers: every new validation check individually,
prompt test-run isolation from usage stats, rollback correctness, dead-letter
routing, stuck-job recovery, input sanitization, graceful shutdown, and cost
monitor aggregation logic.

**Still not covered** (same honest caveat as the first pass): browser E2E,
load testing, formal accessibility audit, offline recovery testing — these
require a deployed environment this session doesn't have.
