-- Supports pre-existing prototype features (about-editing, notification
-- toggles, cancellation account credit) against the real backend now that
-- the static site's localStorage profile is being replaced.

alter table public.profiles
  add column if not exists practices text[] not null default '{}',
  add column if not exists settings jsonb not null default '{"notifyMessages": true, "notifyDealBoard": true, "showInDirectory": true, "dmFromAllMembers": true}'::jsonb,
  add column if not exists account_credit numeric not null default 0;
