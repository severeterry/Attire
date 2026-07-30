drop policy "profiles_owner_insert" on public.profiles;
create policy "profiles_owner_insert"
  on public.profiles for insert
  with check ((select auth.uid()) = id);

drop policy "profiles_owner_update" on public.profiles;
create policy "profiles_owner_update"
  on public.profiles for update
  using ((select auth.uid()) = id);

drop policy "contacts_owner_read" on public.profile_contacts;
create policy "contacts_owner_read"
  on public.profile_contacts for select
  using ((select auth.uid()) = profile_id);

drop policy "contacts_owner_insert" on public.profile_contacts;
create policy "contacts_owner_insert"
  on public.profile_contacts for insert
  with check ((select auth.uid()) = profile_id);

drop policy "contacts_owner_update" on public.profile_contacts;
create policy "contacts_owner_update"
  on public.profile_contacts for update
  using ((select auth.uid()) = profile_id);

drop policy "rfp_read_paid_members" on public.rfp_posts;
create policy "rfp_read_paid_members"
  on public.rfp_posts for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.tier in ('individual_affiliate', 'organization')
    )
  );

drop policy "rfp_insert_paid_members" on public.rfp_posts;
create policy "rfp_insert_paid_members"
  on public.rfp_posts for insert
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.tier in ('individual_affiliate', 'organization')
    )
  );

drop policy "rfp_update_own" on public.rfp_posts;
create policy "rfp_update_own"
  on public.rfp_posts for update
  using (author_id = (select auth.uid()));

create index if not exists rfp_posts_author_id_idx on public.rfp_posts (author_id);
