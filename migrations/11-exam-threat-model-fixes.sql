-- ============================================================================
-- اقرأ أكثر... ترى أكثر — EXAM SYSTEM THREAT MODEL REVIEW & FIXES
-- Continuation of exam-security-hardening.sql. Read the header of that file
-- first; this one assumes its objects already exist.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- FINDING 1 (CRITICAL) — PRIVILEGE ESCALATION VIA JWT CLAIM SOURCE
--
-- Every policy in this codebase so far uses `auth.jwt() ->> 'role'`. In
-- Supabase, a JWT can carry claims from TWO different places a developer
-- might put "role" into:
--   - `app_metadata` — set only via the Admin API / service_role. NOT
--     editable by the user themselves. SAFE to trust in a policy.
--   - `user_metadata` — editable by the user via `supabase.auth.updateUser()`
--     from the CLIENT. If "role" lives here, any student can call that one
--     client SDK method and set their own role to 'owner', and every
--     policy in this entire codebase that checks `auth.jwt() ->> 'role' =
--     'owner'` would then grant them full access. This is a real,
--     documented Supabase footgun, not a hypothetical.
--
-- This migration assumes the project's Supabase Auth is configured with a
-- custom access token hook that copies a role from a server-controlled
-- table into the JWT at token-issuance time — NEVER from `user_metadata`.
-- That hook is deployment configuration, not something this SQL file can
-- enforce by itself. What this file CAN do: stop trusting the bare
-- `auth.jwt() ->> 'role'` expression scattered across a dozen policies,
-- and route every check through one function, so there is exactly one
-- place to fix if the claim source is ever found to be wrong.
-- ----------------------------------------------------------------------------

-- MOVED to security-hardening.sql (the earliest file needing it, now that
-- the platform-wide migration below happens in this same pass). Defined
-- exactly once, not duplicated here.

-- UPDATE: the migration described below as "NOT done in this file" has now
-- been performed — see the Release Engineering pass that mechanically
-- replaced `auth.jwt() ->> 'role'` with `current_user_role()` across
-- security-hardening.sql, exam-security-hardening.sql, parent-portal-
-- schema.sql, concours-module-schema.sql, and student-management-schema.sql.
-- Verified via grep: zero remaining occurrences of the bare claim pattern
-- in any policy or function body across the entire codebase — the only
-- matches left anywhere are in comments describing this history, like the
-- paragraph immediately below.
--
-- Rewriting the ~25 existing policies across security-hardening.sql,
-- exam-security-hardening.sql, and parent-portal-schema.sql from
-- `auth.jwt() ->> 'role' = 'owner'` to `current_user_role() = 'owner'` is
-- NOT done in this file. That's a large mechanical change touching every
-- security policy in the platform, and making it silently inside a
-- "threat model fixes" pass risks a transcription error with no
-- independent review. Flagging as the single highest-priority follow-up:
--
-- CORRECTED ASSESSMENT, post-migration: this is not merely "centralized,"
-- it is FULLY RESOLVED. current_user_role() does not read the JWT role
-- claim at all — it reads user_roles, a table with ZERO client write
-- access (not even Owner has one; only the Admin API / service_role can
-- populate it). Every policy now migrated to current_user_role() is
-- therefore immune to the user_metadata self-escalation vector regardless
-- of how this Supabase project's JWT happens to be configured — because
-- none of them consult the JWT's role claim anymore. The original
-- "REQUIRES PRODUCTION VALIDATION" framing below (confirm the JWT claim
-- source before deploying) is now moot for every MIGRATED policy; it
-- would only still matter for a hypothetical future policy that reached
-- for auth.jwt() ->> 'role' directly instead of calling current_user_role()
-- — which SECURITY_STANDARDS.md §1 now explicitly forbids.
--
--   REQUIRES PRODUCTION VALIDATION: confirm how this Supabase project's
--   JWT `role` claim is actually populated (app_metadata + custom access
--   token hook, vs. user_metadata) BEFORE deployment. If it is
--   user_metadata, every policy using auth.jwt()->>'role' in this codebase
--   is a live privilege-escalation vulnerability, not a theoretical one.

