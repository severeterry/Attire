-- Phase 3: direct introduction requests. Quota (3 accepted/mo,
-- Individual/Affiliate only) and the 7-day per-pair cooldown after a
-- decline are both enforced by counting intro_requests live rather than a
-- separate counter column. Organization requestors get neither.

create table if not exists public.intro_requests (
  id uuid primary key default gen_random_uuid(),
  requestor_id uuid not null references public.profiles(id) on delete cascade,
  requestee_id uuid not null references public.profiles(id) on delete cascade,
  note text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  reminder_sent_at timestamptz,
  requestor_good_match boolean,
  requestee_good_match boolean,
  check (requestor_id <> requestee_id)
);

create index if not exists intro_requests_requestor_id_idx on public.intro_requests (requestor_id);
create index if not exists intro_requests_requestee_id_idx on public.intro_requests (requestee_id);

alter table public.intro_requests enable row level security;

create policy "intro_requests_involved_read"
  on public.intro_requests for select
  using (requestor_id = (select auth.uid()) or requestee_id = (select auth.uid()));

create policy "intro_requests_requestor_insert"
  on public.intro_requests for insert
  with check (requestor_id = (select auth.uid()));

create policy "intro_requests_involved_update"
  on public.intro_requests for update
  using (requestor_id = (select auth.uid()) or requestee_id = (select auth.uid()));

create or replace function public.enforce_intro_request_rules()
returns trigger as $$
declare
  v_requestor_tier text;
  v_requestee_tier text;
  v_requestee_opt_in boolean;
  v_accepted_count int;
  v_recent_decline timestamptz;
begin
  select tier into v_requestor_tier from public.profiles where id = new.requestor_id;
  select tier, intro_opt_in into v_requestee_tier, v_requestee_opt_in
    from public.profiles where id = new.requestee_id;

  if v_requestor_tier = 'free' then
    raise exception 'Free tier does not have access to direct introductions.';
  end if;

  if v_requestee_tier is null or v_requestee_tier = 'free' then
    raise exception 'This member is not eligible to receive introduction requests.';
  end if;

  if v_requestee_opt_in is distinct from true then
    raise exception 'This member has not opted in to direct introductions.';
  end if;

  if v_requestor_tier = 'individual_affiliate' then
    select count(*) into v_accepted_count
    from public.intro_requests
    where requestor_id = new.requestor_id
      and status = 'accepted'
      and resolved_at >= date_trunc('month', now());

    if v_accepted_count >= 3 then
      raise exception 'Monthly intro quota reached (3 accepted introductions per month for Individual/Affiliate).';
    end if;

    select max(resolved_at) into v_recent_decline
    from public.intro_requests
    where requestor_id = new.requestor_id
      and requestee_id = new.requestee_id
      and status = 'declined';

    if v_recent_decline is not null and v_recent_decline > now() - interval '7 days' then
      raise exception 'You must wait 7 days after a decline before requesting an intro from this member again.';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

revoke execute on function public.enforce_intro_request_rules() from public, anon, authenticated;

create trigger trg_enforce_intro_request_rules
  before insert on public.intro_requests
  for each row execute function public.enforce_intro_request_rules();

create or replace function public.get_accepted_intro_contact(p_intro_id uuid)
returns table (email text, phone text) as $$
begin
  return query
  select pc.email, pc.phone
  from public.intro_requests ir
  join public.profile_contacts pc on pc.profile_id = ir.requestee_id
  where ir.id = p_intro_id
    and ir.status = 'accepted'
    and ir.requestor_id = auth.uid();
end;
$$ language plpgsql security definer set search_path = public, pg_temp stable;

grant execute on function public.get_accepted_intro_contact(uuid) to authenticated;
revoke execute on function public.get_accepted_intro_contact(uuid) from public, anon;
