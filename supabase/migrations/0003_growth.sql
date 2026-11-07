-- MONEXA growth features: referral codes, demo take-profit / stop-loss orders and the
-- weekly demo competition. As before, browsers can only read their own rows; every
-- write goes through the gateway with the service role.

-- 1. Referrals. Each account gets a short public code; a new account opened from a
--    referral link records who sent it. The code is also the trader's public name on
--    the leaderboard, so no email or wallet is ever shown there.
alter table public.profiles add column if not exists ref_code text unique
  check (ref_code is null or ref_code ~ '^[a-z0-9]{6,12}$');
alter table public.profiles add column if not exists referred_by uuid references auth.users (id) on delete set null;
alter table public.profiles add column if not exists referred_at timestamptz;
create index if not exists profiles_referred_by on public.profiles (referred_by);

-- 2. Take profit and stop loss on demo positions. The gateway watches open orders
--    and sells at the live market when the price crosses the trigger.
alter table public.demo_trades drop constraint if exists demo_trades_source_check;
alter table public.demo_trades add constraint demo_trades_source_check
  check (source in ('manual', 'sniper', 'tp', 'sl'));

create table if not exists public.demo_orders (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  mint text not null,
  symbol text not null default '',
  kind text not null check (kind in ('tp', 'sl')),
  -- Percent move from the average entry price that fires the order (+50, -20).
  trigger_pct numeric not null,
  trigger_price_usd numeric not null check (trigger_price_usd > 0),
  -- Share of the position to sell, 0 to 1.
  fraction numeric not null check (fraction > 0 and fraction <= 1),
  status text not null default 'open' check (status in ('open', 'filled', 'cancelled')),
  note text,
  round int not null default 0,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists demo_orders_open on public.demo_orders (mint) where status = 'open';
create index if not exists demo_orders_user on public.demo_orders (user_id, created_at desc);

alter table public.demo_orders enable row level security;
drop policy if exists "read own demo orders" on public.demo_orders;
create policy "read own demo orders" on public.demo_orders for select to authenticated using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.demo_orders from anon, authenticated;

-- 3. Weekly competition: realised demo profit between two times, summed over every
--    round so resetting never wipes a loss. At least 3 closed trades to be ranked.
create or replace function public.demo_leaderboard(p_from timestamptz, p_to timestamptz, p_limit int default 50)
returns table (user_id uuid, ref_code text, realized_usd numeric, trades bigint, wins bigint, best_usd numeric)
language sql stable security definer set search_path = public as $$
  select t.user_id, p.ref_code, sum(t.realized_usd), count(*), count(*) filter (where t.realized_usd > 0), max(t.realized_usd)
  from public.demo_trades t
  left join public.profiles p on p.id = t.user_id
  where t.side = 'sell' and t.realized_usd is not null and t.ts >= p_from and t.ts < p_to
  group by t.user_id, p.ref_code
  having count(*) >= 3
  order by sum(t.realized_usd) desc
  limit least(greatest(p_limit, 1), 200)
$$;
revoke execute on function public.demo_leaderboard(timestamptz, timestamptz, int) from public, anon, authenticated;
