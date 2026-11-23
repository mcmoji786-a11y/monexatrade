-- Kixo profiles, Stage 2: a trader may hide their dollar amounts. Others then see their
-- results as percentages and wins or losses only; the trader still sees everything.

alter table public.trader_profiles add column if not exists hide_amounts boolean not null default false;
