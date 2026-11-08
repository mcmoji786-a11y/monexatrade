# 0008: AI trading agent, phase 1 choices

Date: 2026-11-08. Decided by the founder, from the AI agent master prompt.

## Decisions

- **Stack:** the agent lives in the Rust gateway. It reuses the ingest scanner, our launchpad
  decoders, the demo (paper) engine and the real trading engine. There is no separate
  TypeScript service.
- **LLM:** Claude later, when there is budget. Phase 1 makes every decision without an LLM and
  writes the reasons from rules, as the "Quick read" does now. A provider-agnostic LLM
  interface is ready, so adding a key later only improves the wording. The LLM never takes
  part in a decision.
- **Data:** Supabase free plan, kept lean:
  - Snapshots only for coins that survive their first minute with real trading, kept for 14
    days.
  - One small outcome row per coin (rugged, dead, 2x, 5x, 10x+), kept for 60 days.
  - Target: under about 120 MB in total.
- **Autopilot:**
  - With real money, only Copilot: the AI suggests, and the user approves each trade in
    Phantom. Kixo never holds keys.
  - Autopilot runs only on the demo account.
  - A delegated, non-custodial wallet (session keys, capped amounts) may come in a later
    phase, after legal advice.
- **Language:** the UI stays in English (the Urdu UI toggle was declined earlier). A chat that
  answers in the user's language is phase 2.

## Rules carried over from the prompt

- Hard risk limits are enforced in code, never by the LLM: size per trade, open positions,
  daily loss (the agent halts), slippage and minimum liquidity.
- No manipulation tactics. The agent detects them and avoids them.
- No "guaranteed profit" wording anywhere.
- Every decision is logged with its reasons.
