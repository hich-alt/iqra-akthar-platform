-- ============================================================================
-- اقرأ أكثر... ترى أكثر — STUDENT MANAGEMENT (new bounded context)
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
  notes             text,               
  avatar_url        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_student_profiles_status on student_profiles (status);
create index idx_student_profiles_name on student_profiles using gin (to_tsvector('simple', full_name));

create trigger trg_student_profiles_touch before update on student_profiles
  for each row execute function touch_updated_at();

-- ----------------------------------------------------------------------------
-- Activity log
-- ----------------------------------------------------------------------------

create type activity_type as enum (
  'homework_submitted', 'homework_graded', 'exam_attempted', 'exam_graded',
  'competency_updated', 'revision_plan_published', 'notification_sent'
);

create table student_activity_log (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references users(id),
  activity_type activity_type not null,
  summary       text not null,          
  source_table  text not null,
  source_id     uuid not null,
  occurred_at   timestamptz not null default now()
);

create index idx_activity_student on student_activity_log (student_id, occurred_at desc);

-- ----------------------------------------------------------------------------
-- Aggregate views
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
-- Views added to support the Student Profile tabs 
-- ----------------------------------------------------------------------------

create view student_exam_attempts_view as
select
  a.id as attempt_id, a.student_id, a.status,
  case when a.status = 'graded' then a.total_score else null end as total_score,
  case when a.status = 'graded' then a.max_score else null end as max_score,
  a.submitted_at, a.time_spent_seconds,
  e.id as exam_id, e.title, e.exam_type, e.scheduled_start
from exam_attempts a
join exams e on e.id = a.exam_id;

create view student_exam_answers_view as
select
  ans.id, ans.attempt_id, ans.question_id, ans.student_answer, ans.answered_at,
  case when a.status = 'graded' then ans.is_correct else null end as is_correct,
  case when a.status = 'graded' then ans.points_awarded else null end as points_awarded
from exam_answers ans
join exam_attempts a on a.id = ans.attempt_id;

create view student_homework_view as
select
  id, homework_id, student_id, status, submitted_at, uploaded_files,
  is_group_submission,
  case when status = 'graded' then total_score else null end as total_score,
  case when status = 'graded' then max_score else null end as max_score,
  case when status = 'graded' then feedback else null end as feedback,
  case when status = 'graded' then competency_evaluation else '{}'::jsonb end as competency_evaluation
from homework_submissions;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table student_profiles enable row level security;
alter table student_activity_log enable row level security;

create policy owner_full_access_student_profiles on student_profiles
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

create policy student_reads_own_profile on student_profiles
  for select using (auth.uid() = user_id);

create policy owner_full_access_activity_log on student_activity_log
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

create policy student_reads_own_activity on student_activity_log
  for select using (auth.uid() = student_id);

alter view student_list_view set (security_invoker = true);
alter view student_academic_progress_view set (security_invoker = true);

-- ----------------------------------------------------------------------------
-- HOMEWORK RLS
-- ----------------------------------------------------------------------------

alter table homework_submissions enable row level security;
create policy owner_full_access_homework_submissions on homework_submissions
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy student_reads_own_homework_submissions on homework_submissions
  for select using (auth.uid() = student_id);
create policy student_inserts_own_submission on homework_submissions
  for insert with check (auth.uid() = student_id);

grant update (uploaded_files, is_group_submission, group_member_ids, answers) on homework_submissions to authenticated;

create policy student_updates_own_ungraded_submission on homework_submissions
  for update
  using (auth.uid() = student_id and status != 'graded')
  with check (auth.uid() = student_id and status != 'graded');

-- ----------------------------------------------------------------------------
-- EXAM RLS
-- ----------------------------------------------------------------------------

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

-- ----------------------------------------------------------------------------
-- COMPETENCY & LESSONS RLS
-- (Lessons table was created in migration 03, so it is safe here)
-- ----------------------------------------------------------------------------

alter table competency_scores enable row level security;
create policy owner_full_access_competency_scores on competency_scores
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy student_reads_own_competency_scores on competency_scores
  for select using (auth.uid() = student_id);

alter table lessons enable row level security;
create policy owner_full_access_lessons on lessons
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy student_reads_published_lessons on lessons
  for select using (status = 'published');
