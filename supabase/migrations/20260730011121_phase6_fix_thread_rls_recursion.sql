-- thread_participants_read's policy referenced thread_participants from
-- within its own policy on thread_participants — a self-referencing
-- subquery on the exact table the policy protects, which Postgres can
-- recurse into infinitely once anything (a RETURNING clause, another
-- table's policy) triggers RLS evaluation on it. The fix is a
-- SECURITY DEFINER helper that checks membership without re-entering RLS.

create or replace function public.is_thread_participant(p_thread_id uuid, p_profile_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.thread_participants
    where thread_id = p_thread_id and profile_id = p_profile_id
  );
$$;

revoke execute on function public.is_thread_participant(uuid, uuid) from public, anon;
grant execute on function public.is_thread_participant(uuid, uuid) to authenticated;

drop policy "threads_participant_read" on public.threads;
create policy "threads_participant_read"
  on public.threads for select
  using (public.is_thread_participant(threads.id, (select auth.uid())));

drop policy "thread_participants_read" on public.thread_participants;
create policy "thread_participants_read"
  on public.thread_participants for select
  using (public.is_thread_participant(thread_participants.thread_id, (select auth.uid())));

drop policy "messages_participant_read" on public.messages;
create policy "messages_participant_read"
  on public.messages for select
  using (public.is_thread_participant(messages.thread_id, (select auth.uid())));

drop policy "messages_participant_insert" on public.messages;
create policy "messages_participant_insert"
  on public.messages for insert
  with check (
    sender_id = (select auth.uid())
    and public.is_thread_participant(messages.thread_id, (select auth.uid()))
    and exists (select 1 from public.threads t where t.id = messages.thread_id and t.status = 'active')
  );
