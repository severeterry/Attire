-- Phase 24: image attachments on real (Exchange/Co-Op-origin) message
-- threads, plus per-participant read tracking so unread state can be shown
-- without a separate table — last_read_at on thread_participants, unread
-- count = messages after it from someone else.

alter table public.messages add column if not exists image_url text;
alter table public.thread_participants add column if not exists last_read_at timestamptz not null default now();

create policy "thread_participants_update_own_read"
  on public.thread_participants for update
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));
