-- Phase 7: public lead-capture form. Unlike every other table in this
-- schema, this one accepts writes from anonymous visitors (not just
-- authenticated members) — it's the "not ready to apply yet" entry point
-- for people who aren't going through the full membership application.
-- Write-only from the client: no select policy for anon or authenticated,
-- so submitted leads are only visible via the Supabase dashboard.

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  organization text,
  message text,
  source text not null default 'homepage',
  status text not null default 'new' check (status in ('new', 'contacted', 'converted', 'archived')),
  created_at timestamptz not null default now()
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);

alter table public.leads enable row level security;

create policy "leads_public_insert"
  on public.leads
  for insert
  to anon, authenticated
  with check (
    status = 'new'
    and length(trim(name)) > 0
    and length(trim(email)) > 0
    and email like '%@%.%'
  );
