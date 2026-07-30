create index if not exists messages_sender_id_idx on public.messages (sender_id);
create index if not exists threads_rfp_post_id_idx on public.threads (rfp_post_id);
