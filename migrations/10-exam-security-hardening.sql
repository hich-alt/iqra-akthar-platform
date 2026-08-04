-- ============================================================================
-- اقرأ أكثر... ترى أكثر — EXAM SYSTEM SECURITY HARDENING
-- Continuation of security-hardening.sql. Run after it (and after
-- exam-system-schema.sql / student-management-schema.sql).
--
-- THE CORE LESSON THIS FILE ENCODES: `security_invoker` views only work for
-- masking a column when the invoker has NO privilege on it at all (the view
-- simply never touches it — fine for quiz_questions_safe_view, which never
-- selects correct_answer). For CONDITIONAL masking (CASE WHEN status =
-- 'graded' THEN col ELSE null), the view's query still references the real
-- column, so Postgres still requires SELECT privilege on it for the invoker
-- — meaning either the query errors (if revoked) or the masking is purely
-- cosmetic (if not revoked, since a direct table query then returns it
-- unmasked too). The fix: these views must run as DEFINER (the default,
-- no security_invoker), with row-level filtering written explicitly into
-- the view's WHERE clause instead of inherited from RLS-as-invoker.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. exam_attempts — stop students writing status/scores directly
-- ----------------------------------------------------------------------------

alter table exam_attempts add column if not exists is_late boolean not null default false;

-- The previous student_manages_own_attempt policy allowed UPDATE on every
-- column. Replaced: students can no longer UPDATE this table directly at
-- all (column privilege closes the gap even if a future policy change
-- reopens row access by accident) — every legitimate write goes through
-- start_exam_attempt()/submit_exam_attempt() below.
drop policy if exists student_manages_own_attempt on exam_attempts;

revoke update on exam_attempts from authenticated;
revoke select (total_score, max_score) on exam_attempts from authenticated;
grant select (id, exam_id, student_id, status, submitted_at, time_spent_seconds, is_late, is_offline_sync_pending, last_autosave_at, started_at) on exam_attempts to authenticated;
grant update (last_autosave_at, is_offline_sync_pending) on exam_attempts to authenticated;
-- No student INSERT grant either — start_exam_attempt() is SECURITY
-- DEFINER and inserts on the student's behalf after validating the exam
-- is actually released, closing the "start an attempt on a draft exam by
-- guessing its id" path too.
revoke insert on exam_attempts from authenticated;

-- ----------------------------------------------------------------------------
-- 2. exam_answers — stop students writing is_correct/points_awarded, and
-- stop them writing anything at all once the attempt is no longer in_progress
-- ----------------------------------------------------------------------------

drop policy if exists student_manages_own_answers on exam_answers;

revoke select (is_correct, points_awarded) on exam_answers from authenticated;
grant select (id, attempt_id, question_id, student_answer, answered_at) on exam_answers to authenticated;

create policy student_reads_own_answers on exam_answers
  for select using (exists (select 1 from exam_attempts a where a.id = exam_answers.attempt_id and a.student_id = auth.uid()));

-- Insert/update are row- AND state-gated: only while the parent attempt is
-- still in_progress. This is the actual fix for "bypass submission rules" —
-- previously nothing checked attempt status at all here.
create policy student_answers_while_in_progress_insert on exam_answers
  for insert with check (
    exists (select 1 from exam_attempts a where a.id = exam_answers.attempt_id and a.student_id = auth.uid() and a.status = 'in_progress')
  );
create policy student_answers_while_in_progress_update on exam_answers
  for update
  using (exists (select 1 from exam_attempts a where a.id = exam_answers.attempt_id and a.student_id = auth.uid() and a.status = 'in_progress'))
  with check (exists (select 1 from exam_attempts a where a.id = exam_answers.attempt_id and a.student_id = auth.uid() and a.status = 'in_progress'));
grant insert (attempt_id, question_id, student_answer, answered_at) on exam_answers to authenticated;
grant update (student_answer, answered_at) on exam_answers to authenticated;

