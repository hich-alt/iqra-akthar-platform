-- ============================================================================
-- اقرأ أكثر... ترى أكثر — 00: USERS BOOTSTRAP
-- MUST run first, before any of the 12 files listed in DEPLOYMENT_CHECKLIST.md.
--
-- GAP FOUND DURING PRODUCTION VALIDATION (not present anywhere in RC1):
-- every schema file's `references users(id)` assumes this table already
-- exists. DEPLOYMENT_CHECKLIST.md flagged "confirm users table strategy"
-- as a checkbox but no file ever actually created one. This is that file.
-- ============================================================================

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "users read own row" on public.users
  for select using (auth.uid() = id);

-- Runs automatically whenever someone signs up via Supabase Auth, keeping
-- public.users in sync with the built-in auth.users table.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
