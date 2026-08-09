-- Two cheap mitigations for the "revealed contact info is now outside
-- Attire's control forever" exposure risk (relevant for any member who's
-- privacy-sensitive, not just high-profile ones): a per-member opt-out
-- from contact reveal entirely, and a notification so the person whose
-- info was revealed knows it happened (lightweight audit trail -- no new
-- table, reuses the existing notifications infra).
alter table public.profiles add column if not exists allow_contact_reveal boolean not null default true;

-- Must be VOLATILE (the default), not STABLE -- this function has a real
-- side effect (the notification insert) now, and STABLE promises the
-- planner it won't modify the database.
create or replace function public.get_accepted_intro_contact(p_intro_id uuid)
returns table(email text, phone text) as $$
declare
  v_requestee_id uuid;
  v_allowed boolean;
begin
  select ir.requestee_id, p.allow_contact_reveal into v_requestee_id, v_allowed
  from public.intro_requests ir
  join public.profiles p on p.id = ir.requestee_id
  where ir.id = p_intro_id
    and ir.status = 'accepted'
    and ir.requestor_id = auth.uid();

  if v_requestee_id is null or v_allowed is distinct from true then
    return;
  end if;

  insert into public.notifications (profile_id, type, payload)
  values (v_requestee_id, 'contact_info_revealed', jsonb_build_object('intro_id', p_intro_id));

  return query
  select pc.email, pc.phone
  from public.profile_contacts pc
  where pc.profile_id = v_requestee_id;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
