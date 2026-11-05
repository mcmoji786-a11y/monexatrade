# MONEXA roadmap (V1)

| Phase | Scope | Real money | Status |
|---|---|---|---|
| 0 | Foundation: repo, Rust workspace, Next.js shell, env, decision log | No | Done (commit c8f5aff) |
| 1 | Data engine (Rust): Helius streams, RPC failover, active-token tracking, dead-token pruning, Upstash Redis | No | In progress: Stage 1.1 (live pump.fun new-token detection) done |
| 2 | Sol Radar and token detail pages, charts | No | Pending |
| 3 | Phantom connect, manual Buy/Sell (Jupiter, simulation, 0.5% fee). Devnet first, then mainnet with limits | Only after explicit approval | Pending |
| 4 | Failed-transaction recovery, Portfolio, Alerts | Yes | Pending |
| 5 | Wallet Tracker | No | Pending |
| 6 | Support, Bug reports, Rewards, Leaderboards, Admin (RBAC and audit logs) | No | Pending |
| 7 | Security audit, load testing, launch | Launch decision | Pending |

The product's Phase 2 (deferred) includes the AI engine, sniper and copy trading. See [ADR 0001](decisions/0001-v1-scope-and-stack.md).
