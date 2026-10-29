-- Per-person choice: open the Info page after signing in (default) or skip it.
-- Run once in the Supabase SQL editor after the earlier migrations.
-- Members may change it on their own profile; guard_profile_update only protects roles and links.
alter table public.profiles add column skip_info boolean not null default false;
