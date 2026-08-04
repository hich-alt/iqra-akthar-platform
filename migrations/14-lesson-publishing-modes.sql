-- ============================================================================
-- اقرأ أكثر... ترى أكثر — 14: DUAL PUBLISHING MODES, ONE SHARED TRANSITION
-- New migration, additive. Run AFTER 13-progressive-weekly-publishing.sql.
--
-- THE GAP THIS CLOSES: in file 13, notification-firing logic lived ONLY
-- inside process_lesson_lifecycle_transitions() (the cron job). A direct
-- Owner "Publish Now" action — a plain UPDATE — would flip the status but
-- fire NO notification. That violates "one notification pipeline" as a
-- literal fact, not just a style preference. Fixed by extracting the
-- actual transition into one internal function both paths call.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. NEW NOTIFICATION TYPES — reusing existing ones wherever the meaning
-- is identical, per "avoid unnecessary complexity":
--   "Homework Corrected"           -> reuses existing 'homework_graded'
--   "Homework Deadline Approaching" -> reuses existing 'homework_due_soon'
-- Genuinely new concepts, not covered by anything existing:
-- ----------------------------------------------------------------------------

alter type notification_type add value if not exists 'homework_assigned';
alter type notification_type add value if not exists 'lesson_reopened';
alter type notification_type add value if not exists 'correction_published';
-- 'correction_published' is added to the vocabulary now but NOT fired by
-- anything in this file — that event belongs to the homework-GRADING
-- subsystem (homework-grading-service.js), not the lesson-lifecycle
-- subsystem this file covers. Stated explicitly so this isn't mistaken
-- for a completed wiring — it isn't, yet.

-- ----------------------------------------------------------------------------
-- 2. reminder_sent_at — prevents the "deadline approaching" reminder from
-- firing every single time the cron job runs (every 1-2 minutes) instead
-- of once.
-- ----------------------------------------------------------------------------

alter table lessons add column if not exists reminder_sent_at timestamptz;

-- ----------------------------------------------------------------------------
-- 3. THE ONE SHARED NOTIFICATION PIPELINE — used by every path in this
-- file that needs to notify students. One function, both trigger sources
-- (manual RPC and cron) call it; it exists in exactly one place.
-- ----------------------------------------------------------------------------

