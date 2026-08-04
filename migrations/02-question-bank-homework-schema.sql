-- ============================================================================
-- اقرأ أكثر... ترى أكثر — QUESTION BANK & HOMEWORK SYSTEM (Phase 10+)
-- Built now because both the AI Module (QuestionBankAdapter) and the Exam
-- System (exam_section_questions) already assume these tables exist.
-- ============================================================================

create type question_type as enum ('mcq', 'true_false', 'short_answer', 'fill_blank');
create type question_source as enum ('owner_authored', 'ai_generated');
create type homework_status as enum ('draft', 'assigned', 'closed', 'archived');
create type submission_status as enum ('not_submitted', 'submitted', 'graded', 'returned');

-- ----------------------------------------------------------------------------
-- 1. COMPETENCIES — created first; quiz_questions references it below
-- ----------------------------------------------------------------------------

create table competencies (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  field         text not null,            -- 'اللغة', 'العلوم', 'التربية الاجتماعية', ...
  subject       text not null,
  grade         integer not null default 6,
  keywords      text[] default '{}',      -- used by AI validator's objective-alignment check
  description   text,
  created_at    timestamptz not null default now()
);

create index idx_competencies_subject on competencies (subject);
create index idx_competencies_field on competencies (field);
create index idx_competencies_keywords on competencies using gin (keywords);

-- ----------------------------------------------------------------------------
-- 2. QUESTION BANK
-- ----------------------------------------------------------------------------

create table quiz_questions (
  id                uuid primary key default gen_random_uuid(),
  prompt            text not null,
  type              question_type not null,
  options           jsonb,               -- array of option strings, mcq only
  correct_answer    text not null,
  competency_id     uuid not null references competencies(id),
  difficulty        text not null check (difficulty in ('easy', 'medium', 'hard')),
  rationale         text,

  source            question_source not null default 'owner_authored',
  source_draft_id   uuid references ai_draft_queue(id),  -- set when source = 'ai_generated'

  is_active         boolean not null default true,
  usage_count        integer not null default 0,          -- how many exams/quizzes/homework use it

  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_questions_competency on quiz_questions (competency_id);
create index idx_questions_type on quiz_questions (type);
create index idx_questions_source on quiz_questions (source);
create index idx_questions_active on quiz_questions (competency_id) where is_active = true;
-- Trigram index enables real similarity search for duplicate detection,
-- replacing the exact/near-string matching the AI Module currently stubs
-- via db.similarQuestionExists.
create extension if not exists pg_trgm;
create index idx_questions_prompt_trgm on quiz_questions using gin (prompt gin_trgm_ops);

create trigger trg_questions_touch before update on quiz_questions
  for each row execute function touch_updated_at();

-- ----------------------------------------------------------------------------
-- 3. HOMEWORK
-- ----------------------------------------------------------------------------

create table homework (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  status          homework_status not null default 'draft',
  owner_id        uuid not null references users(id),
  source_draft_id uuid references ai_draft_queue(id),

  instructions    text,
  competency_ids  uuid[] default '{}',

  assigned_at     timestamptz,
  due_at          timestamptz,

  allows_photo_upload boolean not null default true,
  allows_pdf_upload    boolean not null default true,
  allows_group_submission boolean not null default false,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_homework_owner on homework (owner_id);
create index idx_homework_status on homework (status);
create index idx_homework_due on homework (due_at);

create trigger trg_homework_touch before update on homework
  for each row execute function touch_updated_at();

-- ----------------------------------------------------------------------------
-- 4. HOMEWORK QUESTIONS — reuses quiz_questions, same reuse principle as exams
-- ----------------------------------------------------------------------------

create table homework_questions (
  id              uuid primary key default gen_random_uuid(),
  homework_id     uuid not null references homework(id) on delete cascade,
  question_id     uuid not null references quiz_questions(id),
  display_order   integer not null default 0,
  points          numeric(5,2) not null default 1,
  unique (homework_id, question_id)
);

create index idx_hw_questions_homework on homework_questions (homework_id, display_order);

-- ----------------------------------------------------------------------------
-- 5. HOMEWORK SUBMISSIONS
-- ----------------------------------------------------------------------------

create table homework_submissions (
  id              uuid primary key default gen_random_uuid(),
  homework_id     uuid not null references homework(id),
  student_id      uuid not null references users(id),
  status          submission_status not null default 'not_submitted',

  answers         jsonb,                 -- per-question answers, same shape as exam_answers.student_answer
  uploaded_files  jsonb default '[]',    -- [{ file_url, file_type, uploaded_at }]
  is_group_submission boolean not null default false,
  group_member_ids uuid[] default '{}',

  submitted_at    timestamptz,
  graded_at       timestamptz,
  total_score     numeric(6,2),
  max_score       numeric(6,2),
  feedback        text,                  -- Owner's written feedback

  -- Rubric / competency evaluation, distinct from raw score
  competency_evaluation jsonb default '{}', -- { competency_id: 'exceeds'|'meets'|'below' }

  created_at      timestamptz not null default now(),
  unique (homework_id, student_id)
);

create index idx_submissions_homework on homework_submissions (homework_id);
create index idx_submissions_student on homework_submissions (student_id);
create index idx_submissions_status on homework_submissions (status);

-- Correction must never be visible before submission — enforced at the
-- application layer by never returning `feedback`/`total_score`/
-- `competency_evaluation` for a submission where status != 'graded',
-- regardless of what the student's own row otherwise contains.

-- ----------------------------------------------------------------------------
-- 6. COMPETENCY SCORES — the shared table the AI Module's weakness-analysis
--    prompt reads, refreshed by BOTH the Exam System (attempt_competency_
--    breakdown) and Homework grading below.
-- ----------------------------------------------------------------------------

create table competency_scores (
  student_id      uuid not null references users(id),
  competency_id   uuid not null references competencies(id),
  score           numeric(5,2) not null,
  last_updated    timestamptz not null default now(),
  primary key (student_id, competency_id)
);

create index idx_competency_scores_student on competency_scores (student_id);
