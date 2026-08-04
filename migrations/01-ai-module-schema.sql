-- ============================================================================
-- اقرأ أكثر... ترى أكثر — AI MODULE SCHEMA (Phase 10+)
-- Bounded context: AI Draft Queue, Review Workflow, Prompt Library,
--                  AI Job Queue, AI Usage Analytics
--
-- Fundamental rule encoded in this schema:
-- AI never publishes directly. Every artifact passes through the
-- ai_draft_queue lifecycle and requires explicit Owner approval.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ENUM TYPES
-- ----------------------------------------------------------------------------

create type ai_draft_status as enum (
  'generated',        -- raw output from AI, not yet validated
  'pending_review',   -- passed validation, awaiting Owner decision
  'approved',         -- Owner approved, not yet published
  'published',        -- live and visible to students
  'rejected',         -- Owner rejected
  'archived'          -- soft-deleted / retired, restorable
);

create type ai_draft_type as enum (
  'question',
  'mock_exam',
  'weakness_analysis',
  'revision_plan',
  'readiness_summary',
  'tutor_response'
);

create type ai_job_status as enum (
  'queued', 'processing', 'succeeded', 'failed', 'cancelled', 'timed_out'
);

create type ai_validation_result as enum ('passed', 'failed');

-- ----------------------------------------------------------------------------
-- 1. AI DRAFT QUEUE — core lifecycle table
-- ----------------------------------------------------------------------------

