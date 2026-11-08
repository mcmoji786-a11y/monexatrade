# 0013: Share cards, milestones, achievements, legal pages and monitoring

Date: 2026-11-09. Decided by the founder ("inko pehly achy sa kardo"); built the same day.

## Built

- One share-card system (`components/share`): closed trade, coin ("Spotted on Kixo",
  with the rise since launch only when Kixo watched the coin from its first trade),
  2x/5x/10x milestone of an open demo position, and the weekly recap. Every result on
  virtual money says "Demo account"; coin cards show live on-chain facts only.
- Milestone alerts, achievements (16) with day and win streaks, and the weekly recap on
  the Portfolio page, computed from the demo history (`lib/achievements.ts`). What was
  announced is kept per user in the browser, so nothing repeats.
- Demo trades record who placed them: Quick Buy, grid and copy trading (migration 0009).
- Admin switches: `coin_share`, `milestone_alerts`, `achievements`, `weekly_recap`.
- Terms of Use and Privacy Policy pages in plain words, describing how Kixo works today.
  The sign-in terms note was corrected (the Kixo wallet does move funds when you trade)
  and `TERMS_VERSION` is 2, so every user accepts the new text once.
- Monitoring (`monitor.rs`, admin System health): every gateway warning and error
  grouped with counts, browsers' uncaught errors (page path only), and a check of the
  database, Solana RPC and live stream every minute with 24 h of uptime and incidents.
- Mobile: the app shell, Sol Radar and the trade page no longer scroll sideways at 390 px.

## Still the founder's

- A lawyer should read the Terms and Privacy Policy before launch, and the company name,
  country and a contact address should be added once they exist.
- Monitoring lives in the gateway's memory: point an outside uptime check at `/health`.
