-- MONEXA settings: one row per user with their preferences (trading defaults, demo
-- presets, notifications, start mode), so they follow the user to every device.
-- Users read their own row; only the gateway (service role) writes, after validating.

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;
drop policy if exists "read own settings" on public.user_settings;
create policy "read own settings" on public.user_settings for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.user_settings from anon, authenticated;
