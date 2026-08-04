-- ============================================================================
-- اقرأ أكثر... ترى أكثر — MEDIA UPLOAD & STORAGE
-- Supabase Storage is backed by a real Postgres table (storage.objects)
-- subject to RLS exactly like every other table in this platform — the
-- SAME pattern applies here, not a new one. Verified against
-- SECURITY_STANDARDS.md before being considered complete.
-- ============================================================================

insert into storage.buckets (id, name, public) values
  ('homework-uploads', 'homework-uploads', false),
  ('lesson-attachments', 'lesson-attachments', false),
  ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Path convention for private buckets: {user_id}/{filename} — the RLS
-- policies below check that the first path segment matches auth.uid(),
-- so a student's upload path IS their authorization boundary, not a
-- separate lookup.

alter table storage.objects enable row level security; -- typically already enabled by Supabase; idempotent if so.

create policy owner_full_access_storage on storage.objects
  for all using (current_user_role() = 'owner') with check (current_user_role() = 'owner');

create policy student_manages_own_homework_uploads on storage.objects
  for all
  using (bucket_id = 'homework-uploads' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'homework-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy student_reads_lesson_attachments on storage.objects
  for select using (bucket_id = 'lesson-attachments');
-- Read-only for students — attachments are published lesson content, not
-- per-student data; upload/replace remains Owner-only via the full-access
-- policy above. No parent policy needed: parents don't currently read raw
-- files, only the structured data already covered by is_verified_parent_of().

create policy anyone_reads_avatars on storage.objects
  for select using (bucket_id = 'avatars');
create policy user_manages_own_avatar on storage.objects
  for all
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Column privilege / masking review (SECURITY_STANDARDS.md §4/§5): no
-- conditional column masking applies here — storage.objects rows are
-- either visible (own path, or Owner) or not; no "hide until graded"
-- state exists for a raw file the way it does for a score. No new view
-- needed as a result — a rare case where the standards checklist
-- correctly concludes "nothing further required" rather than mandating
-- one, worth stating explicitly rather than adding an unnecessary view
-- just to look thorough (see Release Rules: "no new abstractions unless
-- strictly required").
