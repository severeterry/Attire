-- Phase 2: messaging threads tied to RFP posts, with the 14-day inactivity
-- expiration rule (exempt only while EVERY participant is Organization).
-- Exemption is computed live from current tier at cron time rather than a
-- frozen snapshot, so a downgrade automatically makes a thread subject to
-- the standard rule on the very next scheduled check.

create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  rfp_post_id uuid references public.rfp_posts(id) on delete set null,
  last_message_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'expired')),
  expiry_nudged_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.thread_participants (
  thread_id uuid not null references public.threads(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (thread_id, profile_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists thread_participants_profile_id_idx on public.thread_participants (profile_id);
create index if not exists messages_thread_id_idx on public.messages (thread_id);

alter table public.threads enable row level security;
alter table public.thread_participants enable row level security;
alter table public.messages enable row level security;

create policy "threads_participant_read"
  on public.threads for select
  using (
    exists (
      select 1 from public.thread_participants tp
      where tp.thread_id = threads.id and tp.profile_id = (select auth.uid())
    )
  );

create policy "thread_participants_read"
  on public.thread_participants for select
  using (
    exists (
      select 1 from public.thread_participants tp2
      where tp2.thread_id = thread_participants.thread_id and tp2.profile_id = (select auth.uid())
    )
  );

create policy "thread_participants_insert_self"
  on public.thread_participants for insert
  with check (profile_id = (select auth.uid()));

create policy "messages_participant_read"
  on public.messages for select
  using (
    exists (
      select 1 from public.thread_participants tp
      where tp.thread_id = messages.thread_id and tp.profile_id = (select auth.uid())
    )
  );

create policy "messages_participant_insert"
  on public.messages for insert
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.thread_participants tp
      where tp.thread_id = messages.thread_id and tp.profile_id = (select auth.uid())
    )
    and exists (
      select 1 from public.threads t where t.id = messages.thread_id and t.status = 'active'
    )
  );

create or replace function public.touch_thread_last_message()
returns trigger as $$
begin
  update public.threads set last_message_at = new.created_at where id = new.thread_id;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.touch_thread_last_message() from public, anon, authenticated;

create trigger trg_touch_thread_last_message
  after insert on public.messages
  for each row execute function public.touch_thread_last_message();
