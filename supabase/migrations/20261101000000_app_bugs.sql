-- Bug reports about the app itself, kept apart from kitchen issues.
-- Run once in the Supabase SQL editor after the earlier migrations.
alter table public.issues drop constraint issues_category_check;
alter table public.issues add constraint issues_category_check
  check (category in ('milk', 'coffee', 'supplies', 'kitchen', 'machine', 'other', 'app'));
-- For app bugs: page, browser and screen size, filled in automatically.
alter table public.issues add column context text;

-- Default recipients for app bugs: empty = all admins.
update public.settings
   set value = jsonb_set(value, '{issues,app}', '""', true)
 where key = 'notifications' and not (value -> 'issues' ? 'app');