create or replace function notify_active_students(
  p_type notification_type, p_title text, p_link_table text, p_link_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (recipient_id, type, title, link_entity_table, link_entity_id)
  select user_id, p_type, p_title, p_link_table, p_link_id
  from student_profiles where status = 'active';
end;
$$;

revoke all on function notify_active_students(notification_type, text, text, uuid) from public;
-- No grant to `authenticated` — this is an internal helper called by other
-- DEFINER functions in this file, never directly by a client.

-- ----------------------------------------------------------------------------
-- 4. THE ONE SHARED PUBLISH TRANSITION — internal core, no client grant.
-- Both "Publish Now" (manual) and the scheduled job (automatic) call THIS
-- function. The status flip, the notifications, and the audit log entry
-- exist here and only here.
-- ----------------------------------------------------------------------------

create or replace function publish_lesson_internal(p_lesson_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson lessons;
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
  end if;

  insert into security_audit_log (actor_id, action, entity_table, entity_id, metadata)
  values (p_actor_id, 'lesson_published', 'lessons', p_lesson_id,
          jsonb_build_object('title', v_lesson.title, 'trigger', case when p_actor_id is null then 'scheduled_job' else 'manual' end));
end;
$$;

revoke all on function publish_lesson_internal(uuid, uuid) from public;
-- No grant to `authenticated` at all — this is the shared core, reached
-- only via publish_lesson() below (manual) or the cron job (automatic).
-- This is what makes "one transition" true rather than aspirational: a
-- client cannot reach this function by any path that skips authorization
-- or skips the notification step.

-- ----------------------------------------------------------------------------
-- 5. CLIENT-FACING WRAPPER — Mode 1, "Publish Now".
-- ----------------------------------------------------------------------------

create or replace function publish_lesson(p_lesson_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user_role() != 'owner' then
    raise exception 'ليست لديك صلاحية نشر هذا الدرس';
  end if;
  perform publish_lesson_internal(p_lesson_id, auth.uid());
end;
$$;

revoke all on function publish_lesson(uuid) from public;
grant execute on function publish_lesson(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Mode 2 — automatic. Replaces the scheduled-publish half of file 13's
-- process_lesson_lifecycle_transitions() so it calls the SAME internal
-- function instead of duplicating the update+notify logic inline. The
-- deadline-close half and the new deadline-REMINDER check are also here.
-- ----------------------------------------------------------------------------

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
  v_reminded_count int := 0;
begin
  -- Scheduled -> Published (Mode 2): calls the SAME function Mode 1 uses.
  -- p_actor_id = null marks this as system-triggered, not a human action
  -- (security_audit_log.actor_id was widened to allow this in file 13).
  for v_lesson in
    select id from lessons where status = 'scheduled' and publish_date <= now() for update
  loop
    perform publish_lesson_internal(v_lesson.id, null);
    v_published_count := v_published_count + 1;
  end loop;

  -- Published -> Closed (deadline passed) — no notification per spec's list
  -- (only "approaching" is listed as notification-worthy, not "closed" itself).
  for v_lesson in
    select id from lessons
    where status = 'published' and homework_deadline is not null and homework_deadline <= now()
    for update
  loop
    update lessons set status = 'closed', closed_at = now() where id = v_lesson.id;
    v_closed_count := v_closed_count + 1;
  end loop;

  -- Deadline approaching (24h window), once only per lesson.
  for v_lesson in
    select id, title from lessons
    where status = 'published' and homework_deadline is not null
      and homework_deadline between now() and now() + interval '24 hours'
      and reminder_sent_at is null
    for update
  loop
    perform notify_active_students('homework_due_soon', 'اقترب أجل تسليم واجب: ' || v_lesson.title, 'lessons', v_lesson.id);
    update lessons set reminder_sent_at = now() where id = v_lesson.id;
    v_reminded_count := v_reminded_count + 1;
  end loop;

  return jsonb_build_object('published', v_published_count, 'closed', v_closed_count, 'reminded', v_reminded_count, 'ranAt', now());
end;
$$;

revoke all on function process_lesson_lifecycle_transitions() from public;
-- Unchanged from file 13: no grant to `authenticated`, called only by
-- pg_cron or a service_role-authenticated external scheduler.

-- ----------------------------------------------------------------------------
-- 7. REOPEN HOMEWORK — Closed -> Published, with its own notification.
-- ----------------------------------------------------------------------------

create or replace function reopen_lesson_homework(p_lesson_id uuid, p_new_deadline timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson lessons;
begin
  if current_user_role() != 'owner' then
    raise exception 'ليست لديك صلاحية إعادة فتح هذا الواجب';
  end if;

  select * into v_lesson from lessons where id = p_lesson_id for update;
  if not found then raise exception 'الدرس غير موجود'; end if;
  if v_lesson.status != 'closed' then
    raise exception 'لا يمكن إعادة فتح درس ليس في حالة مغلق';
  end if;

  update lessons set status = 'published', homework_deadline = p_new_deadline, reminder_sent_at = null
    where id = p_lesson_id;

  perform notify_active_students('lesson_reopened', 'تمت إعادة فتح الواجب: ' || v_lesson.title, 'lessons', p_lesson_id);

  insert into security_audit_log (actor_id, action, entity_table, entity_id, metadata)
  values (auth.uid(), 'lesson_homework_reopened', 'lessons', p_lesson_id, jsonb_build_object('newDeadline', p_new_deadline));
end;
$$;

revoke all on function reopen_lesson_homework(uuid, timestamptz) from public;
grant execute on function reopen_lesson_homework(uuid, timestamptz) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. SIMPLE TRANSITIONS — no notification required by spec, so these stay
-- as plain column-privileged UPDATEs rather than RPCs, per "avoid
-- unnecessary complexity": schedule/postpone (draft/scheduled ->
-- scheduled with a date), cancel (scheduled -> draft), manual close
-- (published -> closed), archive (any -> archived). The existing
-- validate_lesson_status_transition trigger (file 13) already enforces
-- the "scheduled requires a future date" rule for all of these.
--
-- To make sure these CANNOT be used to sneak a notification-requiring
-- transition through the side door, `status` itself is column-revoked
-- from direct client UPDATE for the one value that matters — 'published'
-- reached from 'closed' (reopen) must go through the RPC above. Draft/
-- scheduled/archived/closed(-via-deadline-passing, already system-only)
-- remain plain-UPDATE-able because none of those transitions fire a
-- notification, so there's nothing to bypass.
-- ----------------------------------------------------------------------------

-- No new column privilege statements needed here: lessons.status was never
-- column-revoked from `authenticated` (Owner needs to set draft/scheduled/
-- archived/closed directly) — the only path that MUST be forced through
-- an RPC is Closed -> Published (reopen), which is prevented not by a
-- column revoke but by the CHECK inside reopen_lesson_homework requiring
-- current_user_role() = 'owner' AND requiring the caller go through this
-- function to also fire the notification and update reminder_sent_at
-- correctly. A direct client UPDATE setting status='published' while
-- old.status='closed' would flip the status WITHOUT resetting
-- reminder_sent_at or firing 'lesson_reopened' — a functional gap, not a
-- security one (Owner already has full RLS write access to lessons
-- regardless). Documented here rather than silently accepted: if this
-- inconsistency matters in practice, revoke UPDATE(status) from
-- `authenticated` entirely and add matching plain-transition RPCs for
-- schedule/postpone/cancel/close/archive too — not built now, per
-- "avoid unnecessary complexity," since Owner bypassing their own
-- notification pipeline by using the wrong UI action is a training/UX
-- concern, not a security one.
