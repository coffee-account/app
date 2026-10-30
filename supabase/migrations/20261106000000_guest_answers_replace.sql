-- Guest availability: answers from the QR-code form now replace earlier answers for the same weeks,
-- so the newest answer counts wherever it was given (signed in or as a guest).
-- Run once in the Supabase SQL editor after 20261105000000_guest_availability.sql.

create or replace function public.submit_guest_availability(first_name text, last_name text, group_name text, answers jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f text := left(trim(first_name), 80);
  l text := left(trim(last_name), 80);
  g text := nullif(left(trim(group_name), 80), '');
  matches uuid[];
  same_group uuid[];
  pid uuid;
  saved int := 0;
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
      on conflict (person_id, week_start) do update
        set status = excluded.status, note = excluded.note, updated_at = now()
      returning 1)
    select count(*) into saved from ins;
  end if;
  insert into guest_availability (first_name, last_name, group_name, answers, person_id, status)
  values (f, l, g, answers, pid, case when pid is null then 'pending' else 'applied' end);
  -- has_account: the thank-you page then asks them to sign in next time instead of to register.
  return jsonb_build_object('matched', pid is not null, 'saved', saved,
    'has_account', pid is not null and exists (select 1 from profiles where person_id = pid));
end;
$$;
