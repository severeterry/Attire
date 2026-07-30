-- Free tier can now BROWSE the Deal Board/Sourcing (read rfp_posts), but
-- still cannot post (rfp_insert_paid_members, unchanged) or respond
-- (threads/thread_participants insert, newly tier-gated below — this was
-- actually missing an INSERT policy entirely, which means responding
-- silently failed for EVERY tier until now, not just free).

drop policy "rfp_read_paid_members" on public.rfp_posts;
create policy "rfp_read_authenticated"
  on public.rfp_posts for select
  using ((select auth.uid()) is not null);

create policy "threads_insert_paid_members"
  on public.threads for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.tier in ('individual_affiliate', 'organization')
    )
  );

drop policy "thread_participants_insert_self" on public.thread_participants;
create policy "thread_participants_insert_self"
  on public.thread_participants for insert
  with check (
    profile_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.tier in ('individual_affiliate', 'organization')
    )
  );
