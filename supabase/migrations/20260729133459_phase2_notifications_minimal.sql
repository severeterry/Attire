create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_profile_id_idx on public.notifications (profile_id);

alter table public.notifications enable row level security;

create policy "notifications_owner_read"
  on public.notifications for select
  using ((select auth.uid()) = profile_id);

create policy "notifications_owner_update"
  on public.notifications for update
  using ((select auth.uid()) = profile_id);
