-- Phase 11: Co-Op participant management + new pool types + public Exchange
-- response counts.
--
-- Joining a Co-Op moves from instant self-join to request/approve: a member
-- inserting their own participant row always lands as 'pending' regardless
-- of payload (enforced in the trigger, not just the RLS check, so there's
-- no client-side way to insert yourself as already-accepted); the organizer
-- can accept/decline pending requests, add someone directly (skips the
-- pending step), or remove anyone, all via new RLS + trigger rules scoped
-- to "is this my pool". target_group_size/participant_cap/auto-finalize all
-- now count accepted participants only — a pile of pending requests can
-- never itself trigger or block finalization.

alter table public.pooling_threads drop constraint pooling_threads_category_check;
alter table public.pooling_threads add constraint pooling_threads_category_check
  check (category in ('materials', 'service', 'equipment', 'logistics', 'workspace', 'compliance'));

alter table public.pooling_participants add column status text not null default 'pending' check (status in ('pending', 'accepted'));
-- Existing rows predate the request/approve model — they joined instantly
-- under the old rules, so they're already "in".
update public.pooling_participants set status = 'accepted';

-- ---------- RLS ----------

drop policy "pooling_participants_read_paid" on public.pooling_participants;
drop policy "pooling_participants_insert_self" on public.pooling_participants;

-- Accepted rosters stay semi-public to any paid member (unchanged browsing
-- behavior); a pending request is visible only to the requester and the
-- organizer deciding on it — not to the wider membership.
create policy "pooling_participants_read_accepted_public"
  on public.pooling_participants for select
  using (
    status = 'accepted'
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.tier in ('individual_affiliate', 'organization')
    )
  );

create policy "pooling_participants_read_own"
  on public.pooling_participants for select
  using (profile_id = (select auth.uid()));

create policy "pooling_participants_organizer_read_all"
  on public.pooling_participants for select
  using (
    exists (
      select 1 from public.pooling_threads pt
      where pt.id = pooling_participants.pooling_thread_id and pt.organizer_id = (select auth.uid())
    )
  );

-- Self-request or organizer-adds-someone; enforce_pooling_join_rules() below
-- pins the resulting status so neither path can insert as 'accepted' by
-- just sending that value.
create policy "pooling_participants_insert"
  on public.pooling_participants for insert
  with check (
    profile_id = (select auth.uid())
    or exists (
      select 1 from public.pooling_threads pt
      where pt.id = pooling_participants.pooling_thread_id and pt.organizer_id = (select auth.uid())
    )
  );

create policy "pooling_participants_organizer_update"
  on public.pooling_participants for update
  using (
    exists (
      select 1 from public.pooling_threads pt
      where pt.id = pooling_participants.pooling_thread_id and pt.organizer_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.pooling_threads pt
      where pt.id = pooling_participants.pooling_thread_id and pt.organizer_id = (select auth.uid())
    )
  );

create policy "pooling_participants_organizer_delete"
  on public.pooling_participants for delete
  using (
    exists (
      select 1 from public.pooling_threads pt
      where pt.id = pooling_participants.pooling_thread_id and pt.organizer_id = (select auth.uid())
    )
  );

create policy "pooling_participants_self_delete"
  on public.pooling_participants for delete
  using (profile_id = (select auth.uid()));

-- ---------- Triggers ----------

create or replace function public.enforce_pooling_join_rules()
returns trigger as $$
declare
  v_status text;
  v_organizer_id uuid;
  v_cap int;
  v_tier text;
  v_accepted_count int;
begin
  select status, organizer_id, participant_cap into v_status, v_organizer_id, v_cap
  from public.pooling_threads where id = new.pooling_thread_id;

  if v_organizer_id is null then
    raise exception 'Pooling thread not found.';
  end if;

  if v_status <> 'open' then
    raise exception 'This pooling thread is no longer accepting participants.';
  end if;

  select tier into v_tier from public.profiles where id = new.profile_id;
  if v_tier is null or v_tier = 'free' then
    raise exception 'Free tier cannot join pooling threads.';
  end if;

  if new.profile_id = (select auth.uid()) then
    if new.profile_id = v_organizer_id then
      raise exception 'You are already organizing this pooling thread.';
    end if;
    new.status := 'pending';
  elsif v_organizer_id = (select auth.uid()) then
    new.status := 'accepted';
  else
    raise exception 'Not authorized to add this participant.';
  end if;

  if new.status = 'accepted' then
    select count(*) into v_accepted_count
    from public.pooling_participants where pooling_thread_id = new.pooling_thread_id and status = 'accepted';

    if v_cap is not null and v_accepted_count >= v_cap then
      raise exception 'This pooling thread has reached its participant cap.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

