-- ============================================================================
-- اقرأ أكثر... ترى أكثر — NOTIFICATION CENTER (Phase 10+)
-- ============================================================================

create type notification_type as enum (
  'ai_pending_review', 'homework_graded', 'homework_due_soon',
  'exam_scheduled', 'revision_plan_ready', 'achievement_unlocked'
);

create table notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references users(id),
  type          notification_type not null,
  title         text not null,
  body          text,
  link_entity_table text,        -- e.g. 'homework_submissions', 'ai_draft_queue'
  link_entity_id     uuid,
  is_read       boolean not null default false,
  created_at    timestamptz not null default now()
);

create index idx_notifications_recipient on notifications (recipient_id, is_read, created_at desc);

-- ----------------------------------------------------------------------------
-- FOUND DURING THE NOTIFICATIONS MODULE'S REGRESSION CHECK (SECURITY_
-- STANDARDS.md §12): this table has never had RLS enabled anywhere in the
-- actual delivered files, despite an earlier session summary describing
-- it as already covered — that description was incorrect, not this fix.
-- Every row has been readable by any `authenticated` session this entire
-- time (RLS disabled = table-level grants apply with no row filtering).
-- Fixed now, using current_user_role() rather than the bare auth.jwt()
-- claim, since SECURITY_STANDARDS.md §1 mandates the safer function for
-- any NEW policy from this point forward.
-- ----------------------------------------------------------------------------

alter table notifications enable row level security;

create policy owner_full_access_notifications on notifications
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

create policy recipient_reads_own_notifications on notifications
  for select using (auth.uid() = recipient_id);

-- Recipients may mark their own notifications read, and only that one
-- field — not retitle/reassign/delete another user's notification.
grant update (is_read) on notifications to authenticated;
create policy recipient_marks_own_notification_read on notifications
  for update using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

-- No client INSERT policy: every notification is written server-side (by
-- an Owner action, a grading event, or a scheduled job), never by a client
-- creating its own notification. This is intentional, not an oversight —
-- confirm before ever adding a broad INSERT grant here.
