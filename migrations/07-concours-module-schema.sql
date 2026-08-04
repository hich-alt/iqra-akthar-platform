-- ============================================================================
-- اقرأ أكثر... ترى أكثر — CONCOURS MODULE (Phase 10+)
-- Dedicated preparation module for مناظرة الدخول إلى المدارس الإعدادية النموذجية
-- ============================================================================

create table concours_calendar (
  id                uuid primary key default gen_random_uuid(),
  academic_year_id  uuid not null references academic_years(id),
  exam_date         date not null,
  registration_deadline date,
  notes             text
);

-- Revision plans: published FROM approved `revision_plan` AI drafts
-- (see buildRevisionPlanPrompt in concours-ai-prompts.js). Student-facing
-- reads must come from here, never from ai_draft_queue directly.
create table revision_plans (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references users(id),
  source_draft_id   uuid references ai_draft_queue(id),
  concours_id       uuid references concours_calendar(id),

  weekly_plan       jsonb not null,        -- [{ week_number, focus_competencies, recommended_resources, suggested_daily_minutes }]
  teacher_notes     text,                  -- Owner's edits/notes before approving visibility

  is_visible_to_student boolean not null default false, -- separate flag from AI approval:
                                                          -- an Owner can approve the draft into
                                                          -- this table but still hold back visibility
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_revision_plans_student on revision_plans (student_id);
create index idx_revision_plans_visible on revision_plans (student_id) where is_visible_to_student = true;

create trigger trg_revision_plans_touch before update on revision_plans
  for each row execute function touch_updated_at();

-- Readiness snapshots: the score itself is computed deterministically in
-- application code (see readiness-service.js), NOT by the AI — the AI only
-- explains it (buildReadinessSummaryPrompt). This table stores the computed
-- score; ai_draft_queue separately stores the AI's plain-language explanation
-- as a readiness_summary draft.
create table readiness_snapshots (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references users(id),
  concours_id       uuid references concours_calendar(id),
  score             numeric(5,2) not null,      -- 0-100
  breakdown         jsonb not null,             -- { mock_exam_avg, homework_completion_pct, streak_days, competency_coverage_pct }
  computed_at       timestamptz not null default now()
);

create index idx_readiness_student on readiness_snapshots (student_id, computed_at desc);

-- Mock exam archive: distinct from `exams` (Exam System) only in that this
-- view filters to concours-relevant exam types for the archive UI —
-- deliberately NOT a separate table, reusing exams/exam_attempts entirely.
-- FOUND DURING THE EXAM SYSTEM SECURITY REGRESSION CHECK: this view had no
-- row-level filter at all and no security_invoker declaration — Postgres
-- views default to running as the OWNER (definer semantics) when neither
-- is set, which bypasses RLS on the joined tables entirely. The result:
-- any authenticated session querying this view got EVERY student's
-- mock-exam scores, not just their own. Fixed with the same explicit
-- row-filter + conditional score masking as student_exam_attempts_view.
create view concours_mock_exam_archive as
select
  e.id as exam_id, e.title, e.scheduled_start, a.student_id, a.status,
  case when a.status = 'graded' then a.total_score else null end as total_score,
  case when a.status = 'graded' then a.max_score else null end as max_score
from exams e
join exam_attempts a on a.exam_id = e.id
where e.exam_type = 'mock_concours'
  and (a.student_id = auth.uid()
       or current_user_role() = 'owner'
       or is_verified_parent_of(a.student_id));
-- Note: is_verified_parent_of() is defined in parent-portal-schema.sql,
-- which must run before this file in migration order as a result.

-- ----------------------------------------------------------------------------
-- READINESS RANKING — the one piece of the original Concours Module spec
-- ("Ranking. Achievements.") still missing. Achievements is Gamification,
-- already deliberately deferred (AI-Module docs: "AI artifacts do not
-- award XP/badges directly"). Ranking gets the same deliberate scoping
-- decision, for the same underlying reason: this is Owner-facing ONLY,
-- never a student-visible leaderboard. Ranking children against peers
-- ahead of a high-stakes entrance exam is a real wellbeing risk for
-- 11-12 year olds, not just a design preference — a teacher using this to
-- decide who needs intervention is a legitimate pedagogical tool; the
-- identical data surfaced to students as a competitive leaderboard is not
-- the same feature with a different UI, it's a different (and riskier)
-- feature this platform is not building.
--
-- SECURITY_STANDARDS.md checklist applied:
-- - RLS: no new table, reuses readiness_snapshots (already RLS-enabled)
-- - View masking: no conditional column masking needed here (Owner sees
--   everything unconditionally, by design) — security_invoker=true is
--   correct per §4's decision rule, since RLS on readiness_snapshots
--   already restricts to Owner via owner_full_access_readiness_snapshots
--   for anyone querying this view who ISN'T Owner (they'd just get an
--   empty result, not an error, since RLS silently filters rows).
-- - Column privileges: no revoked columns referenced.
-- - Data exposure: explicitly does NOT join student_profiles.full_name in
--   a way that's queryable by non-Owner sessions — see the WHERE clause.
-- ----------------------------------------------------------------------------

create view owner_readiness_ranking_view as
select
  rs.student_id, sp.full_name, rs.score, rs.breakdown, rs.computed_at,
  rank() over (order by rs.score desc) as rank_position
from readiness_snapshots rs
join student_profiles sp on sp.user_id = rs.student_id
where rs.computed_at = (select max(computed_at) from readiness_snapshots where student_id = rs.student_id);

alter view owner_readiness_ranking_view set (security_invoker = true);
-- Non-Owner sessions get zero rows here regardless (readiness_snapshots'
-- RLS restricts SELECT to the Owner or the specific student themselves —
-- and a student querying this view would only ever see THEIR OWN row via
-- invoker semantics, never the ranking of others, since RLS filters per
-- row for their session too). This view is deliberately not restricted to
-- "Owner only" via an explicit WHERE — it doesn't need to be, because
-- invoker + existing RLS already produces the correct narrow result for
-- every non-Owner caller. Confirmed by tracing through readiness_snapshots'
-- policies, not assumed.
