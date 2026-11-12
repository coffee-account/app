-- The kitchen-duty settings moved from Settings to the Kitchen duty page: duty managers may now change
-- the "availability" setting (weeks ahead, minimum weeks, who must answer) as well as "duty".
-- Run once in the Supabase SQL editor after the earlier migrations.

drop policy if exists settings_duty_insert on public.settings;
drop policy if exists settings_duty_update on public.settings;
create policy settings_duty_insert on public.settings for insert to authenticated
  with check (key in ('duty', 'availability') and public.can_manage_duties());
create policy settings_duty_update on public.settings for update to authenticated
  using (key in ('duty', 'availability') and public.can_manage_duties())
  with check (key in ('duty', 'availability') and public.can_manage_duties());
