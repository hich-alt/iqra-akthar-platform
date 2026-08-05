-- ============================================================================
-- PATCH 07a: READINESS CROSS-REFERENCES
-- Restores views and policies that depend on readiness_snapshots (created in 07)
-- but were originally located in 05 and 06.
-- ============================================================================

-- 1. Restore the full student_list_view (with readiness subquery)
-- Since PostgreSQL prevents changing column types in views (numeric to numeric(5,2)),
-- we must drop it first.
drop view if exists student_list_view cascade;

create view student_list_view as
select
  sp.user_id, sp.full_name, sp.status, sp.enrollment_date, sp.avatar_url,
  (select round(avg((a.total_score / nullif(a.max_score,0)) * 100), 1)
     from exam_attempts a where a.student_id = sp.user_id and a.status = 'graded') as exam_average,
  (select count(*) from homework_submissions hs where hs.student_id = sp.user_id and hs.status = 'submitted') as pending_grading_count,
  (select rs.score from readiness_snapshots rs where rs.student_id = sp.user_id order by rs.computed_at desc limit 1) as latest_readiness_score
from student_profiles sp;

-- Re-apply security setting since dropping the view removed it
alter view student_list_view set (security_invoker = true);

-- 2. Restore student_latest_readiness_view
drop view if exists student_latest_readiness_view cascade;
create view student_latest_readiness_view as
select distinct on (student_id)
  student_id, score, breakdown, computed_at
from readiness_snapshots
order by student_id, computed_at desc;

alter view student_latest_readiness_view set (security_invoker = true);

-- 3. Restore readiness_snapshots RLS (from original 05)
alter table readiness_snapshots enable row level security;

create policy owner_full_access_readiness_snapshots on readiness_snapshots
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

create policy student_reads_own_readiness on readiness_snapshots
  for select using (auth.uid() = student_id);

-- 4. Restore parent access policy (from original 06)
create policy parent_reads_linked_readiness on readiness_snapshots
  for select using (is_verified_parent_of(student_id));
