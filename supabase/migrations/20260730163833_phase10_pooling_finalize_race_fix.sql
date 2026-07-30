-- finalize_pooling_thread() went straight from "count the participants" to
-- creating a group chat thread, with no atomic claim on the transition.
-- Multiple participant rows landing in one statement (bulk seeding surfaced
-- this, but genuinely concurrent joins on the same pool could too) can each
-- independently observe count >= target and each call this function,
-- creating duplicate group-chat threads and repeatedly clobbering
-- chat_thread_id — the losing threads end up orphaned with real
-- participants copied into them but never linked from anywhere. The fix:
-- flip status away from 'open' with an atomic UPDATE ... WHERE status =
-- 'open' first: only the caller that actually performs the transition
-- proceeds to create the thread; every other concurrent caller sees 0 rows
-- affected and returns immediately.

create or replace function public.finalize_pooling_thread(p_pooling_thread_id uuid)
returns void as $$
declare
  v_new_thread_id uuid;
  v_participant_count int;
  v_rows int;
begin
  select count(*) into v_participant_count
  from public.pooling_participants where pooling_thread_id = p_pooling_thread_id;

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
  select v_new_thread_id, profile_id from public.pooling_participants where pooling_thread_id = p_pooling_thread_id;

  update public.pooling_threads
  set chat_thread_id = v_new_thread_id
  where id = p_pooling_thread_id;

  insert into public.notifications (profile_id, type, payload)
  select profile_id, 'pool_ready', jsonb_build_object('pooling_thread_id', p_pooling_thread_id, 'thread_id', v_new_thread_id)
  from public.pooling_participants where pooling_thread_id = p_pooling_thread_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
