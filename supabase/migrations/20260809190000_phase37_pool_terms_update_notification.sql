-- Notify every accepted Co-Op participant when the organizer edits the
-- pool's own terms (the edit capability added in phase36). Scoped to a
-- WHEN clause on the actual editable fields so it never fires for
-- close_pooling_thread/finalize_pooling_thread (status + chat_thread_id
-- only) or update_pooling_logistics_notes (logistics_notes only).
create or replace function public.notify_participants_on_pool_terms_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (profile_id, type, payload)
  select pp.profile_id, 'pool_terms_updated', jsonb_build_object('pooling_thread_id', new.id)
  from public.pooling_participants pp
  where pp.pooling_thread_id = new.id and pp.status = 'accepted';
  return new;
end;
$$;

create trigger pooling_threads_notify_terms_update
  after update on public.pooling_threads
  for each row
  when (
    old.title is distinct from new.title or
    old.description is distinct from new.description or
    old.moq is distinct from new.moq or
    old.unit_cost is distinct from new.unit_cost or
    old.production_run_details is distinct from new.production_run_details or
    old.service_type is distinct from new.service_type or
    old.cost_per_member_estimate is distinct from new.cost_per_member_estimate or
    old.target_group_size is distinct from new.target_group_size or
    old.participant_cap is distinct from new.participant_cap or
    old.closes_at is distinct from new.closes_at
  )
  execute function public.notify_participants_on_pool_terms_update();
