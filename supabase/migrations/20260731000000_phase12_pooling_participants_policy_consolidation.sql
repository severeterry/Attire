-- Phase 12: consolidate pooling_participants' RLS policies. Phase 11 added
-- three separate permissive SELECT policies and two separate permissive
-- DELETE policies (one per access path) — correct, but the Postgres
-- performance advisor flags this: every query pays the cost of evaluating
-- every permissive policy for its role/action, even ones that don't apply.
-- Same access rules, expressed as one OR'd policy per action instead.

drop policy "pooling_participants_read_accepted_public" on public.pooling_participants;
drop policy "pooling_participants_read_own" on public.pooling_participants;
drop policy "pooling_participants_organizer_read_all" on public.pooling_participants;

create policy "pooling_participants_read"
  on public.pooling_participants for select
  using (
    (
      status = 'accepted'
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.tier in ('individual_affiliate', 'organization')
      )
    )
    or profile_id = (select auth.uid())
    or exists (
      select 1 from public.pooling_threads pt
      where pt.id = pooling_participants.pooling_thread_id and pt.organizer_id = (select auth.uid())
    )
  );

drop policy "pooling_participants_organizer_delete" on public.pooling_participants;
drop policy "pooling_participants_self_delete" on public.pooling_participants;

create policy "pooling_participants_delete"
  on public.pooling_participants for delete
  using (
    profile_id = (select auth.uid())
    or exists (
      select 1 from public.pooling_threads pt
      where pt.id = pooling_participants.pooling_thread_id and pt.organizer_id = (select auth.uid())
    )
  );
