-- ============================================================================
-- اقرأ أكثر... ترى أكثر — 13: LESSON LIFECYCLE (Draft → Scheduled →
-- Published → Closed → Archived)
-- New migration, additive only. Run AFTER storage-security.sql.
--
-- REVISION NOTE: this file previously implemented a simpler "computed
-- visibility" rule (a lesson becomes visible the moment publish_date
-- arrives, checked live on every query, no state-changing event). That
-- design is SUPERSEDED here, before deployment, because it cannot satisfy
-- a real requirement: "Automatic notifications must be triggered whenever
-- a lesson changes from Scheduled to Published." A notification requires
-- an actual transition to happen at a point in time — you cannot fire one
-- from a formula re-evaluated on read. This version uses a real state
-- machine plus a background job that performs the actual transition once,
-- at the right time, and fires the notification as part of that same
-- transaction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. STATUS ENUM — extend lesson_status with the two new states.
-- Postgres requires ALTER TYPE ... ADD VALUE outside a transaction block
-- in older versions; on modern Postgres (12+, which Supabase uses) this
-- works as a plain statement.
-- ----------------------------------------------------------------------------

alter type lesson_status add value if not exists 'scheduled';
alter type lesson_status add value if not exists 'closed';
-- Resulting full set: draft, scheduled, published, closed, archived.

-- ----------------------------------------------------------------------------
-- 2. NEW COLUMNS
--
-- Academic Year / Trimester / Week Number are NOT duplicated here — they
-- already exist via lessons.week_id -> curriculum_weeks.term_id ->
-- terms.academic_year_id (curriculum-manager-schema.sql). Adding redundant
-- direct columns would create two sources of truth that can drift out of
-- sync; querying through the existing relationship (already what
-- owner_lesson_browser_view does) is the correct, non-duplicating way to
-- surface this, not a schema gap.
-- ----------------------------------------------------------------------------