-- ----------------------------------------------------------------------------
-- 3. RPCs — the only way status/scores/grading actually get written.
-- All SECURITY DEFINER: they run with the owning role's full table access,
-- unaffected by the column revokes above, which is exactly why the checks
-- INSIDE each function are what stands between a student and a bypass —
-- not the (still real, still necessary) column/row restrictions themselves.
-- ----------------------------------------------------------------------------

create or replace function start_exam_attempt(p_exam_id uuid)
returns exam_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt exam_attempts;
  v_exam_status exam_status;
begin
  select status into v_exam_status from exams where id = p_exam_id;
  if v_exam_status is null then
    raise exception 'المناظرة غير موجودة';
  end if;
  if v_exam_status not in ('scheduled', 'active') then
    raise exception 'هذه المناظرة غير متاحة حاليًا';
  end if;

  select * into v_attempt from exam_attempts where exam_id = p_exam_id and student_id = auth.uid();
  if found then
    if v_attempt.status = 'not_started' then
      update exam_attempts set status = 'in_progress', started_at = now()
        where id = v_attempt.id returning * into v_attempt;
    end if;
    return v_attempt; -- resume: existing in_progress/submitted/graded attempt returned as-is
  end if;

  insert into exam_attempts (exam_id, student_id, status, started_at)
  values (p_exam_id, auth.uid(), 'in_progress', now())
  returning * into v_attempt;
  return v_attempt;
end;
$$;

revoke all on function start_exam_attempt(uuid) from public;
grant execute on function start_exam_attempt(uuid) to authenticated;

-- SUPERSEDED by exam-threat-model-fixes.sql: the redefined version adds an
-- advisory lock shared with autosave_exam_answer (closing the autosave-vs-
-- submit race) and a security_audit_log entry.
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
  select * into v_attempt from exam_attempts where id = p_attempt_id;
  if not found or v_attempt.student_id != auth.uid() then
    raise exception 'المحاولة غير موجودة أو لا تخصك';
  end if;
  if v_attempt.status != 'in_progress' then
    raise exception 'لا يمكن تسليم محاولة غير جارية';
  end if;

  select * into v_exam from exams where id = v_attempt.exam_id;
  v_is_late := v_exam.duration_minutes is not null
    and now() > (v_attempt.started_at + (v_exam.duration_minutes || ' minutes')::interval);
  -- Late submissions are recorded, not blocked — a hard block would punish
  -- legitimate connectivity issues; is_late gives the Owner the information
  -- needed to decide, at the authoritative layer, not hidden from them.

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

  return jsonb_build_object('totalScore', v_total, 'maxScore', v_max, 'pendingManualGrading', v_pending_manual, 'isLate', v_is_late);
end;
$$;

revoke all on function submit_exam_attempt(uuid) from public;
grant execute on function submit_exam_attempt(uuid) to authenticated;
-- NOTE: this ports exam-attempt-service.js's autoGrade logic into SQL
-- deliberately — see CLIENT-SERVER-BOUNDARY.md for why relying on a
-- separate JS worker here would leave a window where a client-set
-- 'submitted' status isn't actually graded yet. exam-attempt-service.js's
-- _compareAnswer/autoGrade remain as the readable reference implementation
-- (and what ai-module-style unit tests exercise) but this function, not
-- that file, is what's actually enforced.

