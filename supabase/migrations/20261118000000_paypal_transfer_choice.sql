-- Payments and payouts recorded by hand with another method (cash, bank transfer) no longer change the PayPal
-- balance on their own: the app asks whether the money was moved to (or taken from) the PayPal account and
-- stores the answer in in_paypal. Empty in_paypal keeps the old rule: PayPal payments add, payouts take off.
-- Payouts also get a method ("PayPal" when empty).
-- Run once in the Supabase SQL editor after the earlier migrations.

alter table public.payments add column if not exists in_paypal boolean;
alter table public.payouts add column if not exists in_paypal boolean;
alter table public.payouts add column if not exists method text;

create or replace function public.paypal_balance_from_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r payments;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  if r.source = 'manual' and coalesce(r.in_paypal, r.method ilike 'paypal%') then
    perform public.adjust_paypal_balance(case when tg_op = 'INSERT' then r.amount else -r.amount end);
  end if;
  return null;
end;
$$;

create or replace function public.paypal_balance_from_payout() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r payouts;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  if r.external_id is null and coalesce(r.in_paypal, coalesce(r.method, 'PayPal') ilike 'paypal%') then
    perform public.adjust_paypal_balance(case when tg_op = 'INSERT' then -r.amount else r.amount end);
  end if;
  return null;
end;
$$;
