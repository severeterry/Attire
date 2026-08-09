-- Likeable comments on Feed posts, mirroring post_likes exactly.
create table public.comment_likes (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, profile_id)
);

alter table public.comment_likes enable row level security;

create policy comment_likes_authenticated_read
  on public.comment_likes for select
  to authenticated
  using (true);

create policy comment_likes_owner_insert
  on public.comment_likes for insert
  to authenticated
  with check (profile_id = (select auth.uid()));

create policy comment_likes_owner_delete
  on public.comment_likes for delete
  to authenticated
  using (profile_id = (select auth.uid()));
