-- Demo perps were removed from Kixo (founder decision, 2026-11-15). This clears what the
-- earlier perps migration created. Safe to run on a database that never had it.

drop function if exists public.demo_perp_open(uuid, text, text, numeric, numeric, numeric, numeric, numeric, numeric, numeric);
drop function if exists public.demo_perp_close(uuid, bigint, numeric, numeric, numeric, text);
drop table if exists public.demo_perps;
