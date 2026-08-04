-- ============================================================================
-- اقرأ أكثر... ترى أكثر — 17: EXTEND owner_lesson_browser_view
-- New migration, additive. Run AFTER 16-view-grants.sql.
--
-- owner_lesson_browser_view predates the lesson lifecycle work (files
-- 13-15) and never picked up publish_date/homework_deadline. Needed now
-- for an accurate "what needs publishing today" filter (use-teacher-
-- today.js) — extending the existing view rather than creating a second,
-- near-duplicate one.
-- ============================================================================

drop view if exists owner_lesson_browser_view;
create view owner_lesson_browser_view as
select
  l.id, l.title, l.status, l.competency_ids, l.display_order, l.updated_at,
  l.publish_date, l.homework_deadline, l.homework_id,
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
-- Unchanged reasoning from the original: no conditional column masking,
-- pure row filter inherited from lessons' RLS.

grant select on owner_lesson_browser_view to authenticated;
-- Re-granted since DROP VIEW removes existing grants along with the view.
