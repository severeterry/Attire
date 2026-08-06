-- Dropped the "at least one Individual/Affiliate participant" condition --
-- every page's copy states the 14-day inactivity rule as universal, but
-- Organization-only threads (Exchange, Co-Op, or accepted Intro) never
-- nudged or expired, silently contradicting that copy and letting dead
-- conversations accumulate forever in Active Threads sidebars. Now applies
-- uniformly regardless of participant tier.
create or replace function public.process_thread_expirations()
returns void as $$
begin
  insert into public.notifications (profile_id, type, payload)
  select tp.profile_id, 'thread_expiring_soon', jsonb_build_object('thread_id', t.id)
  from public.threads t
  join public.thread_participants tp on tp.thread_id = t.id
  where t.status = 'active'
    and t.expiry_nudged_at is null
    and t.last_message_at <= now() - interval '10 days';

  update public.threads t
  set expiry_nudged_at = now()
  where t.status = 'active'
    and t.expiry_nudged_at is null
    and t.last_message_at <= now() - interval '10 days';

  update public.threads t
  set status = 'expired'
  where t.status = 'active'
    and t.last_message_at <= now() - interval '14 days';
end;
$$ language plpgsql;
