-- The composer field is labeled "Minimum to close" (target_group_size),
-- but finalize_pooling_thread only ever checked a hardcoded floor of 2 --
-- any pool (manual close, deadline cron, or early-threshold trigger) could
-- finalize into a real group chat with far fewer accepted participants
-- than the organizer actually required, silently breaking the MOQ/cost-
-- split premise the pool was created for.
create or replace function public.finalize_pooling_thread(p_pooling_thread_id uuid)
returns void as $$
declare
  v_new_thread_id uuid;
  v_organizer_id uuid;
  v_target int;
  v_participant_count int;
  v_rows int;
begin
  select organizer_id, target_group_size into v_organizer_id, v_target
  from public.pooling_threads where id = p_pooling_thread_id;

  select count(*) into v_participant_count
  from public.pooling_participants where pooling_thread_id = p_pooling_thread_id and status = 'accepted';

  if v_participant_count < v_target then
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

  insert into public.thread_participants (thread_id, profile_id)
  values (v_new_thread_id, v_organizer_id);

  update public.pooling_threads
  set chat_thread_id = v_new_thread_id
  where id = p_pooling_thread_id;

  insert into public.notifications (profile_id, type, payload)
  select profile_id, 'pool_ready', jsonb_build_object('pooling_thread_id', p_pooling_thread_id, 'thread_id', v_new_thread_id)
  from public.pooling_participants where pooling_thread_id = p_pooling_thread_id and status = 'accepted';

  insert into public.notifications (profile_id, type, payload)
  values (v_organizer_id, 'pool_ready', jsonb_build_object('pooling_thread_id', p_pooling_thread_id, 'thread_id', v_new_thread_id));
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
