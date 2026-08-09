-- A joiner-supplied note on a pooling_participants row, shown to the
-- organizer while the request is pending and to fellow accepted members
-- afterward (existing pooling_participants_read policy already exposes
-- accepted rows broadly to paid members, so no policy change needed for
-- that half — only the new column).
alter table public.pooling_participants add column if not exists note text;

-- Organizer edit of a Co-Op's own core listing fields, while it's still
-- open. Mirrors rfp_posts' existing rfp_update_own policy (a plain
-- owner-update policy, not a narrow RPC) since this is the same
-- low-stakes "edit my own open listing" shape.
create policy pooling_threads_organizer_update_open
  on public.pooling_threads
  for update
  using (organizer_id = (select auth.uid()) and status = 'open')
  with check (organizer_id = (select auth.uid()) and status = 'open');