alter table lessons add column if not exists publish_date timestamptz;
alter table lessons add column if not exists published_at timestamptz;
alter table lessons add column if not exists homework_deadline timestamptz;
alter table lessons add column if not exists closed_at timestamptz;
alter table lessons add column if not exists lesson_number integer;
-- lesson_number: sequential numbering WITHIN a subject (e.g. "Lesson 5 in
-- Arabic"), distinct from week_number and set by the teacher — not
-- auto-computed, since a teacher may legitimately want to renumber or
-- leave gaps (e.g. a lesson removed later without renumbering everything
-- after it).
alter table lessons add column if not exists homework_id uuid references homework(id);
-- The direct lesson<->homework link the RC1 audit flagged as missing
-- (RC1-TO-GRADE6-VISION-AUDIT.md §5.2). This is what makes "Closed blocks
-- submission for THIS lesson's homework" enforceable — without this FK,
-- "the homework belonging to this lesson" isn't a well-defined query.

-- ----------------------------------------------------------------------------
-- 3. TRANSITION VALIDATION — enforced via trigger, not just application code.
-- ----------------------------------------------------------------------------

create or replace function validate_lesson_status_transition()
returns trigger as $$
begin
  if new.status = 'scheduled' and new.publish_date is null then
    raise exception 'لا يمكن جدولة درس بدون تحديد تاريخ النشر';
  end if;
  if new.status = 'scheduled' and new.publish_date <= now() then
    raise exception 'تاريخ النشر يجب أن يكون في المستقبل عند الجدولة';
  end if;
  -- Draft/Scheduled/Archived are always Owner-settable manually (checked
  -- by RLS, not this trigger). Published and Closed are primarily reached
  -- via the background job below, but manual override remains allowed —
  -- e.g. an Owner publishing immediately without scheduling, or
  -- re-opening a closed lesson (spec: "unless the teacher explicitly
  -- reopens it") by setting status back to 'published' directly.
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_validate_lesson_status on lessons;
create trigger trg_validate_lesson_status
  before insert or update on lessons
  for each row execute function validate_lesson_status_transition();

-- ----------------------------------------------------------------------------
-- 4. RLS — students see Published and Closed only. Scheduled and Draft are
-- invisible (identical treatment; "scheduled" is not yet "published", full
-- stop). Archived is Owner-only, matching the spec exactly.
--
-- SECURITY_STANDARDS.md §12 applied: single source of truth (the `status`
-- column, maintained by the transition job below) replaces the earlier
-- computed-publish_date formula — no longer two mechanisms that could
-- disagree about whether a lesson is visible.
-- ----------------------------------------------------------------------------

drop policy if exists student_reads_published_lessons on lessons;
create policy student_reads_published_lessons on lessons
  for select using (status in ('published', 'closed'));

drop view if exists published_lessons;
create view published_lessons as
select * from lessons where status in ('published', 'closed');
alter view published_lessons set (security_invoker = true);
-- Still no conditional column masking here — §4's invoker/definer
-- distinction still doesn't apply; this is a pure row filter.

-- ----------------------------------------------------------------------------
-- 5. HOMEWORK SUBMISSION BLOCKING when the linked lesson is Closed.
-- Additive AND-condition on the EXISTING policies (student-management-
-- schema.sql) — narrows them, does not replace their ownership checks.
-- ----------------------------------------------------------------------------

drop policy if exists student_inserts_own_submission on homework_submissions;
create policy student_inserts_own_submission on homework_submissions
  for insert with check (
    auth.uid() = student_id
    and not exists (
      select 1 from lessons l where l.homework_id = homework_submissions.homework_id and l.status = 'closed'
    )
  );

drop policy if exists student_updates_own_ungraded_submission on homework_submissions;
create policy student_updates_own_ungraded_submission on homework_submissions
  for update
  using (auth.uid() = student_id and status != 'graded')
  with check (
    auth.uid() = student_id and status != 'graded'
    and not exists (
      select 1 from lessons l where l.homework_id = homework_submissions.homework_id and l.status = 'closed'
    )
  );
-- Viewing the lesson and its correction remains allowed while Closed
-- (§4's RLS already includes 'closed' in the visible-status list) — only
-- new/updated SUBMISSIONS are blocked, exactly per spec: "Students can
-- still view the lesson and correction but cannot submit homework."

-- ----------------------------------------------------------------------------
-- 6. THE BACKGROUND TRANSITION JOB — the actual enforcement point for
-- Scheduled → Published and Published → Closed. Must run periodically
-- (pg_cron if enabled on this Supabase project, otherwise an external
-- scheduled Edge Function calling this RPC every 1-5 minutes — same
-- deployment shape as ai-job-queue.js's worker, which needed identical
-- treatment). SECURITY DEFINER: writes to security_audit_log and
-- notifications, both of which have no `authenticated` INSERT policy.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 6a. security_audit_log.actor_id was defined NOT NULL
-- (exam-threat-model-fixes.sql) — verified by inspection just now, not
-- assumed. Every prior use of this table was a human-triggered RPC, so
-- that constraint made sense at the time. A scheduled system transition
-- (no human actor) is a legitimate new category this table wasn't
-- designed for yet. Widening the column is the honest fix — inserting a
-- fake/placeholder user id to satisfy NOT NULL would misrepresent the
-- audit trail, which defeats the entire purpose of having one.
-- ----------------------------------------------------------------------------

alter table security_audit_log alter column actor_id drop not null;

-- ----------------------------------------------------------------------------
-- 5a. NOTIFICATION TYPE — 'new_lesson' is used by the function below.
-- Added here, before that function, even though Postgres wouldn't have
-- actually errored either way (enum values inside a plpgsql function body
-- aren't validated until the function runs, not when it's created) —
-- ordered correctly anyway for anyone reading this file top-to-bottom.
-- ----------------------------------------------------------------------------

alter type notification_type add value if not exists 'new_lesson';

create or replace function process_lesson_lifecycle_transitions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson record;
  v_published_count int := 0;
  v_closed_count int := 0;
  v_student record;
begin
  -- Scheduled -> Published
  for v_lesson in
    select * from lessons where status = 'scheduled' and publish_date <= now() for update
  loop
    update lessons set status = 'published', published_at = now() where id = v_lesson.id;
    v_published_count := v_published_count + 1;

    -- One notification per active student — matches the spec's "Student
    -- notifications: new lesson" being a per-student event, and reuses
    -- the existing notifications table/RLS entirely (no new
    -- infrastructure). Homework becoming available is the SAME event,
    -- not a second notification, per spec ("Published: ... Homework
    -- becomes available. Notifications are generated automatically" reads
    -- as one combined event, not two separate ones).
    for v_student in select user_id from student_profiles where status = 'active' loop
      insert into notifications (recipient_id, type, title, link_entity_table, link_entity_id)
      values (v_student.user_id, 'new_lesson', 'درس جديد: ' || v_lesson.title, 'lessons', v_lesson.id);
    end loop;

    insert into security_audit_log (actor_id, action, entity_table, entity_id, metadata)
    values (null, 'lesson_auto_published', 'lessons', v_lesson.id, jsonb_build_object('title', v_lesson.title));
    -- actor_id is null here deliberately: this transition has no human
    -- actor, it's a scheduled system event. This requires the column
    -- widening in §6a immediately above — without it, this insert would
    -- fail on the original NOT NULL constraint (caught by re-checking the
    -- real table definition before shipping this, not assumed correct).
  end loop;

  -- Published -> Closed (deadline passed)
  for v_lesson in
    select * from lessons
    where status = 'published' and homework_deadline is not null and homework_deadline <= now()
    for update
  loop
    update lessons set status = 'closed', closed_at = now() where id = v_lesson.id;
    v_closed_count := v_closed_count + 1;

    -- Teacher notification: "homework deadline reached" — already in the
    -- vision doc's Teacher notification list; reused, not invented anew.
    insert into notifications (recipient_id, type, title, link_entity_table, link_entity_id)
    select l.owner_id, 'homework_due_soon', 'انتهى أجل تسليم واجب: ' || l.title, 'lessons', l.id
    from lessons l where l.id = v_lesson.id;
  end loop;

  return jsonb_build_object('published', v_published_count, 'closed', v_closed_count, 'ranAt', now());
end;
$$;

revoke all on function process_lesson_lifecycle_transitions() from public;
-- No `grant execute ... to authenticated` at all — this is called ONLY by
-- the scheduled job mechanism (pg_cron runs as the database owner, not as
-- `authenticated`), never by a client. If pg_cron isn't available and an
-- external Edge Function calls this instead, that function must use the
-- service_role key, per CLIENT-SERVER-BOUNDARY.md — never expose this to
-- `authenticated`, since it currently trusts its own scheduling context
-- entirely and performs no caller-authorization check of its own.

-- Requires the pg_cron extension (Supabase: enable via Database ->
-- Extensions in the dashboard). If unavailable, DEPLOYMENT_CHECKLIST.md
-- must add "external scheduled Edge Function calling this RPC every
-- 1-5 minutes with the service_role key" as an alternative — flagged
-- there, not assumed to work by default.
-- select cron.schedule('lesson-lifecycle', '*/2 * * * *', 'select process_lesson_lifecycle_transitions();');

-- ----------------------------------------------------------------------------
-- 7. "CURRENT LESSON" MUST COME FROM BACKEND STATE — the student dashboard
-- must never compute this client-side. This view is that single source of
-- truth: one row per subject, the most recently published-or-closed
-- lesson (by lesson_number, falling back to published_at), matching "the
-- student dashboard must always determine the Current Lesson from
-- backend state."
-- ----------------------------------------------------------------------------

create view student_current_lesson_view as
select distinct on (subject_id)
  id as lesson_id, subject_id, title, lesson_number, status, published_at, homework_deadline, homework_id
from lessons
where status in ('published', 'closed')
order by subject_id, published_at desc nulls last, lesson_number desc nulls last;

alter view student_current_lesson_view set (security_invoker = true);
-- No conditional column masking — pure row filter (§4 doesn't apply);
-- relies on the RLS policy in §4 above for row-level restriction, exactly
-- like published_lessons.
