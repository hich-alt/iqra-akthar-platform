-- ============================================================================
-- اقرأ أكثر... ترى أكثر — 18: EXTEND student_current_lesson_view
-- New migration, additive. Run AFTER 17-owner-lesson-view-fields.sql.
--
-- The redesigned Hero Task card needs to name the subject ("Arabic
-- Language") — student_current_lesson_view had subject_id but not the
-- name, so every consumer would need a second lookup. Extending the view
-- once, here, rather than joining subjects client-side in every hook that
-- touches it.
-- ============================================================================

drop view if exists student_current_lesson_view;
create view student_current_lesson_view as
select distinct on (l.subject_id)
  l.id as lesson_id, l.subject_id, s.name as subject_name,
  l.title, l.lesson_number, l.status, l.published_at, l.homework_deadline, l.homework_id
from lessons l
join subjects s on s.id = l.subject_id
where l.status in ('published', 'closed')
order by l.subject_id, l.published_at desc nulls last, l.lesson_number desc nulls last;

alter view student_current_lesson_view set (security_invoker = true);
grant select on student_current_lesson_view to authenticated;
