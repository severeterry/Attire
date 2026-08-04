-- Phase 16: public-callable RPC so the scheduled discovery agent can queue
-- new directory candidates without needing direct table access. Mirrors the
-- membership_applications public-insert pattern: anyone (including the
-- unauthenticated agent) can add to a pending-review queue, but only an
-- admin can ever publish from it (see admin.js publishCandidate). Dedup is
-- done server-side against both directory_listings and directory_candidates
-- so the agent doesn't need read access to either table.

create or replace function public.queue_directory_candidate(
  p_name text,
  p_category text,
  p_subcategory text,
  p_borough text,
  p_description text,
  p_good_to_know text,
  p_source_url text
) returns boolean as $$
declare
  v_exists boolean;
begin
  if p_category not in ('materials', 'circularity', 'strategy', 'advocacy', 'retail') then
    raise exception 'Invalid category.';
  end if;
  if coalesce(trim(p_name), '') = '' or coalesce(trim(p_description), '') = '' then
    raise exception 'Name and description are required.';
  end if;

  select exists(
    select 1 from public.directory_listings where lower(name) = lower(trim(p_name))
    union
    select 1 from public.directory_candidates where lower(name) = lower(trim(p_name))
  ) into v_exists;

  if v_exists then
    return false;
  end if;

  insert into public.directory_candidates
    (name, category, subcategory, borough, description, good_to_know, source_url, status, discovered_at)
  values
    (trim(p_name), p_category, coalesce(p_subcategory, 'Uncategorized'), coalesce(p_borough, 'NYC Presence'),
     p_description, p_good_to_know, p_source_url, 'pending', now());

  return true;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.queue_directory_candidate(text, text, text, text, text, text, text) to anon, authenticated;
