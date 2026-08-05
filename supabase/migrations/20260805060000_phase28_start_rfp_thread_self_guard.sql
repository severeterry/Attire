-- Defense-in-depth: the client-side UI already hides the Respond button on
-- your own post, but the RPC itself silently allowed a self-response
-- (skipping the second participant insert) rather than rejecting it,
-- creating a degenerate one-person thread. Matches the guard already
-- present in accept_intro_request/start_direct_thread.
create or replace function public.start_rfp_thread(p_rfp_post_id uuid, p_initial_message text, p_quote_price text default null, p_quote_moq text default null, p_quote_lead_time text default null)
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
  if v_author_id = v_caller then
    raise exception 'You cannot respond to your own post.';
  end if;

  insert into public.threads (rfp_post_id, quote_price, quote_moq, quote_lead_time)
  values (p_rfp_post_id, p_quote_price, p_quote_moq, p_quote_lead_time)
  returning id into v_thread_id;

  insert into public.thread_participants (thread_id, profile_id) values (v_thread_id, v_caller), (v_thread_id, v_author_id);

  insert into public.messages (thread_id, sender_id, body) values (v_thread_id, v_caller, p_initial_message);

  return v_thread_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
