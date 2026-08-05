-- Phase 25: real, Supabase-backed 1:1 Direct Messages. A plain DM thread is
-- just a threads row with no rfp_post_id (Exchange threads always have one)
-- and no pooling_threads row pointing at it as chat_thread_id (Co-Op group
-- threads). Reuses the same threads/thread_participants/messages tables and
-- RLS policies as Exchange/Co-Op — no schema change needed there, since
-- is_thread_participant() and the participant-scoped read/insert policies
-- are already origin-agnostic.

create or replace function public.start_direct_thread(p_other_profile_id uuid, p_initial_message text)
returns uuid as $$
declare
  v_caller uuid := auth.uid();
  v_existing_thread_id uuid;
  v_thread_id uuid;
begin
  if v_caller = p_other_profile_id then
    raise exception 'Cannot message yourself.';
  end if;
  if not exists (select 1 from public.profiles where id = p_other_profile_id) then
    raise exception 'Member not found.';
  end if;

  select t.id into v_existing_thread_id
  from public.threads t
  where t.rfp_post_id is null
    and t.status = 'active'
    and not exists (select 1 from public.pooling_threads pt where pt.chat_thread_id = t.id)
    and exists (select 1 from public.thread_participants tp1 where tp1.thread_id = t.id and tp1.profile_id = v_caller)
    and exists (select 1 from public.thread_participants tp2 where tp2.thread_id = t.id and tp2.profile_id = p_other_profile_id)
  limit 1;

  if v_existing_thread_id is not null then
    insert into public.messages (thread_id, sender_id, body) values (v_existing_thread_id, v_caller, p_initial_message);
    return v_existing_thread_id;
  end if;

  insert into public.threads (rfp_post_id) values (null) returning id into v_thread_id;
  insert into public.thread_participants (thread_id, profile_id) values (v_thread_id, v_caller);
  insert into public.thread_participants (thread_id, profile_id) values (v_thread_id, p_other_profile_id);
  insert into public.messages (thread_id, sender_id, body) values (v_thread_id, v_caller, p_initial_message);

  return v_thread_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.start_direct_thread(uuid, text) to authenticated;
revoke execute on function public.start_direct_thread(uuid, text) from public, anon;
