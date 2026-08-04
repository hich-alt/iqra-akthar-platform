-- ============================================================================
-- اقرأ أكثر... ترى أكثر — SECURITY HARDENING
-- Run AFTER all other schema files. Closes column-level authorization
-- bypasses that RLS alone cannot fix (RLS filters ROWS, not COLUMNS).
--
-- THE BUG CLASS: a sensitive column exists on a table a student is
-- otherwise legitimately allowed to SELECT from. RLS correctly restricts
-- WHICH ROWS they see, but says nothing about WHICH COLUMNS — so any
-- direct Supabase query (bypassing whatever React component/hook was
-- "supposed" to hide the field) still returns it. Found three instances:
--   1. homework_submissions.feedback/total_score/max_score/competency_evaluation
--      (fixed in student-management-schema.sql via student_homework_view)

-- ============================================================================
-- ROOT OF TRUST — moved here from exam-threat-model-fixes.sql now that the
-- platform-wide migration off `auth.jwt() ->> 'role'` is happening (that
-- migration was SECURITY_STANDARDS.md §1's flagged outstanding item; this
-- file is the earliest one needing current_user_role(), so the definition
-- moved here rather than being duplicated). See exam-threat-model-fixes.sql
-- for the full rationale of why the bare JWT claim isn't trusted directly.
-- ============================================================================

create table if not exists user_roles (
  user_id   uuid primary key references users(id),
  role      text not null check (role in ('owner', 'student', 'parent')),
  set_at    timestamptz not null default now(),
  set_by    uuid references users(id)
);

alter table user_roles enable row level security;
create policy no_client_writes_user_roles on user_roles for all using (false) with check (false);
create policy authenticated_reads_own_role on user_roles for select using (auth.uid() = user_id);

create or replace function current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from user_roles where user_id = auth.uid();
$$;

