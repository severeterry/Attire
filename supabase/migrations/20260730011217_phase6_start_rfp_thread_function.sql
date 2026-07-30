-- Creating a thread and immediately reading it back (the client's original
-- 3-step insert+select flow) can never work: right after the threads row
-- exists, no thread_participants row exists yet to satisfy the read
-- policy, so the row is invisible to its own creator. Same pattern as
-- pooling: no client-writable insert path for threads/thread_participants
-- at all — everything goes through a security-definer function that does
-- its own tier check and completes the whole operation atomically.

drop policy if exists "threads_insert_paid_members" on public.threads;
drop policy if exists "thread_participants_insert_self" on public.thread_participants;

create or replace function public.start_rfp_thread(p_rfp_post_id uuid, p_initial_message text)
returns uuid as $$
declare
  v_caller uuid := auth.uid();
  v_caller_tier text;
  v_author_id uuid;
  v_thread_id uuid;
begin
  select tier into v_caller_tier from public.profiles where id = v_caller;
  if v_caller_tier is null or v_caller_tier = 'free' then
    raise exception 'Free tier cannot respond to Deal Board posts.';
  end if;

  select author_id into v_author_id from public.rfp_posts where id = p_rfp_post_id;
  if v_author_id is null then
    raise exception 'Post not found.';
  end if;

  insert into public.threads (rfp_post_id) values (p_rfp_post_id) returning id into v_thread_id;

  insert into public.thread_participants (thread_id, profile_id) values (v_thread_id, v_caller);
  if v_author_id <> v_caller then
    insert into public.thread_participants (thread_id, profile_id) values (v_thread_id, v_author_id);
  end if;

  insert into public.messages (thread_id, sender_id, body) values (v_thread_id, v_caller, p_initial_message);

  return v_thread_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.start_rfp_thread(uuid, text) to authenticated;
revoke execute on function public.start_rfp_thread(uuid, text) from public, anon;
