-- A PayPal QR code next to "How to pay" on My account: the image (a data URL) is the setting "payment_qr",
-- readable by members like "payment_info".
-- Run once in the Supabase SQL editor after the earlier migrations.

create or replace function public.setting_visibility(k text) returns text
language sql immutable as $$
  select case
    when k in ('app_name', 'signup_domains') then 'public'
    when k in ('availability', 'duty', 'balance', 'payment_info', 'payment_qr', 'info') then 'members'
    else 'admin'
  end
$$;
