-- Kitchen-duty availability without signing in (the page behind the QR code).
-- Guests give their name and group. When the name matches exactly one person, their answers fill in
-- weeks that person hasn't answered yet (existing answers are never changed); otherwise the answers
-- wait in guest_availability until a duty manager connects them to a person.
-- Run once in the Supabase SQL editor after the earlier migrations.

create table public.guest_availability (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null,
  last_name   text not null,
  group_name  text,
  answers     jsonb not null,                 -- [{ "week": "2026-11-02", "status": "available", "note": "…" }]
  person_id   uuid references public.people (id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'applied', 'dismissed')),
  handled_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.guest_availability enable row level security;
create policy guest_availability_managers on public.guest_availability for all to authenticated
  using (public.can_manage_duties()) with check (public.can_manage_duties());
grant select, update, delete on public.guest_availability to authenticated;
grant all on public.guest_availability to service_role;

create function public.name_key(s text) returns text
language sql immutable as $$ select lower(regexp_replace(coalesce(s, ''), '[^[:alpha:]]', '', 'g')) $$;

-- What the guest page needs before anyone is signed in.
create function public.guest_availability_info()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'weeks_ahead', coalesce((select (value ->> 'weeks_ahead')::int from settings where key = 'availability'), 6),
    'free_weeks', coalesce((select jsonb_agg(week_start order by week_start) from duty_free_weeks
                             where week_start >= current_date - 7 and week_start < current_date + 210), '[]'::jsonb))
$$;

create function public.submit_guest_availability(first_name text, last_name text, group_name text, answers jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f text := left(trim(first_name), 80);
  l text := left(trim(last_name), 80);
  g text := nullif(left(trim(group_name), 80), '');
  matches uuid[];
  same_group uuid[];
  pid uuid;
  filled int := 0;
  a jsonb;
  w date;
begin
  if f = '' or l = '' then raise exception 'Please give your first and last name'; end if;
  if jsonb_typeof(answers) <> 'array' or jsonb_array_length(answers) = 0 or jsonb_array_length(answers) > 40 then
    raise exception 'Please answer at least one week';
  end if;
  -- Keep the open queue from being flooded.
  if (select count(*) from guest_availability where status = 'pending' and created_at > now() - interval '1 day') >= 200 then
    raise exception 'Too many unconnected answers today; please sign in instead';
  end if;
  for a in select * from jsonb_array_elements(answers) loop
    w := (a ->> 'week')::date;
    if extract(isodow from w) <> 1 or w < current_date - 7 or w > current_date + 210
       or a ->> 'status' not in ('available', 'if_needed', 'unavailable') then
      raise exception 'Invalid answer for week %', a ->> 'week';
    end if;
  end loop;

  -- The same person, also with first and last name swapped; the group decides between namesakes.
  select array_agg(p.id) into matches
    from people p
   where (name_key(p.first_name) = name_key(f) and name_key(p.last_name) = name_key(l))
      or (name_key(p.first_name) = name_key(l) and name_key(p.last_name) = name_key(f));
  if cardinality(matches) = 1 then
    pid := matches[1];
  elsif cardinality(matches) > 1 then
    select array_agg(p.id) into same_group from people p where p.id = any(matches) and p.group_name is not distinct from g;
    if cardinality(same_group) = 1 then pid := same_group[1]; end if;
  end if;

  if pid is not null then
    with ins as (
      insert into availability (person_id, week_start, status, note)
      select pid, (x ->> 'week')::date, (x ->> 'status')::availability_status, nullif(left(x ->> 'note', 200), '')
        from jsonb_array_elements(answers) x
      on conflict (person_id, week_start) do nothing
      returning 1)
    select count(*) into filled from ins;
  end if;
  insert into guest_availability (first_name, last_name, group_name, answers, person_id, status)
  values (f, l, g, answers, pid, case when pid is null then 'pending' else 'applied' end);
  -- has_account: the thank-you page then asks them to sign in next time instead of to register.
  return jsonb_build_object('matched', pid is not null, 'filled', filled,
    'has_account', pid is not null and exists (select 1 from profiles where person_id = pid));
end;
$$;

revoke execute on function public.guest_availability_info() from public;
revoke execute on function public.submit_guest_availability(text, text, text, jsonb) from public;
grant execute on function public.guest_availability_info() to anon, authenticated;
grant execute on function public.submit_guest_availability(text, text, text, jsonb) to anon, authenticated;
