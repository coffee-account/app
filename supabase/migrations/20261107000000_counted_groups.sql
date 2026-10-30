-- Which groups have been counted for each counting session (a simple tick per group).
-- Admins tick any group; group admins tick their own.
-- Run once in the Supabase SQL editor after the earlier migrations.

create table public.counted_groups (
  session_id uuid not null references public.count_sessions (id) on delete cascade,
  group_name text not null references public.groups (name) on update cascade on delete cascade,
  done_by    uuid default auth.uid() references auth.users (id) on delete set null,
  done_at    timestamptz not null default now(),
  primary key (session_id, group_name)
);
alter table public.counted_groups enable row level security;
create policy counted_groups_read on public.counted_groups for select to authenticated using (true);
create policy counted_groups_write on public.counted_groups for all to authenticated
  using (public.is_admin() or group_name = public.my_managed_group())
  with check (public.is_admin() or group_name = public.my_managed_group());
grant select, insert, delete on public.counted_groups to authenticated;
grant all on public.counted_groups to service_role;
