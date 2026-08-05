-- Same gap as rfp_posts had before phase29: organizers had no way to
-- delete their own stale/cancelled Co-Op (no DELETE policy existed at
-- all). pooling_threads.chat_thread_id has no FK constraint pointing back
-- from threads, so deleting a pool never touches an already-started group
-- chat.
create policy "pooling_threads_delete_own"
  on public.pooling_threads for delete
  using (organizer_id = (select auth.uid()));
