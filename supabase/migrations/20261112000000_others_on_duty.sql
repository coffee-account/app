-- Duty e-mails: {mates} is now called {others_on_duty} (the old name keeps working in saved texts).
-- Run once in the Supabase SQL editor after the earlier migrations.

update public.email_templates
   set body = replace(replace(body, 'You share it with {mates}.', 'On duty with you: {others_on_duty}.'), '{mates}', '{others_on_duty}')
 where key in ('duty_assigned', 'duty_reminder') and body like '%{mates}%';
