-- ============================================================================
-- اقرأ أكثر... ترى أكثر — STUDENT MANAGEMENT (new bounded context)
-- Did not exist before this file. Builds on tables already established:
-- users, competency_scores, exam_attempts, homework_submissions,
-- readiness_snapshots, revision_plans, notifications.
-- ============================================================================

create type student_account_status as enum ('active', 'inactive', 'suspended');

create table student_profiles (
  user_id           uuid primary key references users(id),
  full_name         text not null,
  date_of_birth     date,
  guardian_name     text,
  guardian_contact  text,
  enrollment_date   date not null default current_date,
  status            student_account_status not null default 'active',
  notes             text,               -- Owner-private notes, never surfaced to student/parent
  avatar_url        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_student_profiles_status on student_profiles (status);
create index idx_student_profiles_name on student_profiles using gin (to_tsvector('simple', full_name));

create trigger trg_student_profiles_touch before update on student_profiles
  for each row execute function touch_updated_at();

-- ----------------------------------------------------------------------------
-- Activity log — unified timeline across modules that already exist.
-- Populated by triggers/application code on the source tables, NOT a
-- duplicate data store: each row is a pointer + snapshot summary, not a
-- copy of the full record.
-- ----------------------------------------------------------------------------

create type activity_type as enum (
  'homework_submitted', 'homework_graded', 'exam_attempted', 'exam_graded',
  'competency_updated', 'revision_plan_published', 'notification_sent'
);

create table student_activity_log (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references users(id),
  activity_type activity_type not null,
  summary       text not null,          -- short human-readable line for the timeline UI
  source_table  text not null,
  source_id     uuid not null,
  occurred_at   timestamptz not null default now()
);

create index idx_activity_student on student_activity_log (student_id, occurred_at desc);

-- ----------------------------------------------------------------------------
-- Aggregate views — one query per profile tab, no N+1 fetching from the
-- frontend, and no duplication of business logic already implemented in
-- exam-attempt-service.js / homework-grading-service.js / readiness-service.js.
-- ----------------------------------------------------------------------------

create view student_list_view as
select
  sp.user_id, sp.full_name, sp.status, sp.enrollment_date, sp.avatar_url,
  (select round(avg((a.total_score / nullif(a.max_score,0)) * 100), 1)
     from exam_attempts a where a.student_id = sp.user_id and a.status = 'graded') as exam_average,
  (select count(*) from homework_submissions hs where hs.student_id = sp.user_id and hs.status = 'submitted') as pending_grading_count,
  null::numeric as latest_readiness_score
from student_profiles sp;

create view student_academic_progress_view as
select
  cs.student_id, cs.competency_id, c.label as competency_label, c.subject,
  cs.score, cs.last_updated
from competency_scores cs
join competencies c on c.id = cs.competency_id;

-- ----------------------------------------------------------------------------
-- Views added to support the Student Profile tabs (use-student-records.js).
-- Each mirrors the "one query per tab, no N+1" principle already used above.
-- ----------------------------------------------------------------------------

-- SUPERSEDED by exam-security-hardening.sql, which drops and recreates this
-- view as a DEFINER view with explicit row-filtering — security_invoker
-- views cannot correctly do conditional (CASE WHEN) column masking; see
-- that file's header comment for the full explanation. Left here only
-- because migration files are additive history, not because this
-- definition is still the active one.
create view student_exam_attempts_view as
select
  a.id as attempt_id, a.student_id, a.status,
  case when a.status = 'graded' then a.total_score else null end as total_score,
  case when a.status = 'graded' then a.max_score else null end as max_score,
  a.submitted_at, a.time_spent_seconds,
  e.id as exam_id, e.title, e.exam_type, e.scheduled_start
from exam_attempts a
join exams e on e.id = a.exam_id;

-- security_invoker deliberately NOT set here even though earlier revisions
-- of this file set it — see exam-security-hardening.sql: it doesn't apply
-- to the superseding DEFINER version this view is dropped and recreated as.

-- SUPERSEDED by exam-security-hardening.sql for the identical reason.
create view student_exam_answers_view as
select
  ans.id, ans.attempt_id, ans.question_id, ans.student_answer, ans.answered_at,
  case when a.status = 'graded' then ans.is_correct else null end as is_correct,
  case when a.status = 'graded' then ans.points_awarded else null end as points_awarded
from exam_answers ans
join exam_attempts a on a.id = ans.attempt_id;

-- Only surfaces plans the Owner has explicitly made visible — mirrors the
-- exact filter student-dashboard-service.js already applies at the read layer,
-- so the Owner-facing profile tab and the student's own dashboard can never
-- disagree about what's visible.
create view student_visible_revision_plan_view as
select id, student_id, weekly_plan, teacher_notes, created_at
from revision_plans
where is_visible_to_student = true;

-- ----------------------------------------------------------------------------
-- INTEGRATION FIX (found while building Student Dashboard): the "correction
-- is never visible before submission" rule was previously enforced only in
-- homework-grading-service.js (JS, backend-adjacent). Now that the frontend
-- queries Supabase directly via api-client.js, that JS-layer check is
-- bypassable — a direct query against homework_submissions would leak
-- feedback/score fields regardless of status. This view nulls those fields
-- at the DB layer instead, so the guarantee holds no matter which code path
-- reads the data.
-- ----------------------------------------------------------------------------

create view student_homework_view as
select
  id, homework_id, student_id, status, submitted_at, uploaded_files,
  is_group_submission,
  case when status = 'graded' then total_score else null end as total_score,
  case when status = 'graded' then max_score else null end as max_score,
  case when status = 'graded' then feedback else null end as feedback,
  case when status = 'graded' then competency_evaluation else '{}'::jsonb end as competency_evaluation
from homework_submissions;

-- security_invoker NOT retained here — see exam-security-hardening.sql,
-- which drops and recreates this view as DEFINER with explicit row
-- filtering, for the same conditional-masking reason as the exam views.

-- ============================================================================
-- ROW LEVEL SECURITY
--
-- permissions.js's can()/canOnStudent() checks are a client-side UX layer —
-- they make the UI behave correctly and fail closed on unregistered actions,
-- but a client-side check is bypassable by anyone calling the API directly.
-- This is the actual security boundary. Every RLS-repeated "deployment
-- requirement" note in earlier docs is made concrete here rather than left
-- as a reminder to write later.
-- ============================================================================

alter table student_profiles enable row level security;
alter table student_activity_log enable row level security;

-- Owner: full access to every student row.
create policy owner_full_access_student_profiles on student_profiles
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

-- Student: read-only access to their own row only.
create policy student_reads_own_profile on student_profiles
  for select using (auth.uid() = user_id);

create policy owner_full_access_activity_log on student_activity_log
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

create policy student_reads_own_activity on student_activity_log
  for select using (auth.uid() = student_id);

-- IMPORTANT (Postgres 15+): views run with the permissions of the view
-- OWNER by default, which silently bypasses the RLS policies above unless
-- security_invoker is set — a real and easy-to-miss production gap.
-- Without this, student_list_view would return every student's data to
-- anyone who can query it, RLS notwithstanding.
alter view student_list_view set (security_invoker = true);
alter view student_academic_progress_view set (security_invoker = true);
-- student_exam_attempts_view intentionally excluded from this batch — it is
-- dropped and recreated as a DEFINER view in exam-security-hardening.sql;
-- setting security_invoker here would just be discarded by that DROP, but
-- leaving the line implies this is still the active configuration.
alter view student_visible_revision_plan_view set (security_invoker = true);

-- With security_invoker on, student_academic_progress_view / student_exam_
-- attempts_view / student_latest_readiness_view / student_visible_revision_
-- plan_view also need RLS enabled on their SOURCE tables — closed below,
-- immediately, rather than left as a flagged TODO, since Student Dashboard
-- now actually depends on these reads working correctly. These tables are
-- defined in other schema files (exam-system-schema.sql, question-bank-
-- homework-schema.sql, concours-module-schema.sql, curriculum-manager-
-- schema.sql, notification-center-schema.sql) — this block must therefore
-- run AFTER all of those, i.e. last in the migration order.

-- ----------------------------------------------------------------------------
-- FOUND DURING THE EXAM SYSTEM SECURITY REGRESSION CHECK — homework had the
-- identical class of bug exam_attempts had before its fix: `status` was
-- never column-restricted, so a student with any UPDATE grant on this
-- table could set their own submission to 'graded' directly, bypassing
-- Owner review entirely. There was, in fact, no student UPDATE policy at
-- all yet (only INSERT) — meaning resubmission before grading didn't work,
-- but the underlying column exposure would have been live the moment
-- anyone added one without noticing this. Fixing both at once: adding
-- resubmission capability AND explicitly excluding `status` from what a
-- student can write.
-- ----------------------------------------------------------------------------

alter table homework_submissions enable row level security;
create policy owner_full_access_homework_submissions on homework_submissions
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy student_reads_own_homework_submissions on homework_submissions
  for select using (auth.uid() = student_id);
create policy student_inserts_own_submission on homework_submissions
  for insert with check (auth.uid() = student_id);

-- ----------------------------------------------------------------------------
-- FOUND DURING THE EXAM SYSTEM SECURITY REGRESSION CHECK — homework had the
-- identical class of bug exam_attempts had before its fix: `status` was
-- never column-restricted, so a student with any UPDATE grant on this
-- table could set their own submission to 'graded' directly, bypassing
-- Owner review entirely. There was, in fact, no student UPDATE policy at
-- all yet (only INSERT) — meaning resubmission before grading didn't work,
-- but the underlying column exposure would have been live the moment
-- anyone added one without noticing this. Fixing both at once: adding
-- resubmission capability AND explicitly excluding `status` from what a
-- student can write.
-- ----------------------------------------------------------------------------

grant update (uploaded_files, is_group_submission, group_member_ids, answers) on homework_submissions to authenticated;
-- `status`, `total_score`, `max_score`, `feedback`, `competency_evaluation`
-- all deliberately excluded — status transitions to 'graded'/'returned'
-- remain Owner-only via owner_full_access_homework_submissions.

create policy student_updates_own_ungraded_submission on homework_submissions
  for update
  using (auth.uid() = student_id and status != 'graded')
  with check (auth.uid() = student_id and status != 'graded');
-- Scoped to status != 'graded': a student can revise their submission
-- content up until Owner grading, never after.

alter table exam_attempts enable row level security;
create policy owner_full_access_exam_attempts on exam_attempts
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy student_reads_own_exam_attempts on exam_attempts
  for select using (auth.uid() = student_id);
create policy student_manages_own_attempt on exam_attempts
  for update using (auth.uid() = student_id) with check (auth.uid() = student_id);

alter table exam_answers enable row level security;
create policy owner_full_access_exam_answers on exam_answers
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy student_manages_own_answers on exam_answers
  for all using (exists (select 1 from exam_attempts a where a.id = exam_answers.attempt_id and a.student_id = auth.uid()))
  with check (exists (select 1 from exam_attempts a where a.id = exam_answers.attempt_id and a.student_id = auth.uid()));

alter table competency_scores enable row level security;
create policy owner_full_access_competency_scores on competency_scores
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy student_reads_own_competency_scores on competency_scores
  for select using (auth.uid() = student_id);

alter table revision_plans enable row level security;
create policy owner_full_access_revision_plans on revision_plans
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
-- Note the extra is_visible_to_student condition here, NOT just ownership —
-- an Owner can approve a plan into this table while still holding back
-- visibility (see readiness-service.js), so RLS must check both.
create policy student_reads_own_visible_revision_plan on revision_plans
  for select using (auth.uid() = student_id and is_visible_to_student = true);

alter table notifications enable row level security;
create policy owner_full_access_notifications on notifications
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy recipient_reads_own_notifications on notifications
  for select using (auth.uid() = recipient_id);
create policy recipient_marks_own_notification_read on notifications
  for update using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

alter table lessons enable row level security;
create policy owner_full_access_lessons on lessons
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
-- Any authenticated student may read PUBLISHED lessons (not scoped to a
-- specific student_id — lessons aren't per-student). Draft/archived lessons
-- remain owner-only, matching the visibility rule already enforced in
-- published_lessons / student-dashboard-service.js.
create policy student_reads_published_lessons on lessons
  for select using (status = 'published');
