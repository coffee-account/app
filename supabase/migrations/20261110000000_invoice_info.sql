-- Info page part for people who can upload invoices, and only admins start count sessions.
-- Run once in the Supabase SQL editor after the earlier migrations.

create policy settings_read_invoice_info on public.settings for select to authenticated
  using (key = 'info_invoices' and public.can_upload_invoices());

-- Group admins now fill in a count an admin has opened instead of starting their own.
drop policy sessions_group_insert on public.count_sessions;
