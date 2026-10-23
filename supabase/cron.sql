-- Weekly reminders: every Monday at 08:00 (UTC) the "notify" function e-mails
--   • everyone whose mandatory kitchen-duty availability is incomplete
--   • everyone on kitchen duty that week
-- Replace the two placeholders, then run this once in the Supabase SQL editor.
--   <PROJECT-REF>   your project reference (from the project URL)
--   <CRON_SECRET>   the same value you set as the CRON_SECRET function secret

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'coffee-weekly-reminders',
  '0 8 * * 1',
  $$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body    := '{"type": "weekly"}'::jsonb
  );
  $$
);

-- To change or stop it later:
--   select cron.unschedule('coffee-weekly-reminders');
