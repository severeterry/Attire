-- Phase 4: Group Buying Power pooling — its own thread type per your
-- clarification, not a label on rfp_posts. Reuses the existing threads/
-- thread_participants/messages tables from Phase 2 as the eventual group
-- chat, rather than building a second messaging system.

create table if not exists public.pooling_threads (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.profiles(id) on delete cascade,
  category text not null check (category in ('materials', 'service')),
  title text not null,
  description text not null,
  -- materials/production template
  moq text,
  unit_cost text,
  production_run_details text,
  -- service/cost-pooling template
  service_type text,
  cost_per_member_estimate text,
  -- shared config
  target_group_size int not null check (target_group_size >= 2),
  participant_cap int,
  closes_at timestamptz,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  chat_thread_id uuid references public.threads(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.pooling_participants (
  pooling_thread_id uuid not null references public.pooling_threads(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (pooling_thread_id, profile_id)
);

create index if not exists pooling_threads_organizer_id_idx on public.pooling_threads (organizer_id);
create index if not exists pooling_participants_profile_id_idx on public.pooling_participants (profile_id);

alter table public.pooling_threads enable row level security;
alter table public.pooling_participants enable row level security;

-- No UPDATE policy on pooling_threads at all: every status/chat_thread_id
-- transition goes through finalize_pooling_thread()/close_pooling_thread()
-- below, which run as SECURITY DEFINER and bypass RLS deliberately —
-- there is no client-writable path to these fields.
create policy "pooling_threads_read_paid"
  on public.pooling_threads for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.tier in ('individual_affiliate', 'organization')
    )
  );

create policy "pooling_threads_insert_paid"
  on public.pooling_threads for insert
  with check (
    organizer_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.tier in ('individual_affiliate', 'organization')
    )
  );

create policy "pooling_participants_read_paid"
  on public.pooling_participants for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.tier in ('individual_affiliate', 'organization')
    )
  );

create policy "pooling_participants_insert_self"
  on public.pooling_participants for insert
  with check (profile_id = (select auth.uid()));

create or replace function public.enforce_pooling_join_rules()
returns trigger as $$
declare
  v_status text;
  v_cap int;
  v_tier text;
  v_current_count int;
begin
  select status, participant_cap into v_status, v_cap
  from public.pooling_threads where id = new.pooling_thread_id;

  if v_status is null then
    raise exception 'Pooling thread not found.';
  end if;

  if v_status <> 'open' then
    raise exception 'This pooling thread is no longer accepting participants.';
  end if;

  select tier into v_tier from public.profiles where id = new.profile_id;
  if v_tier is null or v_tier = 'free' then
    raise exception 'Free tier cannot join pooling threads.';
  end if;

  select count(*) into v_current_count
  from public.pooling_participants where pooling_thread_id = new.pooling_thread_id;

  if v_cap is not null and v_current_count >= v_cap then
    raise exception 'This pooling thread has reached its participant cap.';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.enforce_pooling_join_rules() from public, anon, authenticated;

create trigger trg_enforce_pooling_join_rules
  before insert on public.pooling_participants
  for each row execute function public.enforce_pooling_join_rules();

-- Finalizes a pool: spins up the group chat (reusing threads/thread_participants)
-- with everyone who joined, or cancels it if fewer than 2 people ever joined.
-- Called from three places: auto-trigger at target_group_size, the
-- organizer's manual close, and the daily deadline sweep.
create or replace function public.finalize_pooling_thread(p_pooling_thread_id uuid)
returns void as $$
declare
  v_new_thread_id uuid;
  v_participant_count int;
begin
  select count(*) into v_participant_count
  from public.pooling_participants where pooling_thread_id = p_pooling_thread_id;

  if v_participant_count < 2 then
    update public.pooling_threads set status = 'cancelled' where id = p_pooling_thread_id and status = 'open';
    return;
  end if;

  insert into public.threads (rfp_post_id) values (null) returning id into v_new_thread_id;

  insert into public.thread_participants (thread_id, profile_id)
  select v_new_thread_id, profile_id from public.pooling_participants where pooling_thread_id = p_pooling_thread_id;

  update public.pooling_threads
  set status = 'closed', chat_thread_id = v_new_thread_id
  where id = p_pooling_thread_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.finalize_pooling_thread(uuid) from public, anon, authenticated;

create or replace function public.check_pooling_threshold()
returns trigger as $$
declare
  v_target int;
  v_current_count int;
begin
  select target_group_size into v_target from public.pooling_threads where id = new.pooling_thread_id;
  select count(*) into v_current_count from public.pooling_participants where pooling_thread_id = new.pooling_thread_id;

  if v_current_count >= v_target then
    perform public.finalize_pooling_thread(new.pooling_thread_id);
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.check_pooling_threshold() from public, anon, authenticated;

create trigger trg_check_pooling_threshold
  after insert on public.pooling_participants
  for each row execute function public.check_pooling_threshold();

-- Lets the organizer close early (e.g. lock in at the minimum rather than
-- waiting for the cap). Checks identity itself since finalize_pooling_thread
-- doesn't — that function is also called by the system-driven paths above.
create or replace function public.close_pooling_thread(p_pooling_thread_id uuid)
returns void as $$
declare
  v_organizer_id uuid;
  v_status text;
begin
  select organizer_id, status into v_organizer_id, v_status
  from public.pooling_threads where id = p_pooling_thread_id;

  if v_organizer_id is null then
    raise exception 'Pooling thread not found.';
  end if;

  if v_organizer_id <> auth.uid() then
    raise exception 'Only the organizer can close this pooling thread.';
  end if;

  if v_status <> 'open' then
    raise exception 'This pooling thread is already closed.';
  end if;

  perform public.finalize_pooling_thread(p_pooling_thread_id);
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.close_pooling_thread(uuid) to authenticated;
revoke execute on function public.close_pooling_thread(uuid) from public, anon;
