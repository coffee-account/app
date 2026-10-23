-- Coffee & Drinks accounting: schema, access rules and helper functions.
-- Run once in the Supabase SQL editor (or `supabase db push`).

-- ───────────────────────── Types ─────────────────────────
create type public.list_kind as enum ('coffee', 'drinks');
create type public.availability_status as enum ('available', 'if_needed', 'unavailable');

-- ───────────────────────── Tables ─────────────────────────
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.groups (
  name       text primary key,
  sort_order integer not null default 0
);

create table public.people (
  id               uuid primary key default gen_random_uuid(),
  last_name        text not null,
  first_name       text not null,
  group_name       text references public.groups (name) on update cascade on delete set null,
  legacy_id        text unique,                 -- "lastname.firstname" from the old spreadsheet
  email            text,
  active_coffee    boolean not null default false,
  active_drinks    boolean not null default false,
  starting_balance numeric(10, 2) not null default 0,
  notes            text,
  created_at       timestamptz not null default now()
);
create unique index people_email_key on public.people (lower(email)) where email is not null;

create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  email               text not null,
  first_name          text,
  last_name           text,
  group_name          text,
  role                text not null default 'member' check (role in ('admin', 'member')),
  can_upload_invoices boolean not null default false,
  can_manage_duties   boolean not null default false,
  person_id           uuid unique references public.people (id) on delete set null,
  suggested_person_id uuid references public.people (id) on delete set null,  -- name match awaiting admin approval
  created_at          timestamptz not null default now()
);

create table public.prices (
  id         bigint generated always as identity primary key,
  kind       public.list_kind not null,
  price      numeric(8, 2) not null check (price >= 0),
  valid_from date not null,
  unique (kind, valid_from)
);

create table public.count_sessions (
  id           uuid primary key default gen_random_uuid(),
  kind         public.list_kind not null,
  session_date date not null,
  note         text,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (kind, session_date)
);

create table public.counts (
  session_id uuid not null references public.count_sessions (id) on delete cascade,
  person_id  uuid not null references public.people (id) on delete restrict,
  quantity   integer not null check (quantity >= 0),
  primary key (session_id, person_id)
);

create table public.payments (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.people (id) on delete restrict,
  paid_on    date not null,
  amount     numeric(10, 2) not null,
  method     text,
  note       text,
  source     text not null default 'manual',
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index payments_person_idx on public.payments (person_id);

create table public.list_templates (
  id         uuid primary key default gen_random_uuid(),
  kind       public.list_kind not null,
  name       text not null,
  config     jsonb not null,
  is_default boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (kind, name)
);

create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  submitted_by   uuid default auth.uid() references auth.users (id) on delete set null,
  submitter_name text,
  invoice_date   date not null,
  amount         numeric(10, 2) not null check (amount > 0),
  supplier       text not null,
  description    text,
  reimburse_note text,
  file_path      text,
  file_name      text,
  file_size      integer,
  status         text not null default 'submitted' check (status in ('submitted', 'reimbursed', 'rejected')),
  status_note    text,
  notified_at    timestamptz,
  notify_error   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.availability (
  person_id  uuid not null references public.people (id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),
  status     public.availability_status not null,
  note       text,
  updated_at timestamptz not null default now(),
  primary key (person_id, week_start)
);

create table public.duty_assignments (
  id           uuid primary key default gen_random_uuid(),
  week_start   date not null check (extract(isodow from week_start) = 1),
  person_id    uuid not null references public.people (id) on delete cascade,
  note         text,
  assigned_by  uuid default auth.uid() references auth.users (id) on delete set null,
  notified_at  timestamptz,
  notify_error text,
  created_at   timestamptz not null default now(),
  unique (week_start, person_id)
);

-- ───────────────────────── Permission helpers ─────────────────────────
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
$$;

create function public.can_upload_invoices() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and (role = 'admin' or can_upload_invoices))
$$;

create function public.can_manage_duties() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and (role = 'admin' or can_manage_duties))
$$;

create function public.my_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select person_id from profiles where id = auth.uid()
$$;

-- Settings that may be read before login, and by every member.
create function public.setting_visibility(k text) returns text
language sql immutable as $$
  select case
    when k in ('app_name', 'signup_domains') then 'public'
    when k in ('availability', 'duty', 'balance', 'payment_info') then 'members'
    else 'admin'
  end
$$;

-- ───────────────────────── Triggers ─────────────────────────

