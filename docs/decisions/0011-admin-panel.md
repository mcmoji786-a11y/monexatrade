# 0011: Admin panel for settings, users, earnings and marketing

Date: 2026-11-08. Requested by the founder: "small features in the admin that help marketing, and
small tasks, so the code never has to be opened for API changes". The founder chose to build all
three parts.

## Access

- The admin page `/admin-preview` now works in production. Nothing shows without the admin key
  (`ADMIN_TOKEN`), and every admin route on the gateway checks it.
- Changes that move money or keys also need an **owner session**:
  - The owner session comes from a 6-digit code emailed to `OWNER_EMAIL`. It lasts 15 minutes.
  - It is needed for fees, limits, the allowlist, tips, the fee wallet, the Real trading and
    Wallet deposits switches, API keys, and promo codes.
  - `ADMIN_TOKEN` and `OWNER_EMAIL` are read only from `.env`, never from the admin, so a stolen
    admin key alone cannot redirect the money.
- Every change goes to `data/audit.jsonl` with its before and after value. Keys are never logged,
  only their last 4 characters.

## Part 1: settings without code (`platform.rs`)

- **Settings:**
  - Trade fee (0.5%) and deposit/withdrawal fee (1%), each 0–3%.
  - Largest trade, and the smallest and largest deposit.
  - Real-trading allowlist.
  - Fast and Turbo tips.
  - Sol Radar Lower risk score (80) and hold time (180 s).
  - Saved in `data/platform.json`. Trades and transfers use a change at once; the site picks it
    up within 5 minutes.
- **API keys:** Helius, Jupiter, X, Reddit and Telegram.
  - Saved in `data/secrets.json` on the server. A key set here wins over `.env`.
  - Helius RPC switches at once. The Helius live stream picks up a new key on the next restart.

## Part 2: users and earnings (`ops.rs`)

- **Users:**
  - Search by email, Kixo wallet or id.
  - The detail view shows the wallet balance, real trades, deposits and withdrawals, tickets and
    the demo account.
  - **Pause trading:** stops trades and deposits. Withdrawals always stay open.
- **Earnings:**
  - Trade fees come from confirmed `real_trades` rows. Deposit and withdrawal fees come from
    confirmed rows in `data/transfers.jsonl`, which the wallet writes on send and again on
    settle.
  - The fee wallet's on-chain balance is shown as a cross-check. Nothing is estimated.
- **CSV export:** users, trades and transfers. Cells are quoted, and a value that would start a
  spreadsheet formula is defused.

## Part 3: marketing (`marketing.rs`)

- **Tracking links:** `/?c=CODE`.
  - One visit is counted per visitor per day.
  - The sign-up is attributed to the first link the person used in the 30 days before.
  - The funnel shows sign-up → wallet → deposit → real trade, overall and per link.
- **Promo codes:** a share off Kixo's own fee, for trades, transfers or both, with an end date
  and a use limit.
  - Creating one needs the owner session.
  - Ending a code returns everyone who used it to normal fees.
  - The trade fee is applied per user inside the quote. The browser's checks still verify the
    exact amounts.
- **Banner and popup:** start and end time, and the audience (everyone, signed out or signed in).
  The popup shows once per visitor and again after it is edited, so it also serves broadcasts.
- **Social links** in the footer, and the search title and description, which are read on the
  server and cached for a few minutes.

## Still a design only (marked Preview)

Annual review, Rewards settings, Approvals and Team. The current admin has one key and one owner,
with no separate team roles yet.
