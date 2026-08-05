-- ============================================================================
-- اقرأ أكثر... ترى أكثر — SECURITY HARDENING
-- Run AFTER all other schema files. Closes column-level authorization
-- bypasses that RLS alone cannot fix (RLS filters ROWS, not COLUMNS).
--
-- THE BUG CLASS: a sensitive column exists on a table a student is
-- otherwise legitimately allowed to SELECT from. RLS correctly restricts
-- WHICH ROWS they see, but says nothing about WHICH COLUMNS.
-- ============================================================================

-- NOTE: The recreation of 'user_roles' table and 'current_user_role()' function 
-- have been deliberately removed from this patch to preserve the JWT-based 
-- authentication model implemented earlier, preventing a platform-wide lockout.

-- ----------------------------------------------------------------------------
-- 1. student_profiles.notes — Owner-private, never for student/parent
-- ----------------------------------------------------------------------------

revoke select on student_profiles from authenticated;
grant select (
  user_id, full_name, date_of_birth, guardian_name, guardian_contact,
  enrollment_date, status, avatar_url, created_at, updated_at
) on student_profiles to authenticated;

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

-- ----------------------------------------------------------------------------
-- 2. quiz_questions.correct_answer / .rationale — the exam answer key.
-- ----------------------------------------------------------------------------

alter table quiz_questions enable row level security;
create policy owner_full_access_quiz_questions on quiz_questions
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

revoke select on quiz_questions from authenticated;
grant select (
  id, prompt, type, options, competency_id, difficulty, source, is_active, created_at
) on quiz_questions to authenticated;

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

-- ----------------------------------------------------------------------------
-- 3. exams 
-- ----------------------------------------------------------------------------

alter table exams enable row level security;
create policy owner_full_access_exams on exams
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');
create policy student_reads_released_exams on exams
  for select using (status in ('scheduled', 'active', 'closed'));

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
-- 4. homework / homework_questions
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
-- 5. Curriculum Structural Tables
-- ----------------------------------------------------------------------------

alter table competencies enable row level security;
create policy authenticated_reads_competencies on competencies for select using (auth.role() = 'authenticated');
create policy owner_writes_competencies on competencies for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

alter table academic_years enable row level security;
create policy authenticated_reads_academic_years on academic_years for select using (auth.role() = 'authenticated');
create policy owner_writes_academic_years on academic_years for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

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