-- ----------------------------------------------------------------------------
-- FINDING 2 — CONCURRENT SUBMISSION RACE (write-write) and
-- FINDING 3 — ANSWER-TAMPERING RACE (autosave-vs-submit)
--
-- FOR UPDATE alone (added to submit_exam_attempt) serializes concurrent
-- SUBMIT calls against each other, but plain SELECTs in an RLS policy
-- subquery do not respect another transaction's FOR UPDATE lock (readers
-- don't block on writer locks in Postgres MVCC) — so a client could still
-- time an autosave to land in the window between submit starting and
-- committing. Fix: autosave becomes its own SECURITY DEFINER RPC taking
-- the SAME advisory lock (keyed on attempt_id) that submit takes, so the
-- two genuinely serialize against each other. Direct client writes to
-- exam_answers are revoked entirely — this RPC is now the only path.
-- ----------------------------------------------------------------------------

create or replace function autosave_exam_answer(p_attempt_id uuid, p_question_id uuid, p_answer jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status attempt_status;
  v_student_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_attempt_id::text));

  select status, student_id into v_status, v_student_id from exam_attempts where id = p_attempt_id;
  if v_student_id is null or v_student_id != auth.uid() then
    raise exception 'المحاولة غير موجودة أو لا تخصك';
  end if;
  if v_status != 'in_progress' then
    raise exception 'لا يمكن تعديل الإجابات بعد التسليم';
  end if;

  insert into exam_answers (attempt_id, question_id, student_answer, answered_at)
  values (p_attempt_id, p_question_id, p_answer, now())
  on conflict (attempt_id, question_id) do update set student_answer = excluded.student_answer, answered_at = excluded.answered_at;
end;
$$;

revoke all on function autosave_exam_answer(uuid, uuid, jsonb) from public;
grant execute on function autosave_exam_answer(uuid, uuid, jsonb) to authenticated;

create or replace function submit_exam_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt exam_attempts;
  v_exam exams;
  v_total numeric := 0;
  v_max numeric := 0;
  v_pending_manual int := 0;
  v_answer record;
  v_question quiz_questions;
  v_points numeric;
  v_is_correct boolean;
  v_is_late boolean;
