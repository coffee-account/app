-- Editable e-mails: every e-mail the notify function sends takes its subject and text from here.
-- Duty managers edit the kitchen-duty e-mails, people who resolve reports the issue e-mails, admins all of them.
-- Also: duty managers may put people into and out of the kitchen-duty pool, the first-steps guide,
-- and availability without signing in (the QR-code form) is gone.
-- Run once in the Supabase SQL editor after the earlier migrations, then redeploy the notify function.

create table public.email_templates (
  key        text primary key,
  subject    text not null,
  body       text not null,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create function public.can_edit_email(k text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when k in ('duty_assigned', 'duty_removed', 'duty_reminder', 'availability_reminder') then public.can_manage_duties()
    when k in ('issue_reported', 'issue_resolved') then public.can_resolve_reports()
    else public.is_admin()
  end
$$;

alter table public.email_templates enable row level security;
create policy email_templates_read on public.email_templates for select to authenticated
  using (public.can_edit_email(key));
create policy email_templates_update on public.email_templates for update to authenticated
  using (public.can_edit_email(key)) with check (public.can_edit_email(key));
grant select, update on public.email_templates to authenticated;
grant all on public.email_templates to service_role;
-- Who changed a text last, and when.
create function public.stamp_email_template() returns trigger
language plpgsql as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;
create trigger stamp_email_templates before update on public.email_templates
  for each row execute function public.stamp_email_template();

-- Same texts as web/src/lib/email-templates.js.
insert into public.email_templates (key, subject, body) values
  ('duty_assigned', $s$Kitchen duty: {week}$s$, $b$Hi {first_name},

you have been assigned to kitchen duty in **{week}**.
You share it with {mates}.
Note: {note}

What to do during your week: [Kitchen duties](https://pad.gwdg.de/r4sTfbuzTH6UCXbkppGjJA?both#Kitchen-duties)

If you cannot make it, please swap with someone and tell the duty managers.$b$),
  ('duty_removed', $s$Kitchen duty cancelled: {week}$s$, $b$Hi {first_name}, you are no longer on kitchen duty in **{week}**.$b$),
  ('duty_reminder', $s$Reminder: kitchen duty this week ({week})$s$, $b$Hi {first_name}, a reminder that you are on kitchen duty in **{week}**.
You share it with {mates}.

What to do during your week: [Kitchen duties](https://pad.gwdg.de/r4sTfbuzTH6UCXbkppGjJA?both#Kitchen-duties)$b$),
  ('availability_reminder', $s$Reminder: please fill in your kitchen-duty availability$s$, $b$Hi {first_name},

your kitchen-duty availability is running out. Please answer these weeks:

{weeks}

[Fill in availability]({app_url}#/availability)$b$),
  ('issue_reported', $s$Reported: {category} – {title}$s$, $b${details}

[Open the issue list]({app_url}#/issues) to mark it as resolved.$b$),
  ('issue_resolved', $s$Resolved: {title}$s$, $b$Thanks for reporting. "{title}" has been marked as resolved.

{resolution}$b$),
  ('invoice_submitted', $s$Reimbursement request: {amount} – {supplier}$s$, $b${submitter} has uploaded an invoice to be reimbursed.

{details}

Pay it out, then mark it as reimbursed under [Invoices]({app_url}#/invoices).$b$),
  ('advance_requested', $s$Advance payment request: {amount} – {supplier}$s$, $b${submitter} would like the money in advance for something they will buy for the kitchen.

{details}

The receipt will follow once the purchase has been made.$b$),
  ('refund_requested', $s$Refund request: {amount} – {person}$s$, $b${details}

Pay it out, then mark it as paid under [Refunds]({app_url}#/refunds).$b$),
  ('leaving_requested', $s$Leaving: {person}$s$, $b${details}

There is nothing to pay out. Confirm it under [Refunds]({app_url}#/refunds) with "Mark as paid" to take them off the lists.$b$);

-- The duty instructions from Settings used to be added to duty e-mails; keep them in the new texts.
update public.email_templates t
   set body = t.body || E'\n\n' || (s.value ->> 'info')
  from public.settings s
 where s.key = 'duty' and coalesce(s.value ->> 'info', '') <> ''
   and t.key in ('duty_assigned', 'duty_reminder');

-- Availability: nobody is asked while the next min_weeks weeks are answered; then up to weeks_ahead.
update public.settings set value = value || '{"min_weeks": 3}'::jsonb
 where key = 'availability' and not value ? 'min_weeks';

-- Duty managers put people into or out of the kitchen-duty pool. Someone joining without any duty
-- history owes duties from the current round on, as when an admin ticks it under People.
create function public.set_duty_pool(person uuid, in_pool boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  current_round integer := coalesce((select (value ->> 'round')::integer from settings where key = 'duty'), 0);
begin
  if not public.can_manage_duties() then
    raise exception 'Only duty managers can change the duty pool';
  end if;
  update people
     set active_duty = in_pool,
         duty_rounds_before = case
           when in_pool and not active_duty and duty_rounds_before = 0 and duty_carryover = 0 then current_round
           else duty_rounds_before end
   where id = person;
end;
$$;
revoke execute on function public.set_duty_pool(uuid, boolean) from public, anon;
grant execute on function public.set_duty_pool(uuid, boolean) to authenticated;

-- First steps: which parts of the tour someone has seen ("member", "group_admin", "duty", "admin")
-- and "checklist" once the getting-started list is hidden. People change it on their own profile;
-- guard_profile_update only protects roles and links.
alter table public.profiles add column guide_seen text[] not null default '{}';

-- Availability without signing in (the QR-code form) is gone: everyone answers in the app.
-- Pending guest answers that were never connected to a person are dropped with it.
drop function if exists public.submit_guest_availability(text, text, text, jsonb);
drop function if exists public.guest_availability_info();
drop function if exists public.name_key(text);
drop table if exists public.guest_availability;
