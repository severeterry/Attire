-- Phase 13: real application review workflow. Previously "Apply for
-- Membership" was fully fake — membership.js showed a canned "you're
-- approved" message on a timer and never persisted anything until the very
-- last step (account creation). This closes that honesty gap: applications
-- are now a real row, sitting in 'pending' until the founder (an is_admin
-- profile) approves or rejects it. Nothing about tier/billing/account
-- creation changes — this only gates the step *before* that.

alter table public.profiles add column is_admin boolean not null default false;

create table public.membership_applications (
  id uuid primary key default gen_random_uuid(),
  org_name text not null,
  contact_name text not null,
  email text not null,
  website text,
  category text not null check (category in ('materials', 'circularity', 'strategy', 'advocacy', 'retail')),
  borough text,
  pitch text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  rejection_note text,
  converted_to_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index membership_applications_status_idx on public.membership_applications (status);
create index membership_applications_email_idx on public.membership_applications (email);

alter table public.membership_applications enable row level security;

-- Anyone can apply — this is the public application form, no account exists
-- yet at this point.
create policy "membership_applications_insert_public"
  on public.membership_applications for insert
  with check (true);

-- Only admins can browse/manage the raw table. Applicants check their own
-- status through the narrow RPCs below instead (they have no session yet,
-- so a normal RLS row-read policy can't scope "their" rows to them).
create policy "membership_applications_admin_read"
  on public.membership_applications for select
  using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin)
  );

create policy "membership_applications_admin_update"
  on public.membership_applications for update
  using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin)
  )
  with check (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin)
  );

-- Lets an applicant with no account yet check where their application
-- stands, without exposing the full applications table to anon reads.
create or replace function public.check_application_status(p_email text)
returns table (status text, submitted_at timestamptz) as $$
begin
  return query
  select a.status, a.created_at
  from public.membership_applications a
  where a.email = p_email
  order by a.created_at desc
  limit 1;
end;
$$ language plpgsql security definer set search_path = public, pg_temp stable;

grant execute on function public.check_application_status(text) to anon, authenticated;

-- Once approved, this hands back the saved application fields so the
-- signup flow can resume the plan/billing/credentials steps without
-- asking the applicant to re-type everything. Only returns data for
-- approved, not-yet-converted applications.
create or replace function public.get_approved_application(p_email text)
returns table (
  id uuid, org_name text, contact_name text, email text,
  website text, category text, borough text, pitch text
) as $$
begin
  return query
  select a.id, a.org_name, a.contact_name, a.email, a.website, a.category, a.borough, a.pitch
  from public.membership_applications a
  where a.email = p_email
    and a.status = 'approved'
    and a.converted_to_profile_id is null
  order by a.created_at desc
  limit 1;
end;
$$ language plpgsql security definer set search_path = public, pg_temp stable;

grant execute on function public.get_approved_application(text) to anon, authenticated;

-- Called once, right after a newly-created account finishes signup, so the
-- application row can't be reused to create a second account. Scoped by
-- email match (from the caller's own JWT) rather than a general RLS UPDATE
-- policy, since this is the only write a freshly-signed-up member should
-- ever make to this table.
create or replace function public.mark_application_converted(p_application_id uuid)
returns void as $$
declare
  v_email text;
begin
  v_email := (select auth.jwt() ->> 'email');

  update public.membership_applications
  set converted_to_profile_id = (select auth.uid())
  where id = p_application_id
    and email = v_email
    and status = 'approved'
    and converted_to_profile_id is null;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.mark_application_converted(uuid) to authenticated;
revoke execute on function public.mark_application_converted(uuid) from public, anon;
