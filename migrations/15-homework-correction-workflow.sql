-- ============================================================================
-- اقرأ أكثر... ترى أكثر — 15: HOMEWORK CORRECTION WORKFLOW
-- New migration, additive. Run AFTER 14-lesson-publishing-modes.sql.
--
-- CRITICAL GAP CLOSED: there was no client-reachable path for a teacher to
-- grade homework at all. homework-grading-service.js exists but needs
-- columns (feedback/total_score/competency_evaluation) revoked from
-- `authenticated` — Owner shares that Postgres role with students, so the
-- revoke blocked Owner too, identical to the quiz_questions.correct_answer
-- gap found during Exam System's audit. Same fix: a SECURITY DEFINER RPC
-- checking current_user_role() = 'owner' internally.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Correction PDF as a first-class field (RC1 audit §5.4 gap, closed here)
-- ----------------------------------------------------------------------------

alter table homework_submissions add column if not exists correction_file_url text;
alter table homework_submissions add column if not exists correction_published_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. SINGLE-RECIPIENT NOTIFICATION HELPER — the parent/student-specific
-- counterpart to notify_active_students() (file 14), which fans out to
-- everyone. Both are "the notification pipeline"; neither duplicates the
-- other's job.
-- ----------------------------------------------------------------------------

create or replace function notify_user(
  p_recipient_id uuid, p_type notification_type, p_title text, p_link_table text, p_link_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (recipient_id, type, title, link_entity_table, link_entity_id)
  values (p_recipient_id, p_type, p_title, p_link_table, p_link_id);
end;
$$;

revoke all on function notify_user(uuid, notification_type, text, text, uuid) from public;

create or replace function notify_verified_parents_of_student(
  p_student_id uuid, p_type notification_type, p_title text, p_link_table text, p_link_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (recipient_id, type, title, link_entity_table, link_entity_id)
  select parent_id, p_type, p_title, p_link_table, p_link_id
  from parent_student_links where student_id = p_student_id and verified = true;
end;
$$;

revoke all on function notify_verified_parents_of_student(uuid, notification_type, text, text, uuid) from public;

-- ----------------------------------------------------------------------------
-- 3. THE GRADING RPC — the single place feedback/scores/correction get
-- written. Ports homework-grading-service.js's grade() + its qualitative-
-- rubric-to-competency-score conversion, which is the actual reason that
-- file was ever marked server-side — this RPC is now the reference
-- implementation's enforced equivalent, same relationship as
-- submit_exam_attempt is to exam-attempt-service.js.
-- ----------------------------------------------------------------------------

create or replace function owner_grade_homework(
  p_submission_id uuid,
  p_total_score numeric,
  p_max_score numeric,
  p_feedback text,
  p_competency_evaluation jsonb,
  p_correction_file_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission homework_submissions;
  v_competency_id text;
  v_level text;
  v_score numeric;
  v_lesson_title text;
begin
  if current_user_role() != 'owner' then
    raise exception 'ليست لديك صلاحية تصحيح هذا الواجب';
  end if;

  select * into v_submission from homework_submissions where id = p_submission_id;
  if not found then
    raise exception 'التسليم غير موجود';
  end if;

  update homework_submissions set
    status = 'graded', total_score = p_total_score, max_score = p_max_score,
    feedback = p_feedback, competency_evaluation = p_competency_evaluation,
    correction_file_url = p_correction_file_url,
    correction_published_at = case when p_correction_file_url is not null then now() else null end,
    graded_at = now()
  where id = p_submission_id;

  -- Same LEVEL_TO_SCORE mapping as homework-grading-service.js's
  -- _refreshCompetencyScores — kept numerically identical intentionally,
  -- so the JS reference implementation and this enforced version agree.
  for v_competency_id, v_level in select * from jsonb_each_text(p_competency_evaluation) loop
    v_score := case v_level
      when 'exceeds' then 95
      when 'meets' then 75
      when 'below' then 45
      else null
    end;
    if v_score is not null then
      insert into competency_scores (student_id, competency_id, score, last_updated)
      values (v_submission.student_id, v_competency_id::uuid, v_score, now())
      on conflict (student_id, competency_id) do update set score = excluded.score, last_updated = excluded.last_updated;
    end if;
  end loop;

  select l.title into v_lesson_title from lessons l where l.homework_id = v_submission.homework_id limit 1;

  perform notify_user(v_submission.student_id, 'homework_graded', 'تم تصحيح واجبك: ' || coalesce(v_lesson_title, ''), 'homework_submissions', p_submission_id);
  if p_correction_file_url is not null then
    perform notify_user(v_submission.student_id, 'correction_published', 'تم نشر تصحيح الواجب: ' || coalesce(v_lesson_title, ''), 'homework_submissions', p_submission_id);
  end if;
  perform notify_verified_parents_of_student(v_submission.student_id, 'homework_graded', 'تم تصحيح واجب ابنك/ابنتك: ' || coalesce(v_lesson_title, ''), 'homework_submissions', p_submission_id);

  insert into security_audit_log (actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'owner_grade_homework', 'homework_submissions', p_submission_id,
          jsonb_build_object('totalScore', p_total_score, 'maxScore', p_max_score, 'hasCorrection', p_correction_file_url is not null));
end;
$$;

revoke all on function owner_grade_homework(uuid, numeric, numeric, text, jsonb, text) from public;
grant execute on function owner_grade_homework(uuid, numeric, numeric, text, jsonb, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. WIRE "Homework Assigned" TO PARENTS TOO — file 14's
-- publish_lesson_internal only notified students. Extending it here
-- (create or replace, same function, same single location) rather than
-- adding a parallel path.
-- ----------------------------------------------------------------------------

create or replace function publish_lesson_internal(p_lesson_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson lessons;
  v_student record;
begin
  select * into v_lesson from lessons where id = p_lesson_id for update;
  if not found then
    raise exception 'الدرس غير موجود';
  end if;
  if v_lesson.status not in ('draft', 'scheduled') then
    raise exception 'لا يمكن نشر درس ليس في حالة مسودة أو مجدول';
  end if;

  update lessons set status = 'published', published_at = now() where id = p_lesson_id;

  perform notify_active_students('new_lesson', 'درس جديد: ' || v_lesson.title, 'lessons', p_lesson_id);

  if v_lesson.homework_id is not null then
    perform notify_active_students('homework_assigned', 'واجب جديد: ' || v_lesson.title, 'lessons', p_lesson_id);
    -- Parent notification, per this milestone's explicit "Homework
    -- Assigned" entry in the parent list — one insert per active student's
    -- verified parents, reusing notify_verified_parents_of_student (§2
    -- above) rather than duplicating that fan-out logic here.
    for v_student in select user_id from student_profiles where status = 'active' loop
      perform notify_verified_parents_of_student(v_student.user_id, 'homework_assigned', 'واجب جديد لابنك/ابنتك: ' || v_lesson.title, 'lessons', p_lesson_id);
    end loop;
  end if;

  insert into security_audit_log (actor_id, action, entity_table, entity_id, metadata)
  values (p_actor_id, 'lesson_published', 'lessons', p_lesson_id,
          jsonb_build_object('title', v_lesson.title, 'trigger', case when p_actor_id is null then 'scheduled_job' else 'manual' end));
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Extend student_homework_view / RLS grants for the two new columns —
-- masked identically to feedback/total_score (hidden until graded).
-- ----------------------------------------------------------------------------

revoke select (correction_file_url, correction_published_at) on homework_submissions from authenticated;
-- Deliberately revoked even though it might seem safe — a correction PDF
-- IS the answer key for that homework, in effect. Same reasoning as
-- quiz_questions.correct_answer, applied here.

drop view if exists student_homework_view;
create view student_homework_view as
select
  id, homework_id, student_id, status, submitted_at, uploaded_files, is_group_submission,
  case when status = 'graded' then total_score else null end as total_score,
  case when status = 'graded' then max_score else null end as max_score,
  case when status = 'graded' then feedback else null end as feedback,
  case when status = 'graded' then competency_evaluation else '{}'::jsonb end as competency_evaluation,
  case when status = 'graded' then correction_file_url else null end as correction_file_url,
  case when status = 'graded' then correction_published_at else null end as correction_published_at
from homework_submissions
where student_id = auth.uid()
   or current_user_role() = 'owner'
   or is_verified_parent_of(student_id);

-- ----------------------------------------------------------------------------
-- 6. TEACHER CORRECTION QUEUE — two small, Owner-only views (reuse
-- existing tables entirely, zero new query patterns invented).
-- ----------------------------------------------------------------------------

create view owner_pending_correction_view as
select hs.id as submission_id, hs.homework_id, hs.student_id, sp.full_name as student_name,
       hs.submitted_at, l.title as lesson_title
from homework_submissions hs
join student_profiles sp on sp.user_id = hs.student_id
left join lessons l on l.homework_id = hs.homework_id
where hs.status = 'submitted' and current_user_role() = 'owner';
alter view owner_pending_correction_view set (security_invoker = true);
-- No conditional column masking; a non-owner session simply gets zero
-- rows via the WHERE clause (matching owner_readiness_ranking_view's
-- already-verified reasoning in Concours Module).

create view owner_non_submitters_view as
select h.id as homework_id, h.title as homework_title, sp.user_id as student_id, sp.full_name as student_name
from homework h
cross join student_profiles sp
where h.status in ('assigned', 'closed')
  and sp.status = 'active'
  and current_user_role() = 'owner'
  and not exists (
    select 1 from homework_submissions hs where hs.homework_id = h.id and hs.student_id = sp.user_id
  );
alter view owner_non_submitters_view set (security_invoker = true);
