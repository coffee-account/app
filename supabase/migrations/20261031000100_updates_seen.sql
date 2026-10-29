-- When each person last saw the Updates on the Info page. Updates posted after this
-- open the Info page once at their next sign-in, even if they chose to skip it.
-- Run once in the Supabase SQL editor after the earlier migrations.
-- Existing and new accounts start at "now", so only updates posted from here on count as new.
alter table public.profiles add column updates_seen_at timestamptz not null default now();