-- New sign-up → profile. Links to an existing person by e-mail (set by an admin),
-- suggests a link by exact name match (admin approves), or creates a new person.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta    jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  fn      text := nullif(trim(meta ->> 'first_name'), '');
  ln      text := nullif(trim(meta ->> 'last_name'), '');
  grp     text := (select name from groups where name = nullif(trim(meta ->> 'group'), ''));
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Members may edit their own name fields only; admins everything.
-- The last admin cannot be demoted.
create function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role                := old.role;
    new.can_upload_invoices := old.can_upload_invoices;
    new.can_manage_duties   := old.can_manage_duties;
    new.person_id           := old.person_id;
    new.suggested_person_id := old.suggested_person_id;
    new.email               := old.email;
  end if;
  if old.role = 'admin' and new.role <> 'admin'
     and not exists (select 1 from profiles where role = 'admin' and id <> old.id) then
    raise exception 'At least one admin must remain';
  end if;
  if new.person_id is not null then
    new.suggested_person_id := null;
  end if;
  return new;
end;
$$;

create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- When an account gets linked to a person, give the person that e-mail (used for notifications).
create function public.sync_person_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.person_id is not null and new.person_id is distinct from old.person_id then
    update people set email = new.email
     where id = new.person_id and email is null
       and not exists (select 1 from people where lower(email) = lower(new.email));
  end if;
  return new;
end;
$$;

create trigger sync_person_email
  after update of person_id on public.profiles
  for each row execute function public.sync_person_email();

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger touch_invoices before update on public.invoices
  for each row execute function public.touch_updated_at();
create trigger touch_settings before update on public.settings
  for each row execute function public.touch_updated_at();
create trigger touch_templates before update on public.list_templates
  for each row execute function public.touch_updated_at();
create trigger touch_availability before update on public.availability
  for each row execute function public.touch_updated_at();

-- ───────────────────────── Views ─────────────────────────

-- Names only: lets members see who is on kitchen duty without exposing balances or e-mails.
create view public.people_directory as
  select p.id, p.first_name, p.last_name, p.group_name, p.active_coffee, p.active_drinks,
         exists (select 1 from profiles pr where pr.person_id = p.id) as has_account
    from people p;

-- ───────────────────────── Row level security ─────────────────────────
alter table public.settings         enable row level security;
alter table public.groups           enable row level security;
alter table public.people           enable row level security;
alter table public.profiles         enable row level security;
alter table public.prices           enable row level security;
alter table public.count_sessions   enable row level security;
alter table public.counts           enable row level security;
alter table public.payments         enable row level security;
alter table public.list_templates   enable row level security;
alter table public.invoices         enable row level security;
alter table public.availability     enable row level security;
alter table public.duty_assignments enable row level security;

create policy settings_read_public on public.settings for select to anon, authenticated
  using (public.setting_visibility(key) = 'public');
create policy settings_read_members on public.settings for select to authenticated
  using (public.setting_visibility(key) = 'members' or public.is_admin());
create policy settings_admin on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy groups_read on public.groups for select to anon, authenticated using (true);
create policy groups_admin on public.groups for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy people_read on public.people for select to authenticated
  using (public.is_admin() or id = public.my_person_id());
create policy people_admin on public.people for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

create policy prices_read on public.prices for select to authenticated using (true);
create policy prices_admin on public.prices for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy sessions_read on public.count_sessions for select to authenticated using (true);
create policy sessions_admin on public.count_sessions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy counts_read on public.counts for select to authenticated
  using (public.is_admin() or person_id = public.my_person_id());
create policy counts_admin on public.counts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy payments_read on public.payments for select to authenticated
  using (public.is_admin() or person_id = public.my_person_id());
create policy payments_admin on public.payments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy templates_admin on public.list_templates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy invoices_read on public.invoices for select to authenticated
  using (public.is_admin() or submitted_by = auth.uid());
create policy invoices_insert on public.invoices for insert to authenticated
  with check (public.can_upload_invoices() and submitted_by = auth.uid() and status = 'submitted');
create policy invoices_admin_update on public.invoices for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy invoices_delete on public.invoices for delete to authenticated
  using (public.is_admin() or (submitted_by = auth.uid() and status = 'submitted'));

create policy availability_read on public.availability for select to authenticated
  using (person_id = public.my_person_id() or public.can_manage_duties());
create policy availability_write on public.availability for all to authenticated
  using (person_id = public.my_person_id() or public.can_manage_duties())
  with check (person_id = public.my_person_id() or public.can_manage_duties());

create policy duties_read on public.duty_assignments for select to authenticated using (true);
create policy duties_write on public.duty_assignments for all to authenticated
  using (public.can_manage_duties()) with check (public.can_manage_duties());

