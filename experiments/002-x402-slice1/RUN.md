# Run 002 — x402 slice-1: paid capability on Stellar testnet (2026-09-23)

`compose-launch-brief`: 402 → exact-policy check → human gate → 0.01 testnet USDC →
plan → brief → receipt → independent verification. Three paths recorded
(success, rejected_policy, rejected_human) plus one real failure that taught the verifier
how settlement actually works.

## Success

- Settlement: https://stellar.expert/explorer/testnet/tx/eac01a02a316480702117a3a9ae90e9b8e1b77554088c004bda919a7f4d95198
- `receipt-success.json` (status `verified`), `brief.md` (deterministic template, declared).
- Independent `verify` re-check: tx successful + 0.01 USDC payer→payTo transfer found.

## Honest boundaries

- Accounts are **temporary demo accounts on testnet**, not BORA's. Production `payTo`
  still belongs to BORA (pending authorization). The causal circuit is identical; the receiver is not.
- Brief assembled by deterministic runner template (declared in receipt); authorial synthesis pending.
- Server ran locally; settlement and verification are on public testnet.

## Real failure, kept

- `receipt-settlement-unverified-FIRST-ATTEMPT.json`: payment settled, but the verifier
  looked for a classic payment op while official x402/Stellar settles via Soroban token
  transfer (`invoke_host_function`, visible in `asset_balance_changes`). Verifier fixed
  against the real chain; second run green. History is kept imperfect on purpose.
