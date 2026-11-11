-- PayPal balance follows what is recorded by hand:
--   * a payment entered with method "PayPal…" (Payments page) adds to it, deleting it takes it off again;
--   * a payout recorded by hand (no PayPal transaction ID) takes from it, removing it adds it back.
-- Imported statements still set the balance from the file, which already includes everything.
-- Admins can also set the balance by hand (settings "paypal_balance", source "manual").
-- Run once in the Supabase SQL editor after the earlier migrations.

create function public.adjust_paypal_balance(delta numeric) returns void
language sql security definer set search_path = public as $$
  update settings
     set value = value || jsonb_build_object('amount', round((value ->> 'amount')::numeric + delta, 2), 'adjusted_at', now())
   where key = 'paypal_balance' and value ? 'amount';
$$;
revoke execute on function public.adjust_paypal_balance(numeric) from public, anon, authenticated;

create function public.paypal_balance_from_payment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r payments;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  if r.source = 'manual' and r.method ilike 'paypal%' then
    perform public.adjust_paypal_balance(case when tg_op = 'INSERT' then r.amount else -r.amount end);
  end if;
  return null;
end;
$$;
create trigger paypal_balance_payments after insert or delete on public.payments
  for each row execute function public.paypal_balance_from_payment();

create function public.paypal_balance_from_payout() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r payouts;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  if r.external_id is null then
    perform public.adjust_paypal_balance(case when tg_op = 'INSERT' then -r.amount else r.amount end);
  end if;
  return null;
end;
$$;
create trigger paypal_balance_payouts after insert or delete on public.payouts
  for each row execute function public.paypal_balance_from_payout();
