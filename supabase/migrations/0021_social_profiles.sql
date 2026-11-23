-- Kixo profiles, Stage 1: a picture, a banner and links on a trader's profile, their
-- profit day by day (chart and calendar), and how many friends they invited (the
-- Founding Member and Founding Trader badges).
--
-- Pictures live in the public storage bucket "profile-media", each user writing only
-- under their own folder (<user id>/...). The gateway accepts a picture URL only when it
-- points into that folder.

alter table public.trader_profiles add column if not exists avatar_url text not null default '' check (length(avatar_url) <= 400);
alter table public.trader_profiles add column if not exists banner_url text not null default '' check (length(banner_url) <= 400);
alter table public.trader_profiles add column if not exists x_handle text not null default '' check (x_handle = '' or x_handle ~ '^[A-Za-z0-9_]{1,15}$');
alter table public.trader_profiles add column if not exists telegram text not null default '' check (telegram = '' or telegram ~ '^[A-Za-z0-9_]{5,32}$');

-- Pictures: public to read, each signed-in user writes only in their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-media', 'profile-media', true, 2097152, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg'];

drop policy if exists "profile media read" on storage.objects;
create policy "profile media read" on storage.objects for select
  using (bucket_id = 'profile-media');
drop policy if exists "profile media write own" on storage.objects;
create policy "profile media write own" on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "profile media update own" on storage.objects;
create policy "profile media update own" on storage.objects for update to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "profile media delete own" on storage.objects;
create policy "profile media delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'profile-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- A trader's realized profit per day (UTC) since p_from: the profile's chart and calendar.
create or replace function public.trader_pnl_daily(p_user uuid, p_from timestamptz)
returns table (day date, realized_usd numeric, trades bigint, wins bigint)
language sql stable security definer set search_path = public as $$
  select (t.ts at time zone 'utc')::date,
         coalesce(sum(t.realized_usd), 0),
         count(*),
         count(*) filter (where t.realized_usd > 0)
  from public.demo_trades t
  where t.user_id = p_user and t.ts >= p_from and t.side = 'sell' and t.realized_usd is not null
  group by 1
  order by 1
$$;
revoke execute on function public.trader_pnl_daily(uuid, timestamptz) from public, anon, authenticated;

-- How many people joined with this user's invite (waitlist or app): the badges.
create or replace function public.invites_of(p_user uuid)
returns bigint
language sql stable security definer set search_path = public as $$
  select count(*) from public.profiles where referred_by = p_user
$$;
revoke execute on function public.invites_of(uuid) from public, anon, authenticated;
