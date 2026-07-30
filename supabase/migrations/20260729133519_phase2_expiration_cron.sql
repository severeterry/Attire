create extension if not exists pg_cron;

create or replace function public.process_thread_expirations()
returns void as $$
begin
  insert into public.notifications (profile_id, type, payload)
  select tp.profile_id, 'thread_expiring_soon', jsonb_build_object('thread_id', t.id)
  from public.threads t
  join public.thread_participants tp on tp.thread_id = t.id
  where t.status = 'active'
    and t.expiry_nudged_at is null
    and t.last_message_at <= now() - interval '10 days'
    and exists (
      select 1 from public.thread_participants tp2
      join public.profiles p2 on p2.id = tp2.profile_id
      where tp2.thread_id = t.id and p2.tier = 'individual_affiliate'
    );

  update public.threads t
  set expiry_nudged_at = now()
  where t.status = 'active'
    and t.expiry_nudged_at is null
    and t.last_message_at <= now() - interval '10 days'
    and exists (
      select 1 from public.thread_participants tp2
      join public.profiles p2 on p2.id = tp2.profile_id
      where tp2.thread_id = t.id and p2.tier = 'individual_affiliate'
    );

  update public.threads t
  set status = 'expired'
  where t.status = 'active'
    and t.last_message_at <= now() - interval '14 days'
    and exists (
      select 1 from public.thread_participants tp2
      join public.profiles p2 on p2.id = tp2.profile_id
      where tp2.thread_id = t.id and p2.tier = 'individual_affiliate'
    );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.process_thread_expirations() from public, anon, authenticated;

select cron.schedule(
  'process-thread-expirations-daily',
  '0 3 * * *',
  $$select public.process_thread_expirations();$$
);
