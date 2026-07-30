create or replace function public.process_intro_requests()
returns void as $$
begin
  insert into public.notifications (profile_id, type, payload)
  select ir.requestee_id, 'intro_request_reminder', jsonb_build_object('intro_request_id', ir.id)
  from public.intro_requests ir
  where ir.status = 'pending'
    and ir.reminder_sent_at is null
    and ir.created_at <= now() - interval '3 days';

  update public.intro_requests ir
  set reminder_sent_at = now()
  where ir.status = 'pending'
    and ir.reminder_sent_at is null
    and ir.created_at <= now() - interval '3 days';

  update public.intro_requests ir
  set status = 'expired', resolved_at = now()
  where ir.status = 'pending'
    and ir.created_at <= now() - interval '14 days';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.process_intro_requests() from public, anon, authenticated;

select cron.schedule(
  'process-intro-requests-daily',
  '0 3 * * *',
  $$select public.process_intro_requests();$$
);
