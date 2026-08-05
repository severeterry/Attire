-- rpc_rate_limits must only ever be touched by check_rate_limit() (a
-- SECURITY DEFINER function, which bypasses RLS). Enable RLS with no
-- policies at all, so anon/authenticated get zero direct access via the
-- REST API — otherwise anyone could DELETE/UPDATE this table directly and
-- reset their own rate limit, defeating the whole mechanism.
alter table public.rpc_rate_limits enable row level security;
