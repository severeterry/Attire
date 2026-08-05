-- The broad UPDATE policy (either party, any column, no WITH CHECK) let a
-- requestor self-accept their own request by calling .update() directly,
-- bypassing accept_intro_request's "only the requestee can accept" check
-- entirely -- the row would show "accepted" everywhere with no thread ever
-- created. It also let either party overwrite the OTHER party's
-- requestor_good_match/requestee_good_match feedback field. Replacing it
-- with narrow RPCs (matching the codebase's established pattern of narrow
-- RPC over broad policy, e.g. pooling_threads has no general UPDATE
-- policy either) closes both holes.

drop policy "intro_requests_involved_update" on public.intro_requests;

create policy "intro_requests_requestor_delete_pending"
  on public.intro_requests for delete
  using (requestor_id = (select auth.uid()) and status = 'pending');

create or replace function public.decline_intro_request(p_intro_id uuid)
returns void as $$
declare
  v_requestee_id uuid;
  v_status text;
begin
  select requestee_id, status into v_requestee_id, v_status
  from public.intro_requests where id = p_intro_id;

  if v_requestee_id is null then
    raise exception 'Introduction request not found.';
  end if;
  if v_requestee_id <> auth.uid() then
    raise exception 'Only the requestee can decline this introduction.';
  end if;
  if v_status <> 'pending' then
    raise exception 'This introduction request has already been resolved.';
  end if;

  update public.intro_requests set status = 'declined', resolved_at = now() where id = p_intro_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.decline_intro_request(uuid) to authenticated;
revoke execute on function public.decline_intro_request(uuid) from public, anon;

create or replace function public.submit_intro_feedback(p_intro_id uuid, p_good_match boolean)
returns void as $$
declare
  v_requestor_id uuid;
  v_requestee_id uuid;
  v_status text;
  v_caller uuid := auth.uid();
begin
  select requestor_id, requestee_id, status into v_requestor_id, v_requestee_id, v_status
  from public.intro_requests where id = p_intro_id;

  if v_requestor_id is null then
    raise exception 'Introduction request not found.';
  end if;
  if v_status <> 'accepted' then
    raise exception 'Feedback is only collected on accepted introductions.';
  end if;

  if v_caller = v_requestor_id then
    update public.intro_requests set requestor_good_match = p_good_match where id = p_intro_id;
  elsif v_caller = v_requestee_id then
    update public.intro_requests set requestee_good_match = p_good_match where id = p_intro_id;
  else
    raise exception 'You are not part of this introduction.';
  end if;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.submit_intro_feedback(uuid, boolean) to authenticated;
revoke execute on function public.submit_intro_feedback(uuid, boolean) from public, anon;

-- Real-time signal that a request/accept happened, instead of the requestee
-- only finding out 3 days later via the reminder cron, and the requestor
-- never finding out an accept happened except by revisiting the page.
create or replace function public.notify_on_new_intro_request()
returns trigger as $$
begin
  insert into public.notifications (profile_id, type, payload)
  values (new.requestee_id, 'intro_request_received', jsonb_build_object('intro_id', new.id));
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_notify_on_new_intro_request on public.intro_requests;
create trigger trg_notify_on_new_intro_request
  after insert on public.intro_requests
  for each row execute function public.notify_on_new_intro_request();

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

  insert into public.notifications (profile_id, type, payload)
  values (v_requestor_id, 'intro_request_accepted', jsonb_build_object('intro_id', p_intro_id, 'thread_id', v_thread_id));

  return v_thread_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
