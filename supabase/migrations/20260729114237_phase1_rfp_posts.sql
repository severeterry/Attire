-- Phase 1: Deal Board / Sourcing RFP posts. Every post must declare a
-- post_type before it can be inserted — there is no untyped/"regular"
-- post path.

create table if not exists public.rfp_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  post_type text not null check (post_type in ('deal_board_rfp', 'sourcing')),
  category text,
  scope text,
  budget_range text,
  deadline date,
  body text not null,
  status text not null default 'open' check (status in ('open', 'in_conversation', 'fulfilled', 'expired')),
  created_at timestamptz not null default now()
);

alter table public.rfp_posts enable row level security;

create policy "rfp_read_paid_members"
  on public.rfp_posts for select
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.tier in ('individual_affiliate', 'organization')
    )
  );

create policy "rfp_insert_paid_members"
  on public.rfp_posts for insert
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.tier in ('individual_affiliate', 'organization')
    )
  );

create policy "rfp_update_own"
  on public.rfp_posts for update
  using (author_id = auth.uid());

create or replace function public.enforce_rfp_monthly_cap()
returns trigger as $$
declare
  v_tier text;
  v_count int;
begin
  select tier into v_tier from public.profiles where id = new.author_id;

  if v_tier = 'individual_affiliate' then
    select count(*) into v_count
    from public.rfp_posts
    where author_id = new.author_id
      and created_at >= date_trunc('month', now());

    if v_count >= 10 then
      raise exception 'Monthly RFP posting limit reached (10 per month for Individual/Affiliate).';
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger trg_enforce_rfp_cap
  before insert on public.rfp_posts
  for each row execute function public.enforce_rfp_monthly_cap();
