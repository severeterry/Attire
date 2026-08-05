-- Owners had no way to delete their own Exchange post at all (no DELETE
-- policy existed on rfp_posts, so a delete UI couldn't have worked even if
-- one was added). threads.rfp_post_id is ON DELETE SET NULL, so deleting a
-- post preserves any conversation it spawned rather than destroying it.
create policy "rfp_posts_delete_own"
  on public.rfp_posts for delete
  using (author_id = (select auth.uid()));
