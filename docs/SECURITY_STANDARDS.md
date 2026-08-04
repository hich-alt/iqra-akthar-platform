# Security Standards
### اقرأ أكثر... ترى أكثر — mandatory for every module from this point forward

This document is not a summary of past fixes. It is the checklist every new
SQL object, RPC, and client hook must pass **before** being considered
complete — the same way a module isn't "Production Ready" without an
accessibility pass, it isn't Production Ready without passing every
applicable rule below. Every rule here exists because a real bug of that
exact shape was found and fixed in this codebase; file names are cited so
"why does this rule exist" is always answerable.

---

## 1. JWT Claim Source Requirements

**Status: migrated platform-wide.** Every policy in this codebase now
calls `current_user_role()` instead of `auth.jwt() ->> 'role'` directly
(verified via `grep` across all `.sql` files — zero remaining occurrences
outside comments). This is not merely centralized, it's fully resolved:
`current_user_role()` reads from `user_roles`, a table with **zero client
write access at all** — not even Owner has one; only the Supabase Admin
API / `service_role` key can populate it. No policy in this platform
consults the JWT's role claim anymore, so the `user_metadata` self-
escalation vector described below no longer applies to anything, regardless
of how this project's JWT happens to be configured.

**Operational consequence**: role assignment is now an explicit,
server-side administrative action (populate `user_roles` via
`service_role` when an account is created), not something that happens
automatically at signup. This must be part of the account-provisioning
flow — see `DEPLOYMENT_CHECKLIST.md`.

**Rule**: Never trust `auth.jwt() ->> 'role'` directly in a new policy.
Use `current_user_role()` (defined in `security-hardening.sql`).

**Why this rule exists** (historical — the vulnerability this prevented):
Supabase JWTs can carry claims from `app_metadata` (safe — only
service_role/Admin API can set it) or `user_metadata` (unsafe — the user
edits this themselves via `supabase.auth.updateUser()`). If a policy ever
checked the bare claim and it happened to be sourced from `user_metadata`,
any student could self-promote to Owner. `current_user_role()` closes this
by never looking at the JWT for role information at all.

**Checklist for a new policy:**
- [ ] Does it check a role? → use `current_user_role() = 'owner'`, never `auth.jwt() ->> 'role'`.
- [ ] Does it check ownership? → use `auth.uid() = <owner_column>` (the JWT subject, not a custom claim — this part was never the vulnerable part).

---

## 2. RLS Conventions

**Rule**: Every table gets RLS enabled the moment it's created — no
"we'll add it later" table. Absence of a policy means deny-by-default; this
has been relied on deliberately (e.g. no student DELETE policy anywhere on
`exam_attempts`).

**Rule**: No RESTRICTIVE policy exists anywhere in this codebase (confirmed
by audit). If one is ever added, it AND-combines against every PERMISSIVE
policy for that command on that table — re-audit every existing policy on
that table first, since the combination semantics change platform behavior.

**Rule**: Row-scoping conditions belong in the policy (or, for views, the
`WHERE` clause — see §4). Never in application/React code.

**Checklist for a new table:**
- [ ] `alter table X enable row level security;` in the same migration that creates it.
- [ ] Owner full-access policy (`current_user_role() = 'owner'`), unless the table is an explicit root-of-trust table like `user_roles` where even Owner gets no client write path.
- [ ] Student/Parent read policy scoped to their own rows, if applicable.
- [ ] If a column must be hidden from some readers of an otherwise-readable row, see §4 — RLS cannot do this alone.

---

## 3. SECURITY DEFINER Usage Rules

**Use a SECURITY DEFINER RPC when:**
- A write needs to touch a column revoked from `authenticated` (grading, `is_current` flips).
- A multi-step state transition must be atomic and can't be one RLS-gated statement (`submit_exam_attempt`).
- A read must cross the JWT-role trust boundary in one direction only (`get_student_notes`).
- Two operations must serialize in a way plain row locks can't guarantee (§6).

**Every DEFINER function MUST:**
- [ ] `set search_path = public` — prevents search-path hijacking. No exceptions.
- [ ] `revoke all ... from public;` then `grant execute ... to authenticated;` explicitly.
- [ ] Validate its own authorization inside the function body — being DEFINER bypasses RLS/column grants entirely; the function body is the only enforcement left once inside it.
- [ ] Validate referenced IDs exist BEFORE mutating anything (`set_current_academic_year`/`owner_manual_grade_answer` both had silent no-op bugs on bad input before this was enforced).
- [ ] Write to `security_audit_log` if the action is grade/status/role/visibility-sensitive (§9).

