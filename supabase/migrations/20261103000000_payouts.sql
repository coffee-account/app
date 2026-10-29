-- Payouts: money sent from the PayPal account (invoice reimbursements, refunds, purchases),
-- recorded from imported PayPal statements. The newest PayPal balance is kept in settings
-- ("paypal_balance"), readable by everyone who may upload invoices.
-- Run once in the Supabase SQL editor after the earlier migrations.

create table public.payouts (
  id          uuid primary key default gen_random_uuid(),
  paid_on     date not null,
  amount      numeric(10, 2) not null check (amount > 0),
  recipient   text,                       -- name / e-mail as PayPal shows it
  kind        text not null check (kind in ('invoice', 'refund', 'purchase', 'other')),
  invoice_id  uuid references public.invoices (id) on delete set null,
  person_id   uuid references public.people (id) on delete set null,
  note        text,
  external_id text unique,                -- PayPal transaction ID: a payout is never recorded twice
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.payouts enable row level security;
create policy payouts_admin on public.payouts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.payouts to authenticated;
grant all on public.payouts to service_role;

create policy settings_read_paypal_balance on public.settings for select to authenticated
  using (key = 'paypal_balance' and public.can_upload_invoices());
