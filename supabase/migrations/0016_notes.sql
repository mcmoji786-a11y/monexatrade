-- Kixo notes: a user's own notes on a coin or a wallet (a trader's diary). Private to
-- the user; only the gateway (service role) reads and writes them (notes.rs).

create table if not exists public.user_notes (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('coin', 'wallet')),
  ref text not null check (length(ref) between 32 and 44),
  label text not null default '' check (length(label) <= 40),
  body text not null check (length(body) between 1 and 2000),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
create index if not exists user_notes_recent on public.user_notes (user_id, updated_at desc);

alter table public.user_notes enable row level security;
revoke all on public.user_notes from anon, authenticated;
