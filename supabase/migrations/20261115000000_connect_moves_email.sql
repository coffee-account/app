-- Connecting an account moves its e-mail to the person it is connected to.
-- Before, the e-mail stayed on another entry that had it (typically the one created at sign-up under a
-- different name), so the right entry got none and adding it by hand failed with a duplicate-key error.
-- The e-mail is only taken from an entry that no account is connected to.
-- Run once in the Supabase SQL editor after the earlier migrations.

create or replace function public.connect_account(profile uuid, person uuid) returns void
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
  -- Take the e-mail off entries no account uses any more, then give it to this person if they have none.
  update people p set email = null
   where lower(p.email) = lower(prof.email) and p.id <> person
     and not exists (select 1 from profiles pr where pr.person_id = p.id);
  update people set email = prof.email
   where id = person and email is null
     and not exists (select 1 from people where lower(email) = lower(prof.email));
end;
$$;
