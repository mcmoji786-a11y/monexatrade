-- Kixo alerts that reach a user when Kixo is closed: Email, Telegram and Discord.
-- One row per user with where alerts go and what to watch. The gateway (alerts.rs)
-- reads these rows, watches prices and wallet trades, and sends the messages. Browsers
-- cannot touch this table; the gateway uses the service role.

create table if not exists public.user_alerts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The account email, copied when the user turns email alerts on.
  email text check (email is null or length(email) <= 254),
  email_on boolean not null default false,
  -- Set when the user presses Start in Kixo's Telegram bot from their link.
  telegram_chat_id bigint,
  discord_webhook text not null default '' check (length(discord_webhook) <= 300),
  -- Market-cap alerts: [{id, mint, symbol, above, mc_usd}]. Each fires once and is removed.
  price jsonb not null default '[]'::jsonb,
  -- Wallet Monitor: [{address, label, min_buy_sol, sells}].
  wallets jsonb not null default '[]'::jsonb,
  -- Starred coins, for "the dev is selling".
  watch jsonb not null default '[]'::jsonb,
  dev_sells boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.user_alerts enable row level security;
revoke all on public.user_alerts from anon, authenticated;
