-- Phase 8: profiles_owner_update only checked auth.uid() = id, with no
-- restriction on which columns could change. Any authenticated member could
-- call profiles.update({tier: 'organization', account_credit: 99999})
-- directly against the REST API and grant themselves paid-tier access or
-- fake credit, completely bypassing the (already simulated) payment and
-- cancellation flows. tier/billing/account_credit now require a trusted
-- server-side path, guarded by a transaction-local setting only the
-- functions below turn on — the general owner-update policy still covers
-- every other self-edit (bio, org_name, practices, settings, etc.)
-- unchanged.

create or replace function public.protect_profile_sensitive_columns()
returns trigger as $$
begin
  if (new.tier is distinct from old.tier
      or new.billing is distinct from old.billing
      or new.account_credit is distinct from old.account_credit)
     and current_setting('attire.bypass_profile_guard', true) is distinct from 'on' then
    raise exception 'tier, billing, and account_credit can only change through a membership function.';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.protect_profile_sensitive_columns() from public, anon, authenticated;

create trigger trg_protect_profile_sensitive_columns
  before update on public.profiles
  for each row execute function public.protect_profile_sensitive_columns();

-- Self-service tier change (the "Upgrade Plan" flow). Still no real payment
-- processor behind this — that's a separate integration this doesn't
-- attempt — but it validates the target tier and closes the arbitrary
-- billing/account_credit smuggling hole that came with it.
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
  set tier = p_new_tier, billing = p_billing, tier_changed_at = now()
  where id = v_uid;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.change_membership_tier(text, jsonb) to authenticated;
revoke execute on function public.change_membership_tier(text, jsonb) from public, anon;

-- Cancellation: tier -> free, billing cleared, optional prepaid-balance
-- credited to the account. Moved server-side so refund/credit math can't be
-- combined with an arbitrary client-supplied account_credit value.
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
  set tier = 'free', billing = null, account_credit = v_new_credit, tier_changed_at = now()
  where id = v_uid;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.cancel_membership(boolean) to authenticated;
revoke execute on function public.cancel_membership(boolean) from public, anon;
