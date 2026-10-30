-- Kitchen duty as in the old "Kitchen duties" sheet:
--   * its own pool of people (people.active_duty), independent of the coffee and drinks lists;
--   * fair shares in rounds: the round counter lives in settings ("duty"."round"); a person's
--     target is round − duty_rounds_before, done is duty_carryover + their past assignments;
--   * weeks without kitchen duty (holidays), which need no availability and no assignment.
-- Run once in the Supabase SQL editor after the earlier migrations.

alter table public.people
  add column active_duty        boolean not null default false,
  add column duty_carryover     integer not null default 0,  -- duties done before the app kept track
  add column duty_rounds_before integer not null default 0;  -- rounds that had passed when they joined (negative: owes extra)

-- Until now everyone on a list was in the duty pool.
update public.people set active_duty = active_coffee or active_drinks;

-- Duty managers need the pool and the fairness numbers, not balances or e-mails.
create or replace view public.people_directory as
  select p.id, p.first_name, p.last_name, p.group_name, p.active_coffee, p.active_drinks,
         exists (select 1 from profiles pr where pr.person_id = p.id) as has_account,
         p.active_duty, p.duty_carryover, p.duty_rounds_before
    from people p;

create table public.duty_free_weeks (
  week_start date primary key check (extract(isodow from week_start) = 1),
  note       text,
  created_at timestamptz not null default now()
);
alter table public.duty_free_weeks enable row level security;
create policy duty_free_weeks_read on public.duty_free_weeks for select to authenticated using (true);
create policy duty_free_weeks_write on public.duty_free_weeks for all to authenticated
  using (public.can_manage_duties()) with check (public.can_manage_duties());
grant select, insert, update, delete on public.duty_free_weeks to authenticated;
grant all on public.duty_free_weeks to service_role;

-- Duty managers may start the next round (the "duty" setting), not change other settings.
create policy settings_duty_insert on public.settings for insert to authenticated
  with check (key = 'duty' and public.can_manage_duties());
create policy settings_duty_update on public.settings for update to authenticated
  using (key = 'duty' and public.can_manage_duties()) with check (key = 'duty' and public.can_manage_duties());

-- Leaving members also leave the duty pool.
create or replace function public.complete_refund(request_id uuid, paid_on date, note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r refund_requests;
begin
  if not public.is_admin() then
    raise exception 'Only admins can complete refunds';
  end if;
  select * into r from refund_requests where id = request_id for update;
  if r.id is null then raise exception 'Refund request not found'; end if;
  if r.status <> 'open' then raise exception 'This request has already been handled'; end if;

  if r.amount > 0 then
    insert into payments (person_id, paid_on, amount, method, note, source)
    values (r.person_id, paid_on, -r.amount, 'Refund', coalesce(note, r.method), 'refund');
  end if;
  if r.leaving then
    update people set active_coffee = false, active_drinks = false, active_duty = false where id = r.person_id;
  end if;
  if r.successor_profile_id is not null then
    update profiles set role = 'admin' where id = r.successor_profile_id;
    -- the leaving admin steps down once the successor holds the role
    if r.leaving then
      update profiles set role = 'member' where id = r.profile_id and role = 'admin';
    end if;
  end if;
  update refund_requests
     set status = 'paid', admin_note = note, processed_by = auth.uid(), processed_at = now()
   where id = request_id;
end;
$$;

-- Duty managers adjust a person's target for the current round (stored as rounds before joining,
-- so it keeps counting up with every new round).
create function public.set_duty_target(person uuid, target integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  current_round integer := coalesce((select (value ->> 'round')::integer from settings where key = 'duty'), 0);
begin
  if not public.can_manage_duties() then
    raise exception 'Only duty managers can change duty targets';
  end if;
  if target is null or target < 0 then raise exception 'The target must be 0 or more'; end if;
  update people set duty_rounds_before = current_round - target where id = person;
end;
$$;
revoke execute on function public.set_duty_target(uuid, integer) from public, anon;
grant execute on function public.set_duty_target(uuid, integer) to authenticated;