---

## 4. SECURITY INVOKER Usage Rules

**The single most-repeated mistake this session made, three times, before
being caught**: a `security_invoker = true` view doing *conditional* column
masking (`CASE WHEN status = 'graded' THEN col ELSE null`) does not work.
The invoker still needs raw SELECT privilege on that column for the
reference to parse — so either the query errors (if revoked) or the
masking is purely cosmetic (if not revoked, since a direct table query
then bypasses the view entirely).

**Decision rule:**
- View never references a sensitive/revoked column at all (`quiz_questions_safe_view` simply omits `correct_answer`) → `security_invoker = true` is correct; RLS on the base table handles row-scoping.
- View references a column that's conditionally shown/hidden by row state (`total_score` until `status = 'graded'`) → do **not** set `security_invoker`. Bake row-filtering explicitly into the `WHERE` clause using `auth.uid()`/`current_user_role()`/`is_verified_parent_of()`.
- Every such DEFINER view MUST actually have that filtering. `concours_mock_exam_archive` had neither `security_invoker` nor a `WHERE` clause — any authenticated session could read every student's scores. The most serious single finding of the Exam System pass.

**Checklist for a new view:**
- [ ] Does it reference any conditionally-hidden column? → DEFINER + explicit `WHERE auth.uid() = ... or current_user_role() = 'owner' or is_verified_parent_of(...)`.
- [ ] Does it only ever show a fixed safe column set? → `security_invoker = true` is fine.
- [ ] Either way: does it have ANY row-restricting mechanism? A view with neither is the `concours_mock_exam_archive` bug waiting to happen.

---

## 5. Column Privilege Rules

**Rule**: Column-level `REVOKE`/`GRANT` cannot distinguish Owner from
Student — both share the `authenticated` Postgres role (role is a JWT
claim, not a separate Postgres role). Revoking a column from `authenticated`
blocks Owner too — missed for `quiz_questions.correct_answer` until Owner-
authoring needed it.

**Pattern**: Revoke the sensitive column from `authenticated` broadly, then
provide exactly one Owner-privileged read path (a DEFINER view/RPC checking
`current_user_role() = 'owner'`). Never re-grant the column to
`authenticated` just to unblock Owner — that reopens it for students too.

**Rule**: `select("*")` (used by `api-client.js`'s generic `listResource`/
`getResource`) requires SELECT privilege on **every** column, not just
rendered ones — any table with a column revoke needs its own safe view;
the generic client functions cannot point at the base table for that resource.

**Checklist for a new sensitive column:**
- [ ] `revoke select (col) on table from authenticated;`
- [ ] `grant select (safe columns only) on table to authenticated;`
- [ ] Does Owner legitimately need this column? → build the DEFINER path now.
- [ ] Does any client hook query this table with `select("*")`? → redirect to the safe view.

---

## 6. RPC Design Rules

- **Ownership check first, always**: `if v_row.student_id != auth.uid() then raise exception`.
- **Validate existence before mutating** — see §3.
- **Idempotency where naturally repeatable** (`start_exam_attempt` returns the existing attempt) vs. **hard failure where repetition indicates misuse** (`submit_exam_attempt` on an already-submitted attempt raises).
- **Advisory locks for cross-function serialization**: when two RPCs (or an RPC and a policy-gated write) can race on the same resource, `FOR UPDATE` alone isn't enough if one side is a plain SELECT (readers don't block on another transaction's row lock). Use `pg_advisory_xact_lock(hashtext(id::text))` with the SAME key in every function touching that resource (`submit_exam_attempt`/`autosave_exam_answer`). This only works because both sides are RPCs — a direct client write can't take an advisory lock, which is itself a reason to route contested resources through RPCs rather than raw RLS-gated writes.
- **Return the minimum necessary** — `submit_exam_attempt` returns a score summary, never per-question correctness or the answer key, even though the function internally has both.

---

## 7. Ownership Validation

Every RPC and policy scoping to "the caller's own X" compares against
`auth.uid()` — never a client-supplied `student_id`/`user_id` parameter as
the source of truth. A parameter can be lied about; `auth.uid()` (from the
verified JWT) cannot be, absent the separately-tracked §1 issue.

