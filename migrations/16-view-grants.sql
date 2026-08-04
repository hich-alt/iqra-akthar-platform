-- ============================================================================
-- اقرأ أكثر... ترى أكثر — 16: EXPLICIT VIEW GRANTS
-- New migration, additive. Run AFTER 15-homework-correction-workflow.sql.
--
-- GAP: zero views in this platform ever received an explicit
-- `grant select ... to authenticated`. Postgres does not give a new role
-- implicit SELECT on a view the way it might on objects covered by a
-- pre-existing `ALTER DEFAULT PRIVILEGES` rule — and this project never
-- established one for views specifically. Every `listResource`/`queryView`
-- call against any of these 18 views could fail with a permission error,
-- not merely return an over-restricted result. This does not change any
-- view's actual row/column gating (RLS on security_invoker views, or the
-- baked-in WHERE clause / current_user_role() check on DEFINER views) —
-- it only makes the already-designed gating reachable at all.
-- ============================================================================

grant select on published_lessons to authenticated;
grant select on owner_lesson_browser_view to authenticated;
grant select on quiz_questions_safe_view to authenticated;
grant select on owner_quiz_questions_view to authenticated;
grant select on student_list_view to authenticated;
grant select on student_academic_progress_view to authenticated;
grant select on student_exam_attempts_view to authenticated;
grant select on student_exam_answers_view to authenticated;
grant select on student_homework_view to authenticated;
grant select on student_latest_readiness_view to authenticated;
grant select on student_visible_revision_plan_view to authenticated;
grant select on attempt_competency_breakdown to authenticated;
grant select on concours_mock_exam_archive to authenticated;
grant select on owner_readiness_ranking_view to authenticated;
grant select on student_current_lesson_view to authenticated;
grant select on owner_pending_correction_view to authenticated;
grant select on owner_non_submitters_view to authenticated;
grant select on prompt_success_rates to authenticated;
-- prompt_success_rates is dead code (RELEASE_NOTES.md already documents
-- this) but granted for consistency — an inert, ungrantable view sitting
-- next to 17 correctly-configured ones is exactly the kind of asymmetry
-- worth avoiding even in something unused.

-- ----------------------------------------------------------------------------
-- owner_quiz_questions_view and owner_pending_correction_view and
-- owner_non_submitters_view and owner_readiness_ranking_view are all
-- correctly SAFE to broadly grant despite their names: each bakes its own
-- `current_user_role() = 'owner'` (or equivalent) check into its WHERE
-- clause, verified individually when each was created. A student session
-- granted SELECT on owner_pending_correction_view still receives zero
-- rows — the grant controls "can you run this query at all," the WHERE
-- clause controls "what comes back," and both are now confirmed present
-- for every Owner-scoped view rather than assumed.
-- ----------------------------------------------------------------------------
