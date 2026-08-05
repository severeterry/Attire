-- Phase 19: annual directory re-verification. A scheduled agent (mirroring
-- the monthly discovery agent) checks every live directory_listings row
-- once a year and flags anything it can no longer confirm — it never
-- changes verified status or removes a listing itself, only flags it for
-- the founder to review in admin.html, matching the site-wide discipline
-- that automated processes queue, they don't publish/unpublish.

alter table public.directory_listings
  add column if not exists flagged_for_review boolean not null default false,
  add column if not exists flag_reason text,
  add column if not exists flagged_at timestamptz;

create or replace function public.flag_directory_listing_for_review(p_listing_id text, p_reason text)
returns boolean as $$
begin
  perform public.check_rate_limit('flag_listing:global', 200, interval '1 hour');

  update public.directory_listings
  set flagged_for_review = true, flag_reason = p_reason, flagged_at = now()
  where id = p_listing_id and flagged_for_review = false;

  return found;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.flag_directory_listing_for_review(text, text) to anon, authenticated;

-- Admin actions from the Flagged Listings tab: clear a flag (false alarm),
-- or resolve it by unverifying/removing the listing. All admin-gated so
-- there's no need for a separate RPC — the existing
-- directory_listings_admin_write policy already covers plain
-- update/delete calls from an is_admin session.
