-- Phase 9: the general member Feed — a minimal posts/comments/likes system.
-- Open to every authenticated member regardless of tier (not a paid perk
-- like The Exchange or The Co-Op — no membership copy anywhere gates this).

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, profile_id)
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists post_comments_post_id_idx on public.post_comments (post_id);
create index if not exists post_likes_post_id_idx on public.post_likes (post_id);

alter table public.posts enable row level security;
alter table public.post_comments enable row level security;
alter table public.post_likes enable row level security;

create policy "posts_authenticated_read"
  on public.posts for select
  to authenticated
  using (true);

create policy "posts_owner_insert"
  on public.posts for insert
  to authenticated
  with check (author_id = (select auth.uid()));

create policy "posts_owner_delete"
  on public.posts for delete
  to authenticated
  using (author_id = (select auth.uid()));

create policy "post_comments_authenticated_read"
  on public.post_comments for select
  to authenticated
  using (true);

create policy "post_comments_owner_insert"
  on public.post_comments for insert
  to authenticated
  with check (author_id = (select auth.uid()));

create policy "post_comments_owner_delete"
  on public.post_comments for delete
  to authenticated
  using (author_id = (select auth.uid()));

create policy "post_likes_authenticated_read"
  on public.post_likes for select
  to authenticated
  using (true);

create policy "post_likes_owner_insert"
  on public.post_likes for insert
  to authenticated
  with check (profile_id = (select auth.uid()));

create policy "post_likes_owner_delete"
  on public.post_likes for delete
  to authenticated
  using (profile_id = (select auth.uid()));