begin
  -- Same advisory lock key as autosave_exam_answer — this is what makes
  -- the two functions actually serialize against each other, not just
  -- FOR UPDATE (which readers can bypass) alone.
  perform pg_advisory_xact_lock(hashtext(p_attempt_id::text));

  select * into v_attempt from exam_attempts where id = p_attempt_id for update;
  if not found or v_attempt.student_id != auth.uid() then
    raise exception 'المحاولة غير موجودة أو لا تخصك';
  end if;
  if v_attempt.status != 'in_progress' then
    raise exception 'لا يمكن تسليم محاولة غير جارية';
  end if;

  select * into v_exam from exams where id = v_attempt.exam_id;
  v_is_late := v_exam.duration_minutes is not null
    and now() > (v_attempt.started_at + (v_exam.duration_minutes || ' minutes')::interval);

  for v_answer in select * from exam_answers where attempt_id = p_attempt_id loop
    select * into v_question from quiz_questions where id = v_answer.question_id;
    v_points := coalesce((select esq.points from exam_section_questions esq
                          join exam_sections s on s.id = esq.section_id
                          where s.exam_id = v_attempt.exam_id and esq.question_id = v_question.id), 1);
    v_max := v_max + v_points;

    if v_question.type = 'short_answer' then
      v_pending_manual := v_pending_manual + 1;
      continue;
    end if;

    if v_question.type in ('mcq', 'true_false') then
      v_is_correct := v_answer.student_answer::text = to_jsonb(v_question.correct_answer)::text;
    elsif v_question.type = 'fill_blank' then
      v_is_correct := regexp_replace(trim(both from (v_answer.student_answer #>> '{}')), '[\u064B-\u0652]', '', 'g')
                    = regexp_replace(trim(both from v_question.correct_answer), '[\u064B-\u0652]', '', 'g');
    else
      v_is_correct := false;
    end if;

    update exam_answers set is_correct = v_is_correct, points_awarded = case when v_is_correct then v_points else 0 end
      where id = v_answer.id;
    if v_is_correct then v_total := v_total + v_points; end if;
  end loop;

  update exam_attempts set
    status = case when v_pending_manual = 0 then 'graded' else 'submitted' end,
    submitted_at = now(),
    time_spent_seconds = extract(epoch from (now() - v_attempt.started_at))::int,
    total_score = v_total, max_score = v_max, is_late = v_is_late
  where id = p_attempt_id;

  insert into security_audit_log (actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'submit_exam_attempt', 'exam_attempts', p_attempt_id,
          jsonb_build_object('totalScore', v_total, 'maxScore', v_max, 'isLate', v_is_late, 'pendingManual', v_pending_manual));

  return jsonb_build_object('totalScore', v_total, 'maxScore', v_max, 'pendingManualGrading', v_pending_manual, 'isLate', v_is_late);
end;
$$;

revoke all on function submit_exam_attempt(uuid) from public;
grant execute on function submit_exam_attempt(uuid) to authenticated;

-- Direct client writes to exam_answers are now fully closed — autosave
-- goes through the RPC above, never RLS-gated direct inserts/updates.
drop policy if exists student_answers_while_in_progress_insert on exam_answers;
drop policy if exists student_answers_while_in_progress_update on exam_answers;
revoke insert, update on exam_answers from authenticated;
-- student_reads_own_answers (SELECT) remains — students still read their
-- own answers (via student_exam_answers_view) for review after submission.

-- ----------------------------------------------------------------------------
-- FINDING 4 — RPC INPUT VALIDATION GAPS (silent no-ops on bad input)
-- ----------------------------------------------------------------------------

create or replace function set_current_academic_year(p_year_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user_role() != 'owner' then
    raise exception 'ليست لديك صلاحية تغيير السنة الدراسية الحالية';
  end if;
  -- FIX: previously, an invalid p_year_id would unset every year as
  -- current (the first UPDATE) and then silently match zero rows on the
  -- second, leaving NO academic year marked current. Existence is checked
  -- BEFORE anything is mutated.
  if not exists (select 1 from academic_years where id = p_year_id) then
    raise exception 'السنة الدراسية غير موجودة';
  end if;
  update academic_years set is_current = false where is_current = true;
  update academic_years set is_current = true where id = p_year_id;
  insert into security_audit_log (actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'set_current_academic_year', 'academic_years', p_year_id, '{}'::jsonb);
end;
$$;

create or replace function owner_manual_grade_answer(p_answer_id uuid, p_is_correct boolean, p_points numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt_id uuid;
  v_remaining int;
  v_total numeric;
begin
  if current_user_role() != 'owner' then
    raise exception 'ليست لديك صلاحية تصحيح هذه الإجابة';
  end if;

  -- FIX: a nonexistent p_answer_id previously no-op'd silently all the way
  -- through instead of surfacing an error to the Owner UI.
  if not exists (select 1 from exam_answers where id = p_answer_id) then
    raise exception 'الإجابة غير موجودة';
  end if;

  update exam_answers set is_correct = p_is_correct, points_awarded = p_points
    where id = p_answer_id returning attempt_id into v_attempt_id;

  select count(*) into v_remaining from exam_answers where attempt_id = v_attempt_id and is_correct is null;
  if v_remaining = 0 then
    select sum(points_awarded) into v_total from exam_answers where attempt_id = v_attempt_id;
    update exam_attempts set status = 'graded', total_score = v_total where id = v_attempt_id;
  end if;

  insert into security_audit_log (actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'owner_manual_grade_answer', 'exam_answers', p_answer_id,
          jsonb_build_object('isCorrect', p_is_correct, 'points', p_points));
end;
$$;

-- ----------------------------------------------------------------------------
-- FINDING 5 — NO DURABLE AUDIT LOG FOR SECURITY-SENSITIVE RPCS
--
-- Every log.info() call in the JS hooks is CLIENT-SIDE (the browser
-- console). Anyone calling these RPCs directly via the Supabase REST API
-- — bypassing the React app entirely — would leave zero trail. Grade
-- changes, attempt submissions, and current-year changes need a
-- server-side, tamper-evident record regardless of which client called
-- them. Same append-only pattern as ai_draft_audit_log.
-- ----------------------------------------------------------------------------

create table if not exists security_audit_log (
  id            uuid primary key default gen_random_uuid(),
  actor_id      uuid not null references users(id),
  action        text not null,
  entity_table  text not null,
  entity_id     uuid,
  metadata      jsonb default '{}',
  created_at    timestamptz not null default now()
);

create index idx_security_audit_actor on security_audit_log (actor_id, created_at desc);
create index idx_security_audit_entity on security_audit_log (entity_table, entity_id);

alter table security_audit_log enable row level security;
create policy owner_reads_security_audit_log on security_audit_log for select using (current_user_role() = 'owner');
-- No INSERT policy for `authenticated` at all — every insert happens from
-- inside a SECURITY DEFINER function (bypasses RLS as the function owner),
-- never directly from a client. The log can't be forged by the actor it logs.

create or replace function prevent_audit_log_mutation() returns trigger as $$
begin
  raise exception 'security_audit_log is append-only';
end;
$$ language plpgsql;

create trigger trg_no_security_audit_update before update on security_audit_log
  for each row execute function prevent_audit_log_mutation();
create trigger trg_no_security_audit_delete before delete on security_audit_log
  for each row execute function prevent_audit_log_mutation();

create or replace function get_student_notes(p_student_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notes text;
begin
  if current_user_role() != 'owner' then
    raise exception 'ليست لديك صلاحية الوصول إلى هذه الملاحظات';
  end if;
  select notes into v_notes from student_profiles where user_id = p_student_id;
  insert into security_audit_log (actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'get_student_notes', 'student_profiles', p_student_id, '{}'::jsonb);
  return v_notes;
end;
$$;

-- ----------------------------------------------------------------------------
-- FINDING 6 — OWNERSHIP TRANSITION EDGE CASE: reverting a released exam
-- back to 'draft' while attempts are in_progress would immediately cut off
-- those students' read access to exam_sections/exam_section_questions (RLS
-- re-evaluates exam status on every query), stranding them mid-exam. Not a
-- security hole — the opposite, stricter access than intended — but a
-- real availability bug. Guarded against directly.
-- ----------------------------------------------------------------------------

create or replace function prevent_unpublishing_exam_with_active_attempts()
returns trigger as $$
begin
  if new.status = 'draft' and old.status != 'draft' then
    if exists (select 1 from exam_attempts where exam_id = new.id and status = 'in_progress') then
      raise exception 'لا يمكن إرجاع هذه المناظرة إلى مسودة أثناء وجود محاولات جارية للتلاميذ';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_prevent_unpublish_with_active_attempts
  before update on exams
  for each row execute function prevent_unpublishing_exam_with_active_attempts();

-- ----------------------------------------------------------------------------
-- FINDING 7 — RLS POLICY INTERACTIONS: confirmed by inspection — no
-- RESTRICTIVE policy exists anywhere in this codebase, on any table. Every
-- policy is the default PERMISSIVE, so multiple policies for the same
-- command combine with OR. Documented explicitly: adding a RESTRICTIVE
-- policy later changes this to AND-combination against all PERMISSIVE
-- ones for that command — a future maintainer doing that without knowing
-- this history could silently and drastically narrow access platform-wide.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- THREATS REVIEWED AND CONFIRMED ALREADY HANDLED (no change needed):
-- - Replay attacks: submit_exam_attempt's status guard makes a second call
--   a no-op error, not a re-trigger of grading.
-- - Attempt-limit bypass: UNIQUE(exam_id, student_id) + no student DELETE
--   policy on exam_attempts anywhere — re-verified, still correct.
-- - Direct SQL access: no raw-SQL-execution endpoint is exposed to
--   `authenticated` anywhere in this platform (standard Supabase
--   REST/RPC surface only) — a documented assumption of the deployment,
--   not something this file enforces itself.
-- - SECURITY DEFINER search_path hijacking: every DEFINER function in this
--   codebase sets `search_path = public` explicitly — re-verified across
--   all six functions.
-- ----------------------------------------------------------------------------
