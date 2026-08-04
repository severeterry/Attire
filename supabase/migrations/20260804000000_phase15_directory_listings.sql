-- Phase 15: move the public directory off a static data.js array and into
-- Supabase, so directory_candidates approvals (phase 14) can actually
-- auto-publish instead of generating text to paste in by hand. CATEGORIES
-- and BOROUGHS stay as static arrays in data.js — they're fixed taxonomy,
-- not user-generated content.
--
-- Publicly readable (this is the public, unauthenticated directory page);
-- writes are admin-only, matching the founder-review discipline used
-- everywhere else in this schema.

create table public.directory_listings (
  id text primary key,
  name text not null,
  category text not null check (category in ('materials', 'circularity', 'strategy', 'advocacy', 'retail')),
  subcategory text not null,
  borough text not null,
  verified boolean not null default false,
  tag text,
  years_note text,
  description text not null,
  good_to_know text,
  created_at timestamptz not null default now()
);

create index directory_listings_category_idx on public.directory_listings (category);

alter table public.directory_listings enable row level security;

create policy "directory_listings_public_read"
  on public.directory_listings for select
  using (true);

create policy "directory_listings_admin_write"
  on public.directory_listings for all
  using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin)
  )
  with check (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin)
  );
