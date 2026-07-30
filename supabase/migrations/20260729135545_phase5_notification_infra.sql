-- Phase 5: fills in the remaining notification triggers (new RFP category
-- match, RFP cap warning, pool join/closing-soon) and a minimal per-account
-- preference — a single email-digest toggle, per your spec's "otherwise a
-- single on/off toggle is sufficient for this phase.

alter table public.pooling_threads add column if not exists deadline_nudged_at timestamptz;

create table if not exists public.notification_preferences (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  email_digest_enabled boolean not null default true
);

alter table public.notification_preferences enable row level security;

create policy "notification_preferences_owner_read"
  on public.notification_preferences for select
  using ((select auth.uid()) = profile_id);

create policy "notification_preferences_owner_update"
  on public.notification_preferences for update
  using ((select auth.uid()) = profile_id);

-- Every new profile gets a default (digest-on) preferences row automatically.
create or replace function public.create_default_notification_preferences()
returns trigger as $$
begin
  insert into public.notification_preferences (profile_id) values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.create_default_notification_preferences() from public, anon, authenticated;

create trigger trg_create_default_notification_preferences
  after insert on public.profiles
  for each row execute function public.create_default_notification_preferences();

-- New RFP matching a paid member's category, plus the "2 posts remaining"
-- soft warning for Individual/Affiliate (fires exactly once, the instant
-- their monthly count reaches 8 of 10).
create or replace function public.notify_on_new_rfp_post()
returns trigger as $$
declare
  v_author_tier text;
  v_count_this_month int;
begin
  if new.category is not null then
    insert into public.notifications (profile_id, type, payload)
    select p.id, 'new_rfp_match', jsonb_build_object('rfp_post_id', new.id, 'category', new.category)
    from public.profiles p
    where p.category = new.category
      and p.id <> new.author_id
      and p.tier in ('individual_affiliate', 'organization');
  end if;

  select tier into v_author_tier from public.profiles where id = new.author_id;
  if v_author_tier = 'individual_affiliate' then
    select count(*) into v_count_this_month
    from public.rfp_posts
    where author_id = new.author_id
      and created_at >= date_trunc('month', now());

    if v_count_this_month = 8 then
      insert into public.notifications (profile_id, type, payload)
      values (new.author_id, 'rfp_cap_warning', jsonb_build_object('posts_remaining', 2));
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.notify_on_new_rfp_post() from public, anon, authenticated;

create trigger trg_notify_on_new_rfp_post
  after insert on public.rfp_posts
  for each row execute function public.notify_on_new_rfp_post();

-- Notify the pool organizer whenever someone new joins.
create or replace function public.notify_pool_organizer_on_join()
returns trigger as $$
declare
  v_organizer_id uuid;
begin
  select organizer_id into v_organizer_id from public.pooling_threads where id = new.pooling_thread_id;
  if v_organizer_id is not null and v_organizer_id <> new.profile_id then
    insert into public.notifications (profile_id, type, payload)
    values (v_organizer_id, 'pool_new_participant', jsonb_build_object('pooling_thread_id', new.pooling_thread_id));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.notify_pool_organizer_on_join() from public, anon, authenticated;

create trigger trg_notify_pool_organizer_on_join
  after insert on public.pooling_participants
  for each row execute function public.notify_pool_organizer_on_join();

-- Extends finalize_pooling_thread to notify every finalized participant
-- once the group chat is actually ready.
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

  insert into public.notifications (profile_id, type, payload)
  select profile_id, 'pool_ready', jsonb_build_object('pooling_thread_id', p_pooling_thread_id, 'thread_id', v_new_thread_id)
  from public.pooling_participants where pooling_thread_id = p_pooling_thread_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.finalize_pooling_thread(uuid) from public, anon, authenticated;

-- Extends the daily pooling sweep with a "closing soon" nudge ~2 days
-- before a deadline, guarded by deadline_nudged_at so it only fires once.
create or replace function public.process_pooling_deadlines()
returns void as $$
declare
  r record;
begin
  insert into public.notifications (profile_id, type, payload)
  select pp.profile_id, 'pool_closing_soon', jsonb_build_object('pooling_thread_id', pt.id)
  from public.pooling_threads pt
  join public.pooling_participants pp on pp.pooling_thread_id = pt.id
  where pt.status = 'open'
    and pt.closes_at is not null
    and pt.deadline_nudged_at is null
    and pt.closes_at <= now() + interval '2 days';

  update public.pooling_threads
  set deadline_nudged_at = now()
  where status = 'open'
    and closes_at is not null
    and deadline_nudged_at is null
    and closes_at <= now() + interval '2 days';

  for r in
    select id from public.pooling_threads
    where status = 'open' and closes_at is not null and closes_at <= now()
  loop
    perform public.finalize_pooling_thread(r.id);
  end loop;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.process_pooling_deadlines() from public, anon, authenticated;
