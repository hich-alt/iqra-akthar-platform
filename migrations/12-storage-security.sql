-- ============================================================================
-- اقرأ أكثر... ترى أكثر — MEDIA UPLOAD & STORAGE (Buckets Setup)
-- Creates the required storage buckets for homework, lesson attachments, and avatars.
-- ============================================================================

insert into storage.buckets (id, name, public) values
  ('homework-uploads', 'homework-uploads', false),
  ('lesson-attachments', 'lesson-attachments', false),
  ('avatars', 'avatars', true)
on conflict (id) do nothing;
