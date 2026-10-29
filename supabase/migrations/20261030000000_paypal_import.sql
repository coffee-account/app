-- PayPal statement import: remembered payers, transaction IDs on payments, skipped transactions.
-- Run once in the Supabase SQL editor after the earlier migrations.

-- PayPal's transaction ID on imported payments; unique, so a statement can be imported twice safely.
alter table public.payments add column external_id text unique;
alter table public.payments add column payer text; -- name / e-mail as PayPal shows it

-- "This PayPal e-mail / name belongs to this person", learned from earlier imports.
create table public.payer_aliases (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references public.people (id) on delete cascade,
  kind       text not null check (kind in ('email', 'name')),
  value      text not null,               -- stored lower-case
  created_at timestamptz not null default now(),
  unique (kind, value)
);

-- Incoming PayPal transactions an admin marked as "not coffee money", so they aren't offered again.
create table public.ignored_transactions (
  external_id text primary key,
  payer       text,
  amount      numeric(10, 2),
  paid_on     date,
  created_at  timestamptz not null default now()
);

alter table public.payer_aliases enable row level security;
alter table public.ignored_transactions enable row level security;
create policy aliases_admin on public.payer_aliases for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy ignored_admin on public.ignored_transactions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.payer_aliases, public.ignored_transactions to authenticated;
grant all on public.payer_aliases, public.ignored_transactions to service_role;
