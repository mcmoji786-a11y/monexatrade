# Launch checklist

These must be done before any real user or real money touches MONEXA.

## Secret rotation (the keys were shared in a chat during setup)
- [ ] Rotate the Helius API key
- [ ] Rotate the Supabase secret (service_role) key
- [ ] Reset the Supabase database password

## Security (spec section 21)
- [ ] Penetration test
- [ ] Independent security audit
- [ ] Wallet security review
- [ ] Database / RLS review
- [ ] API security testing and rate limiting
- [ ] Disaster recovery test

## Data providers
- [ ] Review Jupiter Tokens API terms for commercial use. Get an API key if it raises limits (ADR 0004)
- [ ] Run our own IPFS gateway instead of pump.fun's Pinata gateway (gateway `metadata.rs`)
- [ ] Rotate the Upstash Redis password (it was shared in chat)

## Legal
- [ ] Legal review of trading fees and automated trading in the target jurisdictions
