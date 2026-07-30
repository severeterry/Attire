-- Weekly digest of new RFPs matching a member's category, respecting the
-- email_digest_enabled preference. This creates the in-portal notification
-- row (the "portal notification" half of your spec's "email/portal
-- notification" digest) — actually emailing it out requires wiring in an
-- external provider (Resend/Postmark, etc.) with real credentials, which
-- isn't something I can set up without you supplying that account.
create or replace function public.generate_weekly_rfp_digests()
returns void as $$
begin
  insert into public.notifications (profile_id, type, payload)
  select p.id, 'weekly_digest', jsonb_build_object(
    'rfp_post_ids', (
      select coalesce(jsonb_agg(rp.id), '[]'::jsonb)
      from public.rfp_posts rp
      where rp.category = p.category
        and rp.author_id <> p.id
        and rp.created_at >= now() - interval '7 days'
    )
  )
  from public.profiles p
  join public.notification_preferences np on np.profile_id = p.id
  where p.tier in ('individual_affiliate', 'organization')
    and p.category is not null
    and np.email_digest_enabled = true
    and exists (
      select 1 from public.rfp_posts rp
      where rp.category = p.category
        and rp.author_id <> p.id
        and rp.created_at >= now() - interval '7 days'
    );
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.generate_weekly_rfp_digests() from public, anon, authenticated;

select cron.schedule(
  'weekly-rfp-digest',
  '0 13 * * 0',
  $$select public.generate_weekly_rfp_digests();$$
);
