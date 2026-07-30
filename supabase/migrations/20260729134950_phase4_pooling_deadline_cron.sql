create or replace function public.process_pooling_deadlines()
returns void as $$
declare
  r record;
begin
  for r in
    select id from public.pooling_threads
    where status = 'open' and closes_at is not null and closes_at <= now()
  loop
    perform public.finalize_pooling_thread(r.id);
  end loop;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.process_pooling_deadlines() from public, anon, authenticated;

select cron.schedule(
  'process-pooling-deadlines-daily',
  '0 3 * * *',
  $$select public.process_pooling_deadlines();$$
);
