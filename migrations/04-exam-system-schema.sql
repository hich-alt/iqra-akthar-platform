-- ============================================================================
-- اقرأ أكثر... ترى أكثر — ASSESSMENT / EXAM SYSTEM (Phase 10+)
-- Bounded context: Exams, Sections, Attempts, Grading, Results
--
-- Integrates with:
-- - quiz_questions (Question Bank) — exam sections pull questions from here
-- - ai_draft_queue — approved mock_exam drafts publish into exams/exam_sections
-- - competency_scores — every graded attempt updates per-competency scores,
--   which is what feeds the AI Module's weakness_analysis prompts
-- ============================================================================

create type exam_type as enum ('quiz', 'homework_exam', 'mock_concours', 'official_concours');
create type exam_status as enum ('draft', 'scheduled', 'active', 'closed', 'archived');
create type attempt_status as enum ('not_started', 'in_progress', 'submitted', 'graded', 'abandoned');

-- ----------------------------------------------------------------------------
-- 1. EXAMS
-- ----------------------------------------------------------------------------

create table exams (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  exam_type       exam_type not null,
  status          exam_status not null default 'draft',

  owner_id        uuid not null references users(id),
  source_draft_id uuid references ai_draft_queue(id),  -- set if published from an AI mock_exam draft

  total_points    numeric(6,2) not null default 0,
  duration_minutes integer,

  scheduled_start timestamptz,
  scheduled_end   timestamptz,

  instructions    text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_exams_owner on exams (owner_id);
create index idx_exams_status on exams (status);
create index idx_exams_type on exams (exam_type);
create index idx_exams_schedule on exams (scheduled_start, scheduled_end);

-- ----------------------------------------------------------------------------
-- 2. EXAM SECTIONS
-- ----------------------------------------------------------------------------

create table exam_sections (
  id              uuid primary key default gen_random_uuid(),
  exam_id         uuid not null references exams(id) on delete cascade,
  subject         text not null,
  display_order   integer not null default 0,
  duration_minutes integer,
  total_points    numeric(6,2) not null default 0,
  instructions    text
);

create index idx_sections_exam on exam_sections (exam_id, display_order);

-- ----------------------------------------------------------------------------
-- 3. EXAM QUESTIONS — join table, questions live in quiz_questions
--    (Question Bank), never duplicated here, per the "reuse existing
--    services" instruction from the AI Module phase.
-- ----------------------------------------------------------------------------

create table exam_section_questions (
  id              uuid primary key default gen_random_uuid(),
  section_id      uuid not null references exam_sections(id) on delete cascade,
  question_id     uuid not null references quiz_questions(id),
  display_order   integer not null default 0,
  points          numeric(5,2) not null default 1,
  unique (section_id, question_id)
);

create index idx_section_questions_section on exam_section_questions (section_id, display_order);
create index idx_section_questions_question on exam_section_questions (question_id);

-- ----------------------------------------------------------------------------
-- 4. STUDENT ATTEMPTS
-- ----------------------------------------------------------------------------

create table exam_attempts (
  id              uuid primary key default gen_random_uuid(),
  exam_id         uuid not null references exams(id),
  student_id      uuid not null references users(id),
  status          attempt_status not null default 'not_started',

  started_at      timestamptz,
  submitted_at    timestamptz,
  time_spent_seconds integer,

  total_score     numeric(6,2),
  max_score       numeric(6,2),

  -- autosave / resume support
  last_autosave_at timestamptz,
  is_offline_sync_pending boolean not null default false,

  created_at      timestamptz not null default now(),
  unique (exam_id, student_id)
);

create index idx_attempts_exam on exam_attempts (exam_id);
create index idx_attempts_student on exam_attempts (student_id);
create index idx_attempts_status on exam_attempts (status);
create index idx_attempts_offline_pending on exam_attempts (student_id) where is_offline_sync_pending = true;

-- ----------------------------------------------------------------------------
-- 5. STUDENT ANSWERS — one row per question per attempt, autosaved
-- ----------------------------------------------------------------------------

create table exam_answers (
  id              uuid primary key default gen_random_uuid(),
  attempt_id      uuid not null references exam_attempts(id) on delete cascade,
  question_id     uuid not null references quiz_questions(id),

  student_answer  jsonb,             -- shape depends on question type (mcq/short_answer/etc)
  is_correct      boolean,           -- null until graded
  points_awarded  numeric(5,2),

  answered_at     timestamptz,
  unique (attempt_id, question_id)
);

create index idx_answers_attempt on exam_answers (attempt_id);
create index idx_answers_question on exam_answers (question_id);

-- ----------------------------------------------------------------------------
-- 6. TRIGGER — updated_at freshness
-- ----------------------------------------------------------------------------

create trigger trg_exams_touch before update on exams
  for each row execute function touch_updated_at(); -- reuses function defined in ai-module-schema.sql

-- ----------------------------------------------------------------------------
-- 7. VIEW — feeds competency_scores, which the AI Module's weakness
--    analysis prompt already consumes (see concours-ai-prompts.js)
-- ----------------------------------------------------------------------------

create view attempt_competency_breakdown as
select
  a.student_id,
  q.competency_id,
  count(*) as questions_attempted,
  count(*) filter (where ans.is_correct) as questions_correct,
  round(count(*) filter (where ans.is_correct)::numeric / nullif(count(*), 0) * 100, 1) as score_pct
from exam_answers ans
join exam_attempts a on a.id = ans.attempt_id
join quiz_questions q on q.id = ans.question_id
where a.status = 'graded'
group by a.student_id, q.competency_id;

-- NOTE: competency_scores (referenced by the AI Module's weakness-analysis
-- prompt) should be refreshed FROM this view on a schedule, e.g.:
--   insert into competency_scores (student_id, competency_id, score, last_updated)
--   select student_id, competency_id, score_pct, now()
--   from attempt_competency_breakdown
--   on conflict (student_id, competency_id) do update
--     set score = excluded.score, last_updated = excluded.last_updated;
