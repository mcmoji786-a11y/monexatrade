# 0006: The product is called Kixo

Date: 2026-11-07. Decided by the founder.

The platform was called MONEXA. Its final name is **Kixo**, with the title
"Kixo – AI-Powered Solana Memecoin Trading Terminal".

## What changed

- Every name people see: page titles, the logo, the landing page, sign-in, support,
  share cards, emails and wallet-link messages, error messages from the gateway.
- The browser title is the full tagline on the home page and "Page · Kixo" elsewhere.
- Project documents (CLAUDE.md, README, the spec text, docs).

## What keeps the old name on purpose

- Code names: the Rust crates (`monexa-gateway`, `monexa-ingest`, `monexa-common`),
  `MONEXA_MASTER_SPEC.md`, the `--mx-` CSS variables, `mx.*` browser storage keys and
  `mx:*` events. Users never see them, and renaming storage keys would reset everyone's
  saved settings.
- Migrations that have already run in Supabase.
- The old footer domain was removed until the Kixo domain is chosen.