Parent access has one extra hop: `is_verified_parent_of(p_student_id)` —
reused everywhere a parent needs row access, never re-implemented inline.

---

## 8. Authorization Patterns

- **Client-side `can()`/`canOnStudent()`/`parentCanViewChild()` (`permissions.js`) are UX only.** They decide what renders, never what succeeds at the data layer.
- **One permission table, one file** — new actions go into `permissions.js`, not a second table (the fix for the near-miss when Parent Portal almost started one).
- **Reuse an existing permission entry if the allowed-role set is identical** (`use-exam-authoring.js` reuses `lesson.create`) — split only when they actually diverge.
- **Fail closed on an unregistered action** — `can()` returns `false`, not `true`, for an action string missing from the table.

---

## 9. Audit Logging Requirements

**Rule**: `logger.js` is client-side and proves nothing — anyone calling an
RPC directly via the REST API, bypassing React entirely, produces zero
trail through it. Any action changing a grade, a role-adjacent state, a
visibility flag, or reading an Owner-privileged field **must** write to
`security_audit_log` from inside the DEFINER function itself.

**Design rules, don't deviate:**
- Append-only, DB-enforced via `BEFORE UPDATE/DELETE` triggers that raise (same pattern as `ai_draft_audit_log`).
- No `authenticated` INSERT policy, ever — every row comes from a DEFINER function's own privileges. A client-insertable audit log is a forgeable one.
- Owner-read-only.

**Checklist for a new DEFINER function:**
- [ ] Changes a grade/score/status/visibility flag/role-adjacent state? → log it.
- [ ] Reads an Owner-privileged field about someone else (e.g. private notes)? → log it — who accessed sensitive data matters even for a read.

---

## 10. Client/Server Boundary Rules

(Full detail in `CLIENT-SERVER-BOUNDARY.md`; the rule in one sentence:)

A hook/service belongs on the server (or must be an RPC) the moment it
needs to read a column a student must never see — regardless of how the
rest of the module is organized. `exam-attempt-service.js`'s and
`quiz-assembly-service.js`'s original blanket "always server-side" framing
was too blunt: the real test is the column, not the file. Apply this exact
one-question test to every new service file — don't default to
"server-side to be safe" or "client-side for convenience" without asking it.

---

## 11. Data Exposure Rules

- **Never expose a correction/grade/score before the action it depends on completes.** This exact rule was established for homework, re-broken for exams (masking-view flaw), re-broken again for concours (missing filter entirely) — it recurred three times because each new view was written fresh instead of checked against this rule first. It is now a rule, not a pattern to rediscover.
- **A view with neither `security_invoker` nor an explicit row filter is not "unfinished" — it is a live vulnerability the moment it's queryable.** There is no safe default for an empty view definition.
- **Views and RPCs return the minimum shape needed** — don't `select *` "for convenience" if half the columns are exactly what the surrounding security work exists to hide.

---

## 12. Regression Checklist

Run this against **every previously-locked module** whenever a new
security pattern is established — not just the module currently being
built. This is what caught the `concours_mock_exam_archive` and
`homework_submissions.status` bugs, both in modules already marked
Production Ready before Exam System's audit.

For each table/view touched by the module under review:
- [ ] RLS enabled?
- [ ] Every view either `security_invoker` with no conditional masking, OR explicit row-filtering baked in? (§4)
- [ ] Every sensitive column column-revoked, with an explicit Owner path if needed? (§5)
- [ ] Every policy/DEFINER function checks `current_user_role()`/`auth.uid()`, not a client-supplied value or the un-migrated `auth.jwt() ->> 'role'`? (§1, §7)
- [ ] Every grade/status/score-changing action goes through an RPC, not a direct RLS-gated UPDATE with an unrestricted column set? (§3, §6)
- [ ] Every security-sensitive RPC writes to `security_audit_log`? (§9)
- [ ] Any two write paths touching the same resource that could race? → advisory lock, same key, both. (§6)

**Formerly-outstanding platform-wide item, now resolved**: the §1 JWT-claim
migration is complete — every policy uses `current_user_role()`, verified
by `grep` returning zero remaining `auth.jwt() ->> 'role'` matches outside
comments. The operational follow-up (role assignment is now a manual
server-side step per new account, not automatic) is tracked in
`DEPLOYMENT_CHECKLIST.md`, not left as an ambient assumption.
