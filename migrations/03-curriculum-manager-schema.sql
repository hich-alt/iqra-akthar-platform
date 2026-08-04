-- ============================================================================
-- اقرأ أكثر... ترى أكثر — CURRICULUM MANAGER (Phase 10+)
-- Structure: Academic Year -> Field -> Subject -> Term -> Week -> Lesson
-- Every other module (Question Bank, Homework, Exams, AI Module) references
-- lessons/competencies that live here.
-- ============================================================================

create type lesson_status as enum ('draft', 'published', 'archived');

create table academic_years (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,             -- e.g. '2026-2027'
  start_date    date not null,
  end_date      date not null,
  is_current    boolean not null default false
);

create unique index idx_one_current_year on academic_years (is_current) where is_current = true;

create table educational_fields (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,             -- 'اللغة', 'العلوم', 'التربية الاجتماعية', 'اللغات الأجنبية'
  display_order integer not null default 0
);

create table subjects (
  id            uuid primary key default gen_random_uuid(),
  field_id      uuid not null references educational_fields(id),
  name          text not null,
  display_order integer not null default 0
);

create index idx_subjects_field on subjects (field_id);

create table terms (
  id                uuid primary key default gen_random_uuid(),
  academic_year_id  uuid not null references academic_years(id),
  term_number       integer not null check (term_number in (1, 2, 3)),
  start_date        date,
  end_date          date,
  unique (academic_year_id, term_number)
);

create table curriculum_weeks (
  id            uuid primary key default gen_random_uuid(),
  term_id       uuid not null references terms(id),
  week_number   integer not null,
  start_date    date,
  unique (term_id, week_number)
);

create table lessons (
  id              uuid primary key default gen_random_uuid(),
  week_id         uuid not null references curriculum_weeks(id),
  subject_id      uuid not null references subjects(id),
  competency_ids  uuid[] default '{}',      -- references competencies(id) from question-bank-homework-schema.sql

  title           text not null,
  status          lesson_status not null default 'draft',
  content_body    text,                     -- rich text / markdown lesson content
  attachments     jsonb default '[]',        -- [{ file_url, file_type, label }]

  owner_id        uuid not null references users(id),
  display_order   integer not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_lessons_week on lessons (week_id, display_order);
create index idx_lessons_subject on lessons (subject_id);
create index idx_lessons_status on lessons (status);
create index idx_lessons_competencies on lessons using gin (competency_ids);

create trigger trg_lessons_touch before update on lessons
  for each row execute function touch_updated_at();

-- ----------------------------------------------------------------------------
-- Student-facing visibility rule, enforced at the query layer:
-- students may only ever see lessons where status = 'published'. Draft
-- lessons (including any AI-assisted drafts an Owner is still editing) must
-- never appear in student-facing queries, mirroring the ai_draft_queue rule
-- that nothing reaches a student without explicit Owner publication.
-- ----------------------------------------------------------------------------

create view published_lessons as
select * from lessons where status = 'published';

alter view published_lessons set (security_invoker = true);

-- ----------------------------------------------------------------------------
-- Added for Lesson Editor (Owner authoring screen): flat, joined list so the
-- UI can group by field/subject/week client-side from ONE query instead of
-- five separate round trips (fields, subjects, weeks, terms, years). Security
-- is unaffected by this being a single view: security_invoker means a
-- student session querying it still only sees published lessons via the
-- underlying lessons RLS — no separate student-facing version needed.
-- ----------------------------------------------------------------------------

create view owner_lesson_browser_view as
select
  l.id, l.title, l.status, l.competency_ids, l.display_order, l.updated_at,
  s.id as subject_id, s.name as subject_name,
  f.id as field_id, f.name as field_name,
  w.id as week_id, w.week_number,
  t.term_number,
  ay.label as academic_year_label
from lessons l
join subjects s on s.id = l.subject_id
join educational_fields f on f.id = s.field_id
join curriculum_weeks w on w.id = l.week_id
join terms t on t.id = w.term_id
join academic_years ay on ay.id = t.academic_year_id;

alter view owner_lesson_browser_view set (security_invoker = true);
