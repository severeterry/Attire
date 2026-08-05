-- Phase 23: real-world fabric-sourcing and group-buy components that were
-- missing from Exchange/Co-Op — MOQ and material spec on sourcing asks,
-- structured quote fields on a response (instead of only free text),
-- and logistics notes for a closed Co-Op.

alter table public.rfp_posts
  add column if not exists moq text,
  add column if not exists material_spec text,
  add column if not exists certifications text;

alter table public.threads
  add column if not exists quote_price text,
  add column if not exists quote_moq text,
  add column if not exists quote_lead_time text;

alter table public.pooling_threads
  add column if not exists logistics_notes text;

-- start_rfp_thread gains three optional quote fields, stored on the thread
-- itself (not the message) so they render as structured info at the top of
-- the conversation rather than buried in message text.
create or replace function public.start_rfp_thread(
  p_rfp_post_id uuid,
  p_initial_message text,
  p_quote_price text default null,
  p_quote_moq text default null,
  p_quote_lead_time text default null
)
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

  insert into public.threads (rfp_post_id, quote_price, quote_moq, quote_lead_time)
  values (p_rfp_post_id, p_quote_price, p_quote_moq, p_quote_lead_time)
  returning id into v_thread_id;

  insert into public.thread_participants (thread_id, profile_id) values (v_thread_id, v_caller);
  if v_author_id <> v_caller then
    insert into public.thread_participants (thread_id, profile_id) values (v_thread_id, v_author_id);
  end if;

  insert into public.messages (thread_id, sender_id, body) values (v_thread_id, v_caller, p_initial_message);

  return v_thread_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.start_rfp_thread(uuid, text, text, text, text) to authenticated;
revoke execute on function public.start_rfp_thread(uuid, text, text, text, text) from public, anon;