revoke all on function current_user_role() from public;
grant execute on function current_user_role() to authenticated;
--   2. student_profiles.notes (fixed below)
--   3. quiz_questions.correct_answer (fixed below — the most serious one:
--      this is the exam answer key, readable by any student who queries
--      quiz_questions directly instead of going through the app's UI)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. student_profiles.notes — Owner-private, never for student/parent
-- ----------------------------------------------------------------------------

-- REVOKE, not just "don't select it in the view": a view alone doesn't stop
-- someone querying the base table directly if they still have column
-- privilege on it. This makes `select notes from student_profiles` fail
-- with a Postgres permission error for the `authenticated` role, full stop.
revoke select on student_profiles from authenticated;
grant select (
  user_id, full_name, date_of_birth, guardian_name, guardian_contact,
  enrollment_date, status, avatar_url, created_at, updated_at
) on student_profiles to authenticated;
-- Owner writes (insert/update/delete) still go through RLS's
-- owner_full_access_student_profiles policy, unaffected by this — column
-- privileges and RLS are independent, complementary layers.

-- SUPERSEDED by exam-threat-model-fixes.sql, which redefines this function
-- to (a) check current_user_role() instead of the bare auth.jwt() claim,
-- and (b) write a security_audit_log entry. `create or replace` means the
-- later definition is what's actually active once both files have run;
-- kept here only as sequential migration history.
create or replace function get_student_notes(p_student_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user_role() != 'owner' then
    raise exception 'ليست لديك صلاحية الوصول إلى هذه الملاحظات';
  end if;
  return (select notes from student_profiles where user_id = p_student_id);
end;
$$;

revoke all on function get_student_notes(uuid) from public;
grant execute on function get_student_notes(uuid) to authenticated;
-- Client usage: supabase.rpc('get_student_notes', { p_student_id: id })
-- Not wired into any UI yet — no Owner "private notes" screen exists.
-- Wire through this RPC when that screen is built; never re-add a direct
-- `notes` column read anywhere in the frontend.

-- ----------------------------------------------------------------------------
-- 2. quiz_questions.correct_answer / .rationale — the exam answer key.
-- This is the most serious instance: students legitimately need to SELECT
-- from quiz_questions (to see the question prompt/options while taking an
-- exam), but must never receive correct_answer alongside it.
-- ----------------------------------------------------------------------------

alter table quiz_questions enable row level security;
create policy owner_full_access_quiz_questions on quiz_questions
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

revoke select on quiz_questions from authenticated;
grant select (
  id, prompt, type, options, competency_id, difficulty, source, is_active, created_at
  -- correct_answer and rationale deliberately excluded
) on quiz_questions to authenticated;

-- FOUND WHILE BUILDING EXAM SYSTEM'S CLIENT HOOKS — two compounding bugs:
-- 1. The column GRANT above is necessary but not sufficient: RLS still had
--    only owner_full_access_quiz_questions, meaning NO ROW was visible to a
--    student at all (RLS denies by default absent a matching policy),
--    regardless of which columns were granted. Students could read zero
--    questions — silently breaking exam/quiz-taking entirely, not "safely"
--    hiding the answer key as intended.
-- 2. api-client.js's generic listResource/getResource use `.select("*")`.
--    Postgres requires SELECT privilege on EVERY column a `*` expands to —
--    since correct_answer/rationale were revoked, `select *` against this
--    table would error outright for a student session, not just omit those
--    columns. Client code must query quiz_questions_safe_view (explicit
--    column list) instead of the base table directly; this is now the one
--    exception to "listResource/getResource work on any table" and is
--    documented here so it isn't rediscovered as a mystery bug later.
create policy student_reads_questions_via_released_assignment on quiz_questions
  for select using (
    exists (
      select 1 from exam_section_questions esq
      join exam_sections s on s.id = esq.section_id
      join exams e on e.id = s.exam_id
      where esq.question_id = quiz_questions.id and e.status in ('scheduled', 'active', 'closed')
    )
    or exists (
      select 1 from homework_questions hq
      join homework h on h.id = hq.homework_id
      where hq.question_id = quiz_questions.id and h.status in ('assigned', 'closed')
    )
  );

create view quiz_questions_safe_view as
select id, prompt, type, options, competency_id, difficulty, source, is_active, created_at
from quiz_questions;

alter view quiz_questions_safe_view set (security_invoker = true);
-- Client code (exam-taking UI, quiz browsing) MUST query this view, never
-- `quiz_questions` directly via listResource/getResource — see note above.

-- Grading (exam-attempt-service.js's _compareAnswer, homework auto-grading)
-- MUST run server-side under the service_role key (an Edge Function
-- triggered on submit), never in the browser bundle — service_role bypasses
-- both RLS and column grants entirely, which is exactly why it must never
-- be shipped to a client. See CLIENT-SERVER-BOUNDARY.md for the explicit
-- list of which existing files belong on which side of that line; this
-- migration is what makes that boundary actually load-bearing rather than
-- a documentation convention someone could forget.

-- exam_answers.is_correct / points_awarded are the GRADED OUTCOME, not the
-- answer key itself — safe for students to read (they should see whether
-- their own answer was marked correct after grading). No column restriction
-- needed there; RLS row-scoping (student_manages_own_answers, already
-- defined in student-management-schema.sql) is sufficient.

-- ----------------------------------------------------------------------------
-- 3. exams — was missing RLS entirely; any authenticated client could
-- previously read every exam including unpublished drafts (e.g. a mock
-- concours not yet meant to be visible).
-- ----------------------------------------------------------------------------

alter table exams enable row level security;
create policy owner_full_access_exams on exams
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy student_reads_released_exams on exams
  for select using (status in ('scheduled', 'active', 'closed'));
  -- 'draft' and 'archived' remain owner-only.

alter table exam_sections enable row level security;
create policy owner_full_access_exam_sections on exam_sections
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy student_reads_sections_of_released_exams on exam_sections
  for select using (exists (select 1 from exams e where e.id = exam_sections.exam_id and e.status in ('scheduled','active','closed')));

alter table exam_section_questions enable row level security;
create policy owner_full_access_exam_section_questions on exam_section_questions
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy student_reads_questions_of_released_exams on exam_section_questions
  for select using (exists (
    select 1 from exam_sections s join exams e on e.id = s.exam_id
    where s.id = exam_section_questions.section_id and e.status in ('scheduled','active','closed')
  ));

-- ----------------------------------------------------------------------------
-- 4. homework / homework_questions — same "was completely open" gap as exams.
-- ----------------------------------------------------------------------------

alter table homework enable row level security;
create policy owner_full_access_homework on homework
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy student_reads_assigned_homework on homework
  for select using (status in ('assigned', 'closed'));

alter table homework_questions enable row level security;
create policy owner_full_access_homework_questions on homework_questions
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy student_reads_questions_of_assigned_homework on homework_questions
  for select using (exists (
    select 1 from homework h where h.id = homework_questions.homework_id and h.status in ('assigned','closed')
  ));

-- ----------------------------------------------------------------------------
-- 5. competencies / curriculum_weeks / terms / academic_years / subjects /
-- educational_fields — not sensitive content, but had no RLS. Enabling with
-- an open authenticated-read policy makes the "every table has RLS enabled"
-- guarantee actually true platform-wide, rather than true "except where we
-- didn't think it mattered."
-- ----------------------------------------------------------------------------

alter table competencies enable row level security;
create policy authenticated_reads_competencies on competencies for select using (auth.role() = 'authenticated');
create policy owner_writes_competencies on competencies for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

alter table academic_years enable row level security;
create policy authenticated_reads_academic_years on academic_years for select using (auth.role() = 'authenticated');
create policy owner_writes_academic_years on academic_years for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

-- ----------------------------------------------------------------------------
-- Added for Curriculum Manager: the unique partial index
-- idx_one_current_year (is_current) where is_current = true means two
-- sequential client-side updates (unset old current year, set new one)
-- could race under concurrent access, or leave zero years marked current
-- if the second update fails. A single-transaction RPC is the correct fix.
-- ----------------------------------------------------------------------------

-- SUPERSEDED by exam-threat-model-fixes.sql: the redefined version checks
-- current_user_role(), validates p_year_id exists BEFORE mutating anything
-- (this original silently left zero years marked current on bad input),
-- and writes a security_audit_log entry.
create or replace function set_current_academic_year(p_year_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user_role() != 'owner' then
    raise exception 'ليست لديك صلاحية تغيير السنة الدراسية الحالية';
  end if;
  update academic_years set is_current = false where is_current = true;
  update academic_years set is_current = true where id = p_year_id;
end;
$$;

revoke all on function set_current_academic_year(uuid) from public;
grant execute on function set_current_academic_year(uuid) to authenticated;
-- Client usage: supabase.rpc('set_current_academic_year', { p_year_id: id })

-- Same pattern, extended to the remaining structural curriculum tables
-- (found inconsistent while adding owner_lesson_browser_view for Lesson
-- Editor — these joins would otherwise run against tables with RLS
-- disabled while academic_years right above them had it enabled).
alter table educational_fields enable row level security;
create policy authenticated_reads_fields on educational_fields for select using (auth.role() = 'authenticated');
create policy owner_writes_fields on educational_fields for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

alter table subjects enable row level security;
create policy authenticated_reads_subjects on subjects for select using (auth.role() = 'authenticated');
create policy owner_writes_subjects on subjects for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

alter table terms enable row level security;
create policy authenticated_reads_terms on terms for select using (auth.role() = 'authenticated');
create policy owner_writes_terms on terms for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

alter table curriculum_weeks enable row level security;
create policy authenticated_reads_weeks on curriculum_weeks for select using (auth.role() = 'authenticated');
create policy owner_writes_weeks on curriculum_weeks for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