-- ───────────────────────── Grants ─────────────────────────
revoke all on all tables in schema public from anon;
grant select on public.settings, public.groups to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke all on public.people_directory from anon;
grant select on public.people_directory to authenticated;

-- ───────────────────────── Invoice file storage ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invoices', 'invoices', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy invoice_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'invoices' and public.can_upload_invoices()
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy invoice_files_read on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));
create policy invoice_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'invoices' and (public.is_admin() or (storage.foldername(name))[1] = auth.uid()::text));

-- ───────────────────────── Spreadsheet import ─────────────────────────
-- Payload is built by the web app from the old .xlsx. Safe to run again:
-- people are matched by legacy_id, sessions by (kind, date), imported payments are replaced.
create function public.import_workbook(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r          jsonb;
  sid        uuid;
  n_people   integer := 0;
  n_sessions integer := 0;
  n_counts   integer := 0;
  n_payments integer := 0;
  c          integer;
begin
  if not public.is_admin() then
    raise exception 'Only admins can import data';
  end if;

  insert into groups (name)
  select distinct g from jsonb_array_elements_text(coalesce(payload -> 'groups', '[]')) g
  on conflict do nothing;

  for r in select * from jsonb_array_elements(coalesce(payload -> 'people', '[]')) loop
    insert into people (legacy_id, last_name, first_name, group_name, active_coffee, active_drinks, starting_balance)
    values (r ->> 'legacy_id', r ->> 'last_name', r ->> 'first_name', nullif(r ->> 'group_name', ''),
            coalesce((r ->> 'active_coffee')::boolean, false), coalesce((r ->> 'active_drinks')::boolean, false),
            coalesce((r ->> 'starting_balance')::numeric, 0))
    on conflict (legacy_id) do update
      set last_name = excluded.last_name, first_name = excluded.first_name, group_name = excluded.group_name,
          active_coffee = excluded.active_coffee, active_drinks = excluded.active_drinks,
          starting_balance = excluded.starting_balance;
    n_people := n_people + 1;
  end loop;

  insert into prices (kind, price, valid_from)
  select (p ->> 'kind')::list_kind, (p ->> 'price')::numeric, (p ->> 'valid_from')::date
    from jsonb_array_elements(coalesce(payload -> 'prices', '[]')) p
  on conflict (kind, valid_from) do update set price = excluded.price;

  for r in select * from jsonb_array_elements(coalesce(payload -> 'sessions', '[]')) loop
    insert into count_sessions (kind, session_date, note)
    values ((r ->> 'kind')::list_kind, (r ->> 'date')::date, 'Imported from spreadsheet')
    on conflict (kind, session_date) do update set note = count_sessions.note
    returning id into sid;
    insert into counts (session_id, person_id, quantity)
    select sid, p.id, round((e.value)::numeric)::integer
      from jsonb_each_text(r -> 'counts') e
      join people p on p.legacy_id = e.key
    on conflict (session_id, person_id) do update set quantity = excluded.quantity;
    get diagnostics c = row_count;
    n_sessions := n_sessions + 1;
    n_counts := n_counts + c;
  end loop;

  delete from payments where source = 'import';
  insert into payments (person_id, paid_on, amount, method, source)
  select p.id, (x ->> 'date')::date, (x ->> 'amount')::numeric, 'Imported', 'import'
    from jsonb_array_elements(coalesce(payload -> 'payments', '[]')) x
    join people p on p.legacy_id = x ->> 'legacy_id';
  get diagnostics n_payments = row_count;

  return jsonb_build_object('people', n_people, 'sessions', n_sessions, 'counts', n_counts, 'payments', n_payments);
end;
$$;

revoke execute on function public.import_workbook(jsonb) from public, anon;
grant execute on function public.import_workbook(jsonb) to authenticated;

-- ───────────────────────── Defaults ─────────────────────────
insert into settings (key, value) values
  ('app_name',       '"Coffee & Drinks"'),
  ('signup_domains', '[]'),
  ('reimbursement',  '{"to": "", "cc_submitter": true}'),
  ('availability',   '{"weeks_ahead": 6, "required_for": "active", "reminders": true}'),
  ('duty',           '{"people_per_week": 2, "info": "", "reminders": true}'),
  ('balance',        '{"low_threshold": -10, "starting_label": "Starting balance"}'),
  ('payment_info',   '""')
on conflict (key) do nothing;

insert into prices (kind, price, valid_from) values
  ('coffee', 0.40, '2000-01-01'),
  ('drinks', 1.00, '2000-01-01')
on conflict do nothing;
