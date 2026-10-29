-- Info page & updates, refund requests (with admin succession), issue reports,
-- advance payments on invoices, and per-type notification addresses.
-- Run once in the Supabase SQL editor after 20261021000000_init.sql.

-- ───────────────────────── Settings visibility ─────────────────────────
-- "info" (member guide) is readable by members; "info_admin" and "notifications" by admins only.
create or replace function public.setting_visibility(k text) returns text
language sql immutable as $$
  select case
    when k in ('app_name', 'signup_domains') then 'public'
    when k in ('availability', 'duty', 'balance', 'payment_info', 'info') then 'members'
    else 'admin'
  end
$$;

-- ───────────────────────── Updates (news on the info page) ─────────────────────────
create table public.updates (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null default '',
  audience   text not null default 'all' check (audience in ('all', 'admins')),
  pinned     boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.updates enable row level security;
create policy updates_read on public.updates for select to authenticated
  using (audience = 'all' or public.is_admin());
create policy updates_admin on public.updates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create trigger touch_updates before update on public.updates
  for each row execute function public.touch_updated_at();

-- ───────────────────────── Refund requests ─────────────────────────
create table public.refund_requests (
  id                   uuid primary key default gen_random_uuid(),
  profile_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_id            uuid not null references public.people (id) on delete cascade,
  amount               numeric(10, 2) not null check (amount >= 0),
  method               text,                 -- e.g. PayPal, bank transfer, cash
  details              text,                 -- where to send the money
  leaving              boolean not null default true,
  successor_profile_id uuid references public.profiles (id) on delete set null,
  status               text not null default 'open' check (status in ('open', 'paid', 'rejected')),
  admin_note           text,
  processed_by         uuid references auth.users (id) on delete set null,
  processed_at         timestamptz,
  notified_at          timestamptz,
  notify_error         text,
  created_at           timestamptz not null default now()
);
alter table public.refund_requests enable row level security;
create policy refunds_read on public.refund_requests for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());
create policy refunds_insert on public.refund_requests for insert to authenticated
  with check (profile_id = auth.uid() and person_id = public.my_person_id() and status = 'open'
              -- an admin who leaves must name who takes over
              and (not public.is_admin() or not leaving or successor_profile_id is not null));
create policy refunds_cancel on public.refund_requests for delete to authenticated
  using ((profile_id = auth.uid() and status = 'open') or public.is_admin());
create policy refunds_admin on public.refund_requests for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Pays out a refund: records the payout as a negative payment, takes the person off both lists
-- (when leaving), and hands the admin role to the nominated successor. All or nothing.
create function public.complete_refund(request_id uuid, paid_on date, note text default null)
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
    update people set active_coffee = false, active_drinks = false where id = r.person_id;
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
revoke execute on function public.complete_refund(uuid, date, text) from public, anon;
grant execute on function public.complete_refund(uuid, date, text) to authenticated;

-- ───────────────────────── Issue reports ─────────────────────────
create table public.issues (
  id            uuid primary key default gen_random_uuid(),
  category      text not null check (category in ('milk', 'coffee', 'supplies', 'kitchen', 'machine', 'other')),
  title         text not null,
  description   text,
  reported_by   uuid default auth.uid() references auth.users (id) on delete set null,
  reporter_name text,
  status        text not null default 'open' check (status in ('open', 'resolved')),
  resolution    text,
  resolved_by   uuid references auth.users (id) on delete set null,
  resolved_at   timestamptz,
  notified_at   timestamptz,
  notify_error  text,
  created_at    timestamptz not null default now()
);
alter table public.issues enable row level security;
-- Everyone sees open issues (so the same thing isn't reported five times).
create policy issues_read on public.issues for select to authenticated using (true);
create policy issues_insert on public.issues for insert to authenticated
  with check (reported_by = auth.uid() and status = 'open');
create policy issues_manage on public.issues for update to authenticated
  using (public.can_manage_duties()) with check (public.can_manage_duties());
create policy issues_delete on public.issues for delete to authenticated
  using (public.is_admin() or (reported_by = auth.uid() and status = 'open'));

-- ───────────────────────── Advance payments on invoices ─────────────────────────
alter table public.invoices
  add column kind text not null default 'reimbursement' check (kind in ('reimbursement', 'advance'));
-- An advance request is made before buying, so the date is when the money is needed and a file is optional.

-- ───────────────────────── Grants ─────────────────────────
grant select, insert, update, delete on public.updates, public.refund_requests, public.issues to authenticated;
grant all on public.updates, public.refund_requests, public.issues to service_role;

-- ───────────────────────── Defaults ─────────────────────────
insert into settings (key, value) values
  ('notifications', '{"refund": "", "issues": {"milk": "", "coffee": "", "supplies": "", "kitchen": "", "machine": "", "other": ""}}')
on conflict (key) do nothing;
