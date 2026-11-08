# 0009: Kixo Sender, our own transaction path

Date: 2026-11-08. Decided by the founder: "we don't want to use any provider, we want our own system".

## Decision

- Kixo does not add any more third-party RPC or data providers (dRPC, Alchemy, Chainstack,
  QuickNode, PumpPortal).
- For transactions, Kixo has its own sender (`services/gateway/src/sender.rs`). It sends each signed
  transaction straight to the validators that will build the next blocks, using Solana's own
  TPU protocol: QUIC with ALPN `solana-tpu`, one unidirectional stream per transaction.
- Helius free and the Solana public node stay for now (decision 0007).
- An own RPC node with a Yellowstone gRPC stream comes later, when there is budget (about $700
  to $1,500 a month on bare metal; Hetzner does not allow Solana nodes).

## How it works

- **Schedule:**
  - `getSlotLeaders` returns 5,000 slots per call, about 33 minutes.
  - `getClusterNodes` gives the validator QUIC addresses, refreshed every 10 minutes.
  - `getSlot` runs every 2 s while someone is trading, and the slot is moved on at 400 ms a slot
    in between.
- **Warm connections:** while a trade ticket is open, connections to the leaders of the next 20
  slots stay open. A click is sent on an already open connection.
- **Fanout:** each send goes to the leaders of the previous slot through the next 12 slots,
  which is 3 or 4 validators.
- **Re-sending:** the tracker re-sends directly every 800 ms until the trade lands. This uses
  no RPC credits.
- **Alongside the other paths:** it runs at the same time as Helius Sender, Jito and the RPC,
  never alone. The signature is the same on every path, so the trade can only land once.
- **Receipt:** each trade records which paths took it, how many validators were reached, the
  slot it was sent in, the slot it landed in, and the number of slots between them. The trade
  ticket shows this to the user.
- **Monitoring:** health is at `GET /trade/sender`.
- **Admin switch:** `kixo_sender`, on by default. It only matters while real trading is on.

## Limits

- Our connections are unstaked. In congested slots, validators give staked connections
  priority (stake-weighted QoS), so the priority fee still matters. This is why the other paths
  stay.
- From a home PC in Pakistan the QUIC handshake takes about 310 ms (measured with 9 of 9 leaders
  accepting). On a Frankfurt VPS, where many leaders are, it should take about 10 to 30 ms.
  Warm connections hide this latency either way.
- Landing has not been tested with real money yet. That waits for the real-trading security
  review.

## Fast Path (added the same day)

- **Recording:** a trade is first written to a local journal (`data/trade_journal.jsonl`), then
  sent. The database row is written in the background with retries. If the gateway stops
  first, the next start writes the row from the journal. Before this change, every trade waited
  100 to 300 ms for Supabase before it was sent.
- **One tracker for every trade in flight** (`tracker.rs`):
  - Statuses are read in batches of 256 every 400 ms, so 1,000 trades cost 4 calls per tick.
  - The block height is read once every 2 s.
  - Direct re-sends run every 800 ms, at most 300 transactions per round.
  - RPC re-sends happen only for trades the direct path could not deliver.
- **Connection pool:** each leader gets 2 connections while someone is trading, and 4 under load.
  Validators allow an unstaked connection about 128 concurrent streams.
- **Kixo time** (`kixo_us`): the time from the signed trade reaching Kixo to its first copy on the
  network. It is shown in the trade receipt.

Load test (release build, 4 local mock validators, each allowing 128 streams per connection):

| Load | Kixo time p50 | p99 |
|---|---|---|
| 100 traders at the same instant | 0.10 ms | 0.44 ms |
| 1,000 traders within 1 s | 0.15 ms | 1.2 ms |
| 5,000 traders within 1 s | 0.11 ms | 1.1 ms |
| 1,000 traders at the same instant, pools already grown | 0.16 ms | 30 ms (stream-window queue) |
