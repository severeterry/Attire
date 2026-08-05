-- Accepting an intro request now creates a real message thread, matching
-- how Exchange (start_rfp_thread) and Co-Op (finalize_pooling_thread)
-- already turn an accepted match into a real conversation. chat_thread_id
-- lets the Intros page find "Active Intros" (accepted, thread still active)
-- separately from plain DMs, the same way pooling_threads.chat_thread_id
-- already separates Co-Op group threads from plain DMs.
alter table public.intro_requests add column if not exists chat_thread_id uuid references public.threads(id);

create or replace function public.accept_intro_request(p_intro_id uuid)
returns uuid as $$
declare
  v_requestor_id uuid;
  v_requestee_id uuid;
  v_status text;
  v_thread_id uuid;
begin
  select requestor_id, requestee_id, status into v_requestor_id, v_requestee_id, v_status
  from public.intro_requests where id = p_intro_id;

  if v_requestee_id is null then
    raise exception 'Introduction request not found.';
  end if;
  if v_requestee_id <> auth.uid() then
    raise exception 'Only the requestee can accept this introduction.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This introduction request has already been resolved.';
  end if;

  insert into public.threads (rfp_post_id) values (null) returning id into v_thread_id;
  insert into public.thread_participants (thread_id, profile_id) values (v_thread_id, v_requestor_id), (v_thread_id, v_requestee_id);

  update public.intro_requests
  set status = 'accepted', resolved_at = now(), chat_thread_id = v_thread_id
  where id = p_intro_id;

  return v_thread_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.accept_intro_request(uuid) to authenticated;
revoke execute on function public.accept_intro_request(uuid) from public, anon;