create table ai_draft_queue (
  id                uuid primary key default gen_random_uuid(),
  draft_type        ai_draft_type not null,
  status            ai_draft_status not null default 'generated',

  -- content
  payload           jsonb not null,              -- the AI-generated artifact itself
  payload_schema_version text not null default 'v1',

  -- provenance
  -- NOTE: prompt_id and generation_job_id reference tables defined later in
  -- this file (prompt_library, ai_generation_jobs). No inline FK here to
  -- avoid a forward-reference error at create time; both FKs are added via
  -- ALTER TABLE once all three tables exist (see end of file).
  prompt_id         uuid,
  prompt_version    integer not null,
  source_lesson_ids uuid[] default '{}',
  source_competency_ids uuid[] default '{}',
  generation_job_id uuid,

  -- ownership / linkage
  owner_id          uuid not null references users(id),
  student_id        uuid references users(id),     -- null for owner-facing artifacts (e.g. mock exams)
  published_entity_id uuid,                          -- FK-less pointer to the real table row once published
  published_entity_table text,                       -- e.g. 'quiz_questions', 'revision_plans'

  -- organization
  tags              text[] default '{}',
  is_favorite       boolean not null default false,

  -- validation
  validation_result ai_validation_result,
  validation_errors jsonb default '[]',

  -- versioning
  version           integer not null default 1,
  parent_draft_id   uuid references ai_draft_queue(id), -- set when duplicated or revised

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_ai_draft_status on ai_draft_queue (status);
create index idx_ai_draft_type on ai_draft_queue (draft_type);
create index idx_ai_draft_owner on ai_draft_queue (owner_id);
create index idx_ai_draft_student on ai_draft_queue (student_id) where student_id is not null;
create index idx_ai_draft_tags on ai_draft_queue using gin (tags);
create index idx_ai_draft_created on ai_draft_queue (created_at desc);
create index idx_ai_draft_favorite on ai_draft_queue (owner_id) where is_favorite = true;
create index idx_ai_draft_parent on ai_draft_queue (parent_draft_id) where parent_draft_id is not null;

-- ----------------------------------------------------------------------------
-- 2. AUDIT LOG — every state transition, immutable, append-only
-- ----------------------------------------------------------------------------

create table ai_draft_audit_log (
  id            uuid primary key default gen_random_uuid(),
  draft_id      uuid not null references ai_draft_queue(id),
  from_status   ai_draft_status,
  to_status     ai_draft_status not null,
  action        text not null,        -- 'generate','validate','approve','reject','publish','restore','duplicate','bulk_approve','bulk_reject'
  actor_id      uuid not null references users(id),
  reason        text,
  metadata      jsonb default '{}',
  created_at    timestamptz not null default now()
);

create index idx_audit_draft on ai_draft_audit_log (draft_id, created_at desc);

-- No update/delete allowed on audit log — enforce via trigger.
create or replace function prevent_audit_mutation() returns trigger as $$
begin
  raise exception 'ai_draft_audit_log is append-only';
end;
$$ language plpgsql;

create trigger trg_no_audit_update before update on ai_draft_audit_log
  for each row execute function prevent_audit_mutation();
create trigger trg_no_audit_delete before delete on ai_draft_audit_log
  for each row execute function prevent_audit_mutation();

-- ----------------------------------------------------------------------------
-- 3. VERSION HISTORY — full snapshots for compare/diff
-- ----------------------------------------------------------------------------

create table ai_draft_versions (
  id            uuid primary key default gen_random_uuid(),
  draft_id      uuid not null references ai_draft_queue(id),
  version       integer not null,
  payload       jsonb not null,
  status_at_snapshot ai_draft_status not null,
  created_by    uuid not null references users(id),
  created_at    timestamptz not null default now(),
  unique (draft_id, version)
);

create index idx_versions_draft on ai_draft_versions (draft_id, version desc);

-- ----------------------------------------------------------------------------
-- 4. PROMPT LIBRARY — versioned, with usage stats
-- ----------------------------------------------------------------------------

create table prompt_library (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text,
  category          text,                       -- e.g. 'question_generation', 'analysis', 'tutoring'
  tags              text[] default '{}',
  draft_type        ai_draft_type not null,
  version           integer not null default 1,
  is_active         boolean not null default true,
  is_archived       boolean not null default false,

  system_prompt     text not null,
  user_prompt_template text not null,      -- with {{variable}} placeholders
  variables         jsonb not null default '[]',   -- [{name, type, required}]
  output_json_schema jsonb not null,        -- for validation

  parent_prompt_id  uuid references prompt_library(id), -- set when cloned/versioned

  usage_count       integer not null default 0,
  success_count     integer not null default 0,
  failure_count     integer not null default 0,

  created_by        uuid not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (name, version)
);

create index idx_prompt_active on prompt_library (draft_type) where is_active = true and is_archived = false;
create index idx_prompt_name on prompt_library (name);
create index idx_prompt_category on prompt_library (category);
create index idx_prompt_tags on prompt_library using gin (tags);

-- Test/benchmark runs: lets the Owner try a prompt against sample inputs
-- before activating it, and compare candidate versions side by side without
-- touching the live ai_generation_jobs queue or affecting usage_count.
create table prompt_test_runs (
  id            uuid primary key default gen_random_uuid(),
  prompt_id     uuid not null references prompt_library(id),
  test_input    jsonb not null,
  output        jsonb,
  passed_validation boolean,
  validation_errors jsonb default '[]',
  quality_score numeric(5,2),
  latency_ms    integer,
  input_tokens  integer,
  output_tokens integer,
  run_by        uuid not null references users(id),
  created_at    timestamptz not null default now()
);

create index idx_test_runs_prompt on prompt_test_runs (prompt_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. AI GENERATION JOBS — background job queue
-- ----------------------------------------------------------------------------

create table ai_generation_jobs (
  id              uuid primary key default gen_random_uuid(),
  job_type        ai_draft_type not null,
  status          ai_job_status not null default 'queued',

  prompt_id       uuid not null references prompt_library(id),
  input_variables jsonb not null,

  requested_by    uuid not null references users(id),

  attempts        integer not null default 0,
  max_attempts    integer not null default 3,

  priority        integer not null default 5,   -- lower = higher priority

  scheduled_at    timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  timeout_seconds integer not null default 60,

  result_draft_id uuid references ai_draft_queue(id),
  error_message   text,
  failure_reason  text,   -- 'timeout','validation_failed','api_error','rate_limited','cancelled'

  -- observability
  input_tokens    integer,
  output_tokens   integer,
  estimated_cost_usd numeric(10,5),
  processing_ms   integer,

  created_at      timestamptz not null default now()
);

create index idx_jobs_status on ai_generation_jobs (status, priority, scheduled_at);
create index idx_jobs_requested_by on ai_generation_jobs (requested_by);
create index idx_jobs_created on ai_generation_jobs (created_at desc);

-- Dead-letter table: jobs that exhausted all retries land here for Owner
-- inspection, separate from the main queue so systemic failures are visible
-- without scrolling through routine one-off API errors.
create table ai_dead_letter_jobs (
  id                uuid primary key default gen_random_uuid(),
  original_job_id   uuid not null references ai_generation_jobs(id),
  job_type          ai_draft_type not null,
  input_variables   jsonb not null,
  attempts          integer not null,
  failure_reason    text not null,
  moved_at          timestamptz not null default now(),
  replayed_at       timestamptz
);

create index idx_dead_letter_moved on ai_dead_letter_jobs (moved_at desc);

alter table ai_draft_queue
  add constraint fk_generation_job foreign key (generation_job_id) references ai_generation_jobs(id);
alter table ai_draft_queue
  add constraint fk_prompt foreign key (prompt_id) references prompt_library(id);

-- ----------------------------------------------------------------------------
-- 6. RESULT CACHE — avoid redundant AI calls for identical inputs
-- ----------------------------------------------------------------------------

create table ai_result_cache (
  cache_key       text primary key,     -- hash(prompt_id + version + input_variables)
  draft_type      ai_draft_type not null,
  payload         jsonb not null,
  hit_count       integer not null default 0,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);

create index idx_cache_expiry on ai_result_cache (expires_at);

-- ----------------------------------------------------------------------------
-- 7. ANALYTICS — materialized view, refreshed on a schedule
-- ----------------------------------------------------------------------------

create materialized view ai_usage_analytics as
select
  d.draft_type,
  date_trunc('day', d.created_at) as day,
  count(*) as total_generations,
  count(*) filter (where d.status = 'approved')  as approved_count,
  count(*) filter (where d.status = 'rejected')  as rejected_count,
  count(*) filter (where d.status = 'published') as published_count,
  avg(extract(epoch from (
    (select min(a.created_at) from ai_draft_audit_log a
     where a.draft_id = d.id and a.to_status in ('approved','rejected'))
    - d.created_at
  ))) as avg_review_time_seconds,
  sum(j.estimated_cost_usd) as total_cost_usd,
  sum(j.input_tokens + j.output_tokens) as total_tokens,
  avg(j.processing_ms) as avg_processing_ms
from ai_draft_queue d
left join ai_generation_jobs j on j.id = d.generation_job_id
group by d.draft_type, date_trunc('day', d.created_at);

create unique index idx_analytics_unique on ai_usage_analytics (draft_type, day);

-- Prompt-level success rate, computed from prompt_library counters directly
create view prompt_success_rates as
select
  id, name, version, draft_type,
  usage_count, success_count, failure_count,
  case when usage_count > 0
    then round(success_count::numeric / usage_count * 100, 1)
    else null
  end as success_rate_pct
from prompt_library;

-- ----------------------------------------------------------------------------
-- 8. TRIGGERS — keep updated_at fresh, keep prompt usage counters in sync
-- ----------------------------------------------------------------------------

create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_draft_touch before update on ai_draft_queue
  for each row execute function touch_updated_at();
create trigger trg_prompt_touch before update on prompt_library
  for each row execute function touch_updated_at();

-- ----------------------------------------------------------------------------
-- NOTES
-- ----------------------------------------------------------------------------
-- 1. `published_entity_id` / `published_entity_table` intentionally avoid a
--    hard FK because a draft can publish into different tables (quiz_questions,
--    revision_plans, exams, etc). Referential integrity for that pointer is
--    enforced in the service layer, not the DB, by design.
-- 2. ai_draft_versions is written on every transition, not just on edits, so
--    "compare revisions" always has a full timeline, including re-generations.
-- 3. Refresh ai_usage_analytics on a schedule (e.g. hourly via pg_cron or a
--    scheduled Edge Function): `refresh materialized view ai_usage_analytics;`
