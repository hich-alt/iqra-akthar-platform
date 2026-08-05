-- ============================================================================
-- اقرأ أكثر... ترى أكثر — PARENT PORTAL (new bounded context)
-- Per the master project document: "Cannot modify educational data. Read-only."
-- Per Owner instructions (this session): Owner controls which parent is
-- linked to which student — parents cannot self-link to arbitrary students.
-- ============================================================================

create table parent_profiles (
  user_id       uuid primary key references users(id),
  full_name     text not null,
  contact       text,
  created_at    timestamptz not null default now()
);

create table parent_student_links (
  id            uuid primary key default gen_random_uuid(),
  parent_id     uuid not null references users(id),
  student_id    uuid not null references users(id),
  relationship  text,                              -- 'أب' | 'أم' | 'ولي أمر آخر'
  verified      boolean not null default false, -- Owner must explicitly verify before this grants any read access
  created_at    timestamptz not null default now(),
  unique (parent_id, student_id)
);

create index idx_parent_links_parent on parent_student_links (parent_id);
create index idx_parent_links_student on parent_student_links (student_id);
create index idx_parent_links_verified on parent_student_links (parent_id) where verified = true;

alter table parent_profiles enable row level security;
create policy owner_full_access_parent_profiles on parent_profiles
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy parent_reads_own_profile on parent_profiles
  for select using (auth.uid() = user_id);

alter table parent_student_links enable row level security;
create policy owner_full_access_parent_links on parent_student_links
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
-- Parent can see their own link ROWS (including unverified ones, so the UI
-- can show "pending verification") but this table's own visibility is
-- separate from whether the link GRANTS read access elsewhere — that's
-- gated by `verified = true` inside is_verified_parent_of() below, not here.
create policy parent_reads_own_links on parent_student_links
  for select using (auth.uid() = parent_id);
-- Parents never insert/update their own links — only the Owner verifies
-- them (enforced by owner_full_access_parent_links' `with check`, which
-- requires role='owner' for any write, including insert).

-- ----------------------------------------------------------------------------
-- SINGLE REUSABLE RLS HELPER — every "can this parent read this student's
-- data" policy below calls this instead of repeating the subquery, so the
-- authorization rule for "what makes a parent-student link valid" exists in
-- exactly one place. Marked STABLE (not SECURITY DEFINER): it runs under the
-- invoking parent's own permissions, which is fine since parent_student_links
-- already lets a parent read their own rows via the policy above.
-- ----------------------------------------------------------------------------

create or replace function is_verified_parent_of(p_student_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from parent_student_links
    where parent_id = auth.uid() and student_id = p_student_id and verified = true
  );
$$;

-- ----------------------------------------------------------------------------
-- SUPPLEMENTARY READ-ONLY POLICIES — added to tables security-hardening.sql
-- already secured for Owner/Student. Each is purely additive (parents get a
-- new `for select` policy; no existing Owner/Student policy is touched) and
-- read-only, matching "Cannot modify educational data" exactly — there is
-- no parent INSERT/UPDATE/DELETE policy on any of these tables.
--
-- Column-level grants (student_profiles.notes, quiz_questions.correct_answer)
-- were revoked from the `authenticated` role broadly in security-hardening.sql,
-- so they apply here automatically — a parent session gets the same safe
-- column set as a student session, with no additional configuration needed.
-- ----------------------------------------------------------------------------

create policy parent_reads_linked_student_profile on student_profiles
  for select using (is_verified_parent_of(user_id));

create policy parent_reads_linked_homework on homework_submissions
  for select using (is_verified_parent_of(student_id));

create policy parent_reads_linked_exam_attempts on exam_attempts
  for select using (is_verified_parent_of(student_id));

create policy parent_reads_linked_competency_scores on competency_scores
  for select using (is_verified_parent_of(student_id));

create policy parent_reads_linked_activity_log on student_activity_log
  for select using (is_verified_parent_of(student_id));

-- ----------------------------------------------------------------------------
-- Parent-facing views mirror the student-facing ones exactly (same column
-- shape, same visibility rules) rather than inventing a parallel structure —
-- the ONLY difference from the student views is which RLS policy matches.
-- Reusing student_homework_view / student_exam_attempts_view / etc. directly
-- (all already security_invoker) means no new views are needed at all.
-- ----------------------------------------------------------------------------
