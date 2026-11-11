-- Sign-up may name a group that isn't listed yet: it is added to the groups.
-- A name that only differs in case, spaces or punctuation ("group a" for "Group A") joins the existing group.
-- (The register form already asks people to double-check names that look like an existing group.)
-- Run once in the Supabase SQL editor after the earlier migrations.

create or replace function public.group_key(s text) returns text
language sql immutable as $$ select lower(regexp_replace(coalesce(s, ''), '[^[:alnum:]]', '', 'g')) $$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta    jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  fn      text := nullif(trim(meta ->> 'first_name'), '');
  ln      text := nullif(trim(meta ->> 'last_name'), '');
  given   text := left(nullif(trim(meta ->> 'group'), ''), 60);
  grp     text;
  domains jsonb := (select value from settings where key = 'signup_domains');
  dom     text := lower(split_part(new.email, '@', 2));
  pid     uuid;
  sid     uuid;
begin
  select p.id into pid from people p
   where lower(p.email) = lower(new.email)
     and not exists (select 1 from profiles pr where pr.person_id = p.id);

  if pid is null and jsonb_typeof(domains) = 'array' and jsonb_array_length(domains) > 0
     and not exists (select 1 from jsonb_array_elements_text(domains) d
                     where dom = lower(d) or dom like '%.' || lower(d)) then
    raise exception 'Sign-up is restricted to e-mail addresses from: %',
      (select string_agg(d, ', ') from jsonb_array_elements_text(domains) d);
  end if;

  if given is not null and public.group_key(given) <> '' then
    select name into grp from groups where public.group_key(name) = public.group_key(given) order by name limit 1;
    if grp is null then
      insert into groups (name, sort_order)
      values (given, coalesce((select max(sort_order) from groups), 0) + 1)
      on conflict (name) do nothing;
      grp := given;
    end if;
  end if;

  if pid is null and fn is not null and ln is not null then
    select p.id into sid from people p
     where lower(p.first_name) = lower(fn) and lower(p.last_name) = lower(ln)
       and not exists (select 1 from profiles pr where pr.person_id = p.id)
     limit 1;
    if sid is null then
      insert into people (last_name, first_name, group_name, email)
      values (ln, fn, grp, new.email)
      returning id into pid;
    end if;
  end if;

  insert into profiles (id, email, first_name, last_name, group_name, person_id, suggested_person_id)
  values (new.id, new.email, fn, ln, grp, pid, sid);
  return new;
end;
$$;
