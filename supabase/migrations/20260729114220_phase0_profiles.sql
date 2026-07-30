-- Phase 0: real accounts + tier model.
-- Contact info is split into its own table, kept private by default, so
-- Phase 3 (direct introductions) can reveal it only via an accepted intro
-- without having to retrofit privacy onto a table that started out public.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_name text,
  contact_name text,
  website text,
  category text,
  borough text,
  bio text,
  avatar_url text,
  tier text not null default 'free' check (tier in ('free', 'individual_affiliate', 'organization')),
  tier_changed_at timestamptz not null default now(),
  intro_opt_in boolean not null default false,
  billing jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.profile_contacts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  email text,
  phone text
);

alter table public.profiles enable row level security;
alter table public.profile_contacts enable row level security;

create policy "profiles_public_read"
  on public.profiles for select
  using (true);

create policy "profiles_owner_insert"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_owner_update"
  on public.profiles for update
  using (auth.uid() = id);

create policy "contacts_owner_read"
  on public.profile_contacts for select
  using (auth.uid() = profile_id);

create policy "contacts_owner_insert"
  on public.profile_contacts for insert
  with check (auth.uid() = profile_id);

create policy "contacts_owner_update"
  on public.profile_contacts for update
  using (auth.uid() = profile_id);
