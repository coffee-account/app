-- Low-balance reminders: admins (and group admins, for their group) e-mail people whose balance is below the
-- threshold, from the Balances page. The text is editable under E-mails ("low_balance"); the app remembers
-- when each person was last reminded.
-- Run once in the Supabase SQL editor after the earlier migrations, then redeploy the notify function.

alter table public.people add column if not exists low_balance_reminded_at timestamptz;

insert into public.email_templates (key, subject, body) values
  ('low_balance', $s$Your coffee balance: {balance}$s$, $b$Hi {first_name},

your balance on the coffee and drinks list is **{balance}**, below {threshold}. Please top it up soon.

{payment_info}

[See your balance and history]({app_url})$b$)
on conflict (key) do nothing;