create or replace function public.enforce_pooling_participant_update_rules()
returns trigger as $$
declare
  v_organizer_id uuid;
  v_cap int;
  v_accepted_count int;
begin
  select organizer_id, participant_cap into v_organizer_id, v_cap
  from public.pooling_threads where id = new.pooling_thread_id;

  if v_organizer_id <> (select auth.uid()) then
    raise exception 'Only the organizer can update participant status.';
  end if;

  if new.status = 'accepted' and old.status = 'pending' then
    select count(*) into v_accepted_count
    from public.pooling_participants where pooling_thread_id = new.pooling_thread_id and status = 'accepted';

    if v_cap is not null and v_accepted_count >= v_cap then
      raise exception 'This pooling thread has reached its participant cap.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.enforce_pooling_join_rules() from public, anon, authenticated;
revoke execute on function public.enforce_pooling_participant_update_rules() from public, anon, authenticated;

create trigger trg_enforce_pooling_participant_update_rules
  before update on public.pooling_participants
  for each row execute function public.enforce_pooling_participant_update_rules();

-- Auto-finalize now watches accepted-count only, and needs to fire on the
-- UPDATE path too (organizer accepting the request that tips it over
-- target_group_size), not just INSERT.
create or replace function public.check_pooling_threshold()
returns trigger as $$
declare
  v_target int;
  v_accepted_count int;
begin
  if new.status <> 'accepted' then
    return new;
  end if;

  select target_group_size into v_target from public.pooling_threads where id = new.pooling_thread_id;
  select count(*) into v_accepted_count
  from public.pooling_participants where pooling_thread_id = new.pooling_thread_id and status = 'accepted';

  if v_accepted_count >= v_target then
    perform public.finalize_pooling_thread(new.pooling_thread_id);
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_check_pooling_threshold on public.pooling_participants;
create trigger trg_check_pooling_threshold
  after insert or update on public.pooling_participants
  for each row execute function public.check_pooling_threshold();

-- finalize_pooling_thread: only accepted participants count toward the
-- 2-minimum check and get copied into the resulting group chat/notified.
create or replace function public.finalize_pooling_thread(p_pooling_thread_id uuid)
returns void as $$
declare
  v_new_thread_id uuid;
  v_participant_count int;
  v_rows int;
begin
  select count(*) into v_participant_count
  from public.pooling_participants where pooling_thread_id = p_pooling_thread_id and status = 'accepted';

  if v_participant_count < 2 then
    update public.pooling_threads set status = 'cancelled' where id = p_pooling_thread_id and status = 'open';
    return;
  end if;

  update public.pooling_threads set status = 'closed' where id = p_pooling_thread_id and status = 'open';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return;
  end if;

  insert into public.threads (rfp_post_id) values (null) returning id into v_new_thread_id;

  insert into public.thread_participants (thread_id, profile_id)
  select v_new_thread_id, profile_id from public.pooling_participants
  where pooling_thread_id = p_pooling_thread_id and status = 'accepted';

  update public.pooling_threads
  set chat_thread_id = v_new_thread_id
  where id = p_pooling_thread_id;

  insert into public.notifications (profile_id, type, payload)
  select profile_id, 'pool_ready', jsonb_build_object('pooling_thread_id', p_pooling_thread_id, 'thread_id', v_new_thread_id)
  from public.pooling_participants where pooling_thread_id = p_pooling_thread_id and status = 'accepted';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.finalize_pooling_thread(uuid) from public, anon, authenticated;

-- ---------- Public Exchange response counts ----------
-- A listing's response count is visible to everyone; the thread content
-- itself stays gated by threads_participant_read exactly as before — this
-- function only ever returns a count, never thread rows.
create or replace function public.get_rfp_response_counts(p_rfp_post_ids uuid[])
returns table (rfp_post_id uuid, response_count bigint) as $$
begin
  return query
  select t.rfp_post_id, count(*)::bigint
  from public.threads t
  where t.rfp_post_id = any(p_rfp_post_ids)
  group by t.rfp_post_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp stable;

grant execute on function public.get_rfp_response_counts(uuid[]) to authenticated;
revoke execute on function public.get_rfp_response_counts(uuid[]) from public, anon;
