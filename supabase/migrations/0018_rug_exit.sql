-- Rug exit (gateway rug_exit.rs): a demo position sold by itself when the coin's dev sells
-- or Kixo AI calls it Danger. Until this runs, those sells are recorded as stop losses.
alter table public.demo_trades drop constraint if exists demo_trades_source_check;
alter table public.demo_trades add constraint demo_trades_source_check
  check (source in ('manual', 'sniper', 'tp', 'sl', 'limit_buy', 'limit_sell', 'trail', 'quick', 'grid', 'copy', 'rug_exit'));
