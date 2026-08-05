-- pooling_threads has no general UPDATE policy (every mutation goes through
-- a narrow RPC, e.g. close_pooling_thread) — matching that pattern rather
-- than adding a broad policy for one field.
create or replace function public.update_pooling_logistics_notes(p_pooling_thread_id uuid, p_notes text)
returns void as $$
begin
  update public.pooling_threads
  set logistics_notes = p_notes
  where id = p_pooling_thread_id
    and organizer_id = (select auth.uid())
    and status = 'closed';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function public.update_pooling_logistics_notes(uuid, text) to authenticated;
revoke execute on function public.update_pooling_logistics_notes(uuid, text) from public, anon;
