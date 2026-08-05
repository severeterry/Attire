-- Bug: this trigger fired on every pooling_participants insert and always
-- notified the organizer, even when the organizer themselves was the one
-- who inserted the row (via the "Add a member" search, which inserts
-- status='accepted' directly) -- they'd get "Someone joined a Co-Op you
-- organized" about their own action, while the member they actually added
-- got no notification that they'd been placed into a paid group Co-Op at
-- all. Now: a genuine join request (status='pending') still notifies the
-- organizer to review it; an organizer-added member (status='accepted',
-- inserted by the organizer) notifies the added member instead.
create or replace function public.notify_pool_organizer_on_join()
returns trigger as $$
declare
  v_organizer_id uuid;
begin
  select organizer_id into v_organizer_id from public.pooling_threads where id = new.pooling_thread_id;
  if v_organizer_id is null or v_organizer_id = new.profile_id then
    return new;
  end if;

  if new.status = 'pending' then
    insert into public.notifications (profile_id, type, payload)
    values (v_organizer_id, 'pool_new_participant', jsonb_build_object('pooling_thread_id', new.pooling_thread_id));
  elsif new.status = 'accepted' and v_organizer_id = auth.uid() then
    insert into public.notifications (profile_id, type, payload)
    values (new.profile_id, 'pool_added_by_organizer', jsonb_build_object('pooling_thread_id', new.pooling_thread_id));
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
