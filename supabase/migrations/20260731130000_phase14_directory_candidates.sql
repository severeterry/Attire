-- Phase 14: review queue for automated directory discovery. A future
-- scheduled sweep (web search per category, dedup against existing
-- directory.js entries) inserts candidates here via direct DB access —
-- never straight into the live public directory. Same "queue, don't
-- auto-publish" discipline as membership_applications, for the same
-- reason: an automated pass will produce false positives, and this
-- directory's own stated standard is "don't guess, don't overstate
-- verification."
--
-- No public INSERT policy — candidates are written by the scheduled sweep
-- itself (direct/service-role access), not from the public site.

create table public.directory_candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('materials', 'circularity', 'strategy', 'advocacy', 'retail')),
  subcategory text,
  borough text,
  description text not null,
  good_to_know text,
  source_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewer_note text,
  discovered_at timestamptz not null default now()
);

create index directory_candidates_status_idx on public.directory_candidates (status);

alter table public.directory_candidates enable row level security;

create policy "directory_candidates_admin_read"
  on public.directory_candidates for select
  using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin)
  );

create policy "directory_candidates_admin_update"
  on public.directory_candidates for update
  using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin)
  )
  with check (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin)
  );
