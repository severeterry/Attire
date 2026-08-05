-- Phase 18: rate limiting for the anonymous-callable surfaces flagged as
-- spammable (membership application submission, directory candidate queue,
-- application status-check RPCs). A small counter table + helper function,
-- bucketed by a key + rolling window; buckets self-reset once the window
-- has elapsed. No external service needed — pure Postgres.

create table if not exists public.rpc_rate_limits (
  bucket_key text primary key,
  window_start timestamptz not null default now(),
  call_count int not null default 0
);

create or replace function public.check_rate_limit(p_bucket text, p_max_calls int, p_window interval)
returns boolean as $$
declare
  v_row public.rpc_rate_limits;
begin
  insert into public.rpc_rate_limits (bucket_key, window_start, call_count)
  values (p_bucket, now(), 1)
  on conflict (bucket_key) do update
    set call_count = case
          when public.rpc_rate_limits.window_start <= now() - p_window then 1
          else public.rpc_rate_limits.call_count + 1
        end,
        window_start = case
          when public.rpc_rate_limits.window_start <= now() - p_window then now()
          else public.rpc_rate_limits.window_start
        end
  returning * into v_row;

  if v_row.call_count > p_max_calls then
    raise exception 'Too many requests, please try again later.';
  end if;
  return true;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.check_rate_limit(text, int, interval) from public, anon, authenticated;

-- 1) Membership application submissions: per-email cap (retries are fine,
-- a script hammering one address is not) plus a sitewide cap (blocks a
-- flood using many distinct fake emails).
drop policy if exists "membership_applications_insert_public" on public.membership_applications;
create policy "membership_applications_insert_public"
  on public.membership_applications for insert
  with check (
    public.check_rate_limit('app:' || lower(coalesce(email, '')), 5, interval '1 day')
    and public.check_rate_limit('app:global', 100, interval '1 hour')
  );

-- 2) Status-check RPCs: the real risk here is email enumeration (scanning
-- many addresses fast), so a sitewide bucket matters more than a per-email
-- one.
create or replace function public.check_application_status(p_email text)
returns table (status text, submitted_at timestamptz) as $$
begin
  perform public.check_rate_limit('status_check:global', 300, interval '1 hour');

  return query
  select a.status, a.created_at
  from public.membership_applications a
  where a.email = p_email
  order by a.created_at desc
  limit 1;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.check_application_status(text) to anon, authenticated;

create or replace function public.get_approved_application(p_email text)
returns table (
  id uuid, org_name text, contact_name text, email text,
  website text, category text, borough text, pitch text, is_founding_cohort boolean
) as $$
begin
  perform public.check_rate_limit('get_approved_application:global', 300, interval '1 hour');

  return query
  select a.id, a.org_name, a.contact_name, a.email, a.website, a.category, a.borough, a.pitch, a.is_founding_cohort
  from public.membership_applications a
  where a.email = p_email
    and a.status = 'approved'
    and a.converted_to_profile_id is null
  order by a.created_at desc
  limit 1;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.get_approved_application(text) to anon, authenticated;

-- 3) Directory candidate queue: sitewide cap generous enough for the
-- monthly discovery agent's normal ~25-candidate run, tight enough to blunt
-- a scripted flood.
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
  perform public.check_rate_limit('queue_candidate:global', 60, interval '1 hour');

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
