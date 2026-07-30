alter function public.enforce_rfp_monthly_cap() set search_path = public, pg_temp;
revoke execute on function public.enforce_rfp_monthly_cap() from anon, authenticated;
