-- Kixo social trading: public trader profiles, follows, a live feed of trades, a
-- leaderboard and per-trader trade lists (for copying a Kixo trader).
--
-- Privacy: nothing is public until a user makes a profile and keeps it public. Only
-- demo trades are shown (real trades stay private). No email or wallet is ever exposed:
-- a trader is only their handle and display name.
--
-- Writes and reads happen in the gateway with the service role (social.rs); browsers
-- cannot touch these tables directly.

create table if not exists public.trader_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handle text not null unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null default '' check (length(display_name) <= 40),
  bio text not null default '' check (length(bio) <= 160),
  public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.follows (
  follower uuid not null references auth.users (id) on delete cascade,
  leader uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, leader),
  check (follower <> leader)
);
create index if not exists follows_leader on public.follows (leader);
create index if not exists demo_trades_id_user on public.demo_trades (user_id, id desc);

alter table public.trader_profiles enable row level security;
alter table public.follows enable row level security;
revoke all on public.trader_profiles, public.follows from anon, authenticated;

-- The feed: public traders' trades, newest first. With p_follower, only the traders that
-- user follows; without, everyone public. Paged by trade id.
create or replace function public.social_feed(p_follower uuid default null, p_limit int default 50, p_before bigint default null)
returns table (id bigint, handle text, display_name text, mint text, symbol text, side text, usd numeric, price_usd numeric, realized_usd numeric, source text, ts timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, p.handle, p.display_name, t.mint, t.symbol, t.side, t.usd, t.price_usd, t.realized_usd, t.source, t.ts
  from public.demo_trades t
  join public.trader_profiles p on p.user_id = t.user_id and p.public
  where (p_follower is null or t.user_id in (select f.leader from public.follows f where f.follower = p_follower))
    and (p_before is null or t.id < p_before)
  order by t.id desc
  limit least(greatest(p_limit, 1), 100)
$$;

-- One public trader's trades after a trade id (the copy engine asks every few seconds).
-- For a sell, `remaining` is what the trader still holds of that coin now, so a copier can
-- sell the same share of its own position.
create or replace function public.trader_trades(p_handle text, p_after bigint default 0, p_limit int default 50)
returns table (id bigint, mint text, symbol text, side text, usd numeric, tokens numeric, price_usd numeric, realized_usd numeric, remaining numeric, source text, ts timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.mint, t.symbol, t.side, t.usd, t.tokens, t.price_usd, t.realized_usd,
         coalesce((select dp.tokens from public.demo_positions dp where dp.user_id = t.user_id and dp.mint = t.mint), 0),
         t.source, t.ts
  from public.demo_trades t
  join public.trader_profiles p on p.user_id = t.user_id and p.public
  where p.handle = lower(p_handle) and t.id > coalesce(p_after, 0)
  order by t.id desc
  limit least(greatest(p_limit, 1), 100)
$$;

-- A trader's results since p_from: realized profit, closed trades, wins, best trade.
create or replace function public.trader_stats(p_user uuid, p_from timestamptz)
returns table (realized_usd numeric, trades bigint, wins bigint, best_usd numeric, volume_usd numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(t.realized_usd) filter (where t.side = 'sell'), 0),
         count(*) filter (where t.side = 'sell' and t.realized_usd is not null),
         count(*) filter (where t.side = 'sell' and t.realized_usd > 0),
         coalesce(max(t.realized_usd) filter (where t.side = 'sell'), 0),
         coalesce(sum(t.usd), 0)
  from public.demo_trades t
  where t.user_id = p_user and t.ts >= p_from
$$;

-- The leaderboard: public traders by realized profit since p_from (3+ closed trades).
create or replace function public.social_leaders(p_from timestamptz, p_limit int default 50)
returns table (handle text, display_name text, realized_usd numeric, trades bigint, wins bigint, best_usd numeric, followers bigint)
language sql stable security definer set search_path = public as $$
  select p.handle, p.display_name, sum(t.realized_usd), count(*), count(*) filter (where t.realized_usd > 0), max(t.realized_usd),
         (select count(*) from public.follows f where f.leader = p.user_id)
  from public.demo_trades t
  join public.trader_profiles p on p.user_id = t.user_id and p.public
  where t.side = 'sell' and t.realized_usd is not null and t.ts >= p_from
  group by p.user_id, p.handle, p.display_name
  having count(*) >= 3
  order by sum(t.realized_usd) desc
  limit least(greatest(p_limit, 1), 100)
$$;

revoke execute on function public.social_feed(uuid, int, bigint) from public, anon, authenticated;
revoke execute on function public.trader_trades(text, bigint, int) from public, anon, authenticated;
revoke execute on function public.trader_stats(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.social_leaders(timestamptz, int) from public, anon, authenticated;