-- SUPERSEDED by exam-threat-model-fixes.sql: validates p_answer_id exists
-- before mutating (this original silently no-op'd on bad input) and writes
-- a security_audit_log entry.
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

  update exam_answers set is_correct = p_is_correct, points_awarded = p_points
    where id = p_answer_id returning attempt_id into v_attempt_id;

  select count(*) into v_remaining from exam_answers where attempt_id = v_attempt_id and is_correct is null;
  if v_remaining = 0 then
    select sum(points_awarded) into v_total from exam_answers where attempt_id = v_attempt_id;
    update exam_attempts set status = 'graded', total_score = v_total where id = v_attempt_id;
  end if;
end;
$$;

revoke all on function owner_manual_grade_answer(uuid, boolean, numeric) from public;
grant execute on function owner_manual_grade_answer(uuid, boolean, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Corrected masking views — DEFINER (no security_invoker), explicit
-- row-filtering baked in, since invoker semantics cannot both mask a
-- column AND allow the invoker to read it conditionally.
-- ----------------------------------------------------------------------------

drop view if exists student_exam_attempts_view;
create view student_exam_attempts_view as
select
  a.id as attempt_id, a.student_id, a.status,
  case when a.status = 'graded' then a.total_score else null end as total_score,
  case when a.status = 'graded' then a.max_score else null end as max_score,
  a.submitted_at, a.time_spent_seconds, a.is_late,
  e.id as exam_id, e.title, e.exam_type, e.scheduled_start
from exam_attempts a
join exams e on e.id = a.exam_id
where a.student_id = auth.uid()
   or current_user_role() = 'owner'
   or is_verified_parent_of(a.student_id);

drop view if exists student_exam_answers_view;
create view student_exam_answers_view as
select
  ans.id, ans.attempt_id, ans.question_id, ans.student_answer, ans.answered_at,
  case when a.status = 'graded' then ans.is_correct else null end as is_correct,
  case when a.status = 'graded' then ans.points_awarded else null end as points_awarded
from exam_answers ans
join exam_attempts a on a.id = ans.attempt_id
where a.student_id = auth.uid()
   or current_user_role() = 'owner'
   or is_verified_parent_of(a.student_id);

-- student_homework_view (student-management-schema.sql) has the identical
-- flaw: security_invoker=true with conditional masking, and the base
-- table's feedback/total_score/max_score/competency_evaluation columns
-- were never revoked from `authenticated` — meaning that view's masking
-- was cosmetic; a direct query to homework_submissions already returned
-- everything unmasked. Fixed the same way:

revoke select (feedback, total_score, max_score, competency_evaluation) on homework_submissions from authenticated;
grant select (id, homework_id, student_id, status, submitted_at, uploaded_files, is_group_submission, group_member_ids, created_at) on homework_submissions to authenticated;

drop view if exists student_homework_view;
create view student_homework_view as
select
  id, homework_id, student_id, status, submitted_at, uploaded_files, is_group_submission,
  case when status = 'graded' then total_score else null end as total_score,
  case when status = 'graded' then max_score else null end as max_score,
  case when status = 'graded' then feedback else null end as feedback,
  case when status = 'graded' then competency_evaluation else '{}'::jsonb end as competency_evaluation
from homework_submissions
where student_id = auth.uid()
   or current_user_role() = 'owner'
   or is_verified_parent_of(student_id);

-- ----------------------------------------------------------------------------
-- 5. Owner's privileged path to quiz_questions.correct_answer — needed for
-- question authoring, which the earlier blanket REVOKE also silently broke
-- for Owner (Owner and Student share the `authenticated` Postgres role;
-- the REVOKE cannot distinguish them — same reason get_student_notes()
-- exists rather than an RLS policy).
-- ----------------------------------------------------------------------------

create view owner_quiz_questions_view as
select * from quiz_questions
where current_user_role() = 'owner';
-- DEFINER (no security_invoker): must run with elevated privilege to read
-- correct_answer/rationale at all, since those are revoked from
-- `authenticated` at the table level. The WHERE clause is what actually
-- keeps a non-owner from getting rows back — remove it and this becomes
-- the exact vulnerability this whole file exists to prevent.

-- ----------------------------------------------------------------------------
-- 6. Attempt-limit note: exam_attempts already has UNIQUE(exam_id,
-- student_id) (exam-system-schema.sql), and there is no student DELETE
-- policy anywhere on this table — absence of a policy means RLS denies by
-- default, so a student cannot delete their attempt and start over. This
-- was already correct; verified, not changed.
-- ----------------------------------------------------------------------------
