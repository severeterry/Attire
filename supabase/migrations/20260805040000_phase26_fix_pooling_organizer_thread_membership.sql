-- Fix: finalize_pooling_thread() only added accepted co-poolers to the
-- resulting group chat's thread_participants, never the organizer. Since
-- chat/message RLS is gated by an exact thread_participants row match
-- (is_thread_participant()), an organizer closing their own pool would be
-- locked out of their own group chat. Now explicitly includes organizer_id.
create or replace function public.finalize_pooling_thread(p_pooling_thread_id uuid)
returns void as $$
declare
  v_new_thread_id uuid;
  v_organizer_id uuid;
  v_participant_count int;
  v_rows int;
begin
  select organizer_id into v_organizer_id
  from public.pooling_threads where id = p_pooling_thread_id;

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
