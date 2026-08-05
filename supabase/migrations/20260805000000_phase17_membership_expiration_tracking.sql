-- Phase 17: trial/founding-cohort expiration tracking. Every approved
-- applicant gets free_until set at signup (6 months normally, 2 years if
-- the founder flagged their application as founding-cohort — a rolling
-- designation, no fixed cutoff date or headcount). A daily cron downgrades
-- anyone whose free window has passed back to the free tier. free_until is
-- cleared whenever someone explicitly upgrades through a trusted path
-- (change_membership_tier, cancel_membership) since at that point a real
-- subscription (eventually Stripe) governs their billing, not this clock.

alter table public.profiles
  add column if not exists free_until timestamptz,
  add column if not exists is_founding_cohort boolean not null default false;

alter table public.membership_applications
  add column if not exists is_founding_cohort boolean not null default false;

-- Extend the existing sensitive-column guard (phase8) to also cover the two
-- new columns, same trust model as tier/billing/account_credit: only a
-- membership function running with the bypass flag set may change them.
create or replace function public.protect_profile_sensitive_columns()
returns trigger as $$
begin
  if (new.tier is distinct from old.tier
      or new.billing is distinct from old.billing
      or new.account_credit is distinct from old.account_credit
      or new.free_until is distinct from old.free_until
      or new.is_founding_cohort is distinct from old.is_founding_cohort)
     and current_setting('attire.bypass_profile_guard', true) is distinct from 'on' then
    raise exception 'tier, billing, account_credit, free_until, and is_founding_cohort can only change through a membership function.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- get_approved_application needs to hand back is_founding_cohort so the
-- signup flow knows which free-period length to set. Return shape changes,
-- so drop + recreate rather than create-or-replace.
drop function if exists public.get_approved_application(text);

create or replace function public.get_approved_application(p_email text)
returns table (
  id uuid, org_name text, contact_name text, email text,
  website text, category text, borough text, pitch text, is_founding_cohort boolean
) as $$
begin
  return query
  select a.id, a.org_name, a.contact_name, a.email, a.website, a.category, a.borough, a.pitch, a.is_founding_cohort
  from public.membership_applications a
  where a.email = p_email
    and a.status = 'approved'
    and a.converted_to_profile_id is null
  order by a.created_at desc
  limit 1;
end;
$$ language plpgsql security definer set search_path = public, pg_temp stable;

grant execute on function public.get_approved_application(text) to anon, authenticated;

-- Self-service upgrade (profile.js "Upgrade Plan") now also clears
-- free_until — a real (eventually Stripe-backed) subscription replaces the
-- trial clock, so the expiration cron should never touch this profile again.
create or replace function public.change_membership_tier(p_new_tier text, p_billing jsonb)
returns void as $$
declare
  v_uid uuid := auth.uid();
begin
  if p_new_tier not in ('individual_affiliate', 'organization') then
    raise exception 'Invalid tier.';
  end if;

  perform set_config('attire.bypass_profile_guard', 'on', true);
  update public.profiles
  set tier = p_new_tier, billing = p_billing, tier_changed_at = now(), free_until = null
  where id = v_uid;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- Cancellation also clears free_until for cleanliness (redundant with the
-- tier already going to 'free', but avoids a stale timestamp lingering).
create or replace function public.cancel_membership(p_credit_mode boolean)
returns void as $$
declare
  v_uid uuid := auth.uid();
  v_billing jsonb;
  v_current_credit numeric;
  v_new_credit numeric;
begin
  select billing, coalesce(account_credit, 0) into v_billing, v_current_credit
  from public.profiles where id = v_uid;

  if v_billing is null then
    raise exception 'No active subscription to cancel.';
  end if;

  v_new_credit := v_current_credit;
  if p_credit_mode and (v_billing->>'termMonths')::int > 1 then
    v_new_credit := v_current_credit + coalesce((v_billing->>'totalDue')::numeric, 0);
  end if;

  perform set_config('attire.bypass_profile_guard', 'on', true);
  update public.profiles
  set tier = 'free', billing = null, account_credit = v_new_credit, tier_changed_at = now(), free_until = null
  where id = v_uid;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

-- Daily downgrade job, same cron pattern as the existing expiration jobs
-- (pg_cron already enabled in phase2).
create or replace function public.process_membership_expirations()
returns void as $$
begin
  perform set_config('attire.bypass_profile_guard', 'on', true);
  update public.profiles
  set tier = 'free', billing = null, free_until = null, tier_changed_at = now()
  where tier <> 'free'
    and free_until is not null
    and free_until <= now();
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.process_membership_expirations() from public, anon, authenticated;

select cron.schedule(
  'process-membership-expirations-daily',
  '0 3 * * *',
  $$select public.process_membership_expirations();$$
);
