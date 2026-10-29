-- Group admins (manage one group: people, account connections, balances, payments, counts;
-- see admin-only messages; no admin settings) and the separate "resolve reports" right.
-- Run once in the Supabase SQL editor after the earlier migrations.

-- ───────────────────────── Profiles ─────────────────────────
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'group_admin', 'member'));
alter table public.profiles add column managed_group text references public.groups (name) on update cascade on delete set null;
alter table public.profiles add column can_resolve_reports boolean not null default false;

-- ───────────────────────── Permission helpers ─────────────────────────
create function public.my_managed_group() returns text
language sql stable security definer set search_path = public as $$
  select managed_group from profiles where id = auth.uid() and role = 'group_admin'
$$;

create function public.is_group_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_managed_group() is not null
$$;

-- Admins manage everyone; a group admin manages the people of their group.
create function public.can_manage_person(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from people where id = pid and group_name = public.my_managed_group())
$$;

create function public.can_resolve_reports() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and (role = 'admin' or can_resolve_reports))
$$;

-- Admin-only messages (updates, admin part of the info page) are also for group admins.
create function public.sees_admin_messages() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_group_admin()
$$;

-- Only admins hand out roles and rights. Runs with the caller's role (no security definer):
-- direct updates from the app arrive as "authenticated" and are guarded, while
-- connect_account / disconnect_account run as the owner after their own group checks.
create or replace function public.guard_profile_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    new.role                := old.role;
    new.can_upload_invoices := old.can_upload_invoices;
    new.can_manage_duties   := old.can_manage_duties;
    new.can_resolve_reports := old.can_resolve_reports;
    new.managed_group       := old.managed_group;
    new.email               := old.email;
    new.person_id           := old.person_id;
    new.suggested_person_id := old.suggested_person_id;
  end if;
  if old.role = 'admin' and new.role <> 'admin'
     and not exists (select 1 from profiles where role = 'admin' and id <> old.id) then
    raise exception 'At least one admin must remain';
  end if;
  if new.role = 'group_admin' and new.managed_group is null then
    raise exception 'A group admin needs a group';
  end if;
  if new.person_id is not null then
    new.suggested_person_id := null;
  end if;
  return new;
end;
$$;

-- ───────────────────────── People ─────────────────────────
drop policy people_read on public.people;
create policy people_read on public.people for select to authenticated
  using (public.is_admin() or id = public.my_person_id() or group_name = public.my_managed_group());
create policy people_group_admin on public.people for all to authenticated
  using (group_name = public.my_managed_group())
  with check (group_name = public.my_managed_group());

-- ───────────────────────── Accounts of the group ─────────────────────────
-- Group admins see accounts that registered for their group or belong to its people.
create policy profiles_group_read on public.profiles for select to authenticated
  using (public.is_group_admin() and (
    group_name = public.my_managed_group()
    or exists (select 1 from people p where p.id in (person_id, suggested_person_id) and p.group_name = public.my_managed_group())));

-- Connecting goes through these functions so a group admin can't touch roles or other groups.
create function public.connect_account(profile uuid, person uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  prof profiles;
begin
  select * into prof from profiles where id = profile;
  if prof.id is null then raise exception 'Account not found'; end if;
  if not public.can_manage_person(person) then raise exception 'You can only connect accounts to people of your group'; end if;
  if prof.person_id is not null and not public.can_manage_person(prof.person_id) then
    raise exception 'This account belongs to someone outside your group';
  end if;
  if exists (select 1 from profiles where person_id = person and id <> profile) then
    raise exception 'This person is already connected to another account';
  end if;
  update profiles set person_id = person, suggested_person_id = null where id = profile;
  update people set email = prof.email
   where id = person and email is null
     and not exists (select 1 from people where lower(email) = lower(prof.email));
end;
$$;

create function public.disconnect_account(profile uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  prof profiles;
begin
  select * into prof from profiles where id = profile;
  if prof.person_id is null then return; end if;
  if not public.can_manage_person(prof.person_id) then raise exception 'You can only manage accounts of your group'; end if;
  update profiles set person_id = null where id = profile;
end;
$$;

revoke execute on function public.connect_account(uuid, uuid), public.disconnect_account(uuid) from public, anon;
grant execute on function public.connect_account(uuid, uuid), public.disconnect_account(uuid) to authenticated;

-- ───────────────────────── Counting & payments ─────────────────────────
-- Group admins may start a count session (shared by all groups) but not change or delete one.
create policy sessions_group_insert on public.count_sessions for insert to authenticated
  with check (public.is_group_admin());

drop policy counts_read on public.counts;
create policy counts_read on public.counts for select to authenticated
  using (public.can_manage_person(person_id) or person_id = public.my_person_id());
create policy counts_group_admin on public.counts for all to authenticated
  using (public.is_group_admin() and public.can_manage_person(person_id))
  with check (public.is_group_admin() and public.can_manage_person(person_id));

drop policy payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (public.can_manage_person(person_id) or person_id = public.my_person_id());
create policy payments_group_insert on public.payments for insert to authenticated
  with check (public.is_group_admin() and public.can_manage_person(person_id));
create policy payments_group_delete on public.payments for delete to authenticated
  using (public.is_group_admin() and public.can_manage_person(person_id));

-- ───────────────────────── Admin messages ─────────────────────────
drop policy updates_read on public.updates;
create policy updates_read on public.updates for select to authenticated
  using (audience = 'all' or public.sees_admin_messages());
create policy settings_read_admin_info on public.settings for select to authenticated
  using (key = 'info_admin' and public.is_group_admin());

-- ───────────────────────── Resolving reports ─────────────────────────
drop policy issues_manage on public.issues;
create policy issues_manage on public.issues for update to authenticated
  using (public.can_resolve_reports()) with check (public.can_resolve_reports());

-- Starting balances are bookkeeping: only admins set or change them.
create function public.guard_people_write() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.starting_balance := 0;
      new.legacy_id := null;
    else
      new.starting_balance := old.starting_balance;
      new.legacy_id := old.legacy_id;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_people_write
  before insert or update on public.people
  for each row execute function public.guard_people_write();
