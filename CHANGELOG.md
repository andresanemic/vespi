# Changelog

All notable public changes to Vespi will be recorded here.

This project is experimental. Before `v1.0.0`, version numbers describe public snapshots of a system still under active arbitration.

## [Unreleased] — v0.1.1-kernel candidate

### Fixed — authority integrity (external review findings, TDD)

- Verifier exception after side effect now returns a durable `not_verified` receipt (evidence kept, no rerun, never `running`, never `verified`).
- Grant consumption is per-grant, not per destination group: split requirements against one grant share its single `maxAmount`; destination-specific grants keep separate budgets.
- Gate provenance survives terminal outcomes: receipts record `preauthorized` / `human_gate_approved` / `human_gate_rejected` including failed runs.

### Public hygiene

- Test command documented in both READMEs; autonomy working direction published (labeled, not claimed as capability).

## [v0.1.0-kernel] — 2026-09-23

### Added — experiments

- `experiments/001-operator-professor-loop`: first live Operator↔Professor run (evidence and independent arbitration, 0 human interventions).
- `experiments/002-x402-slice1`: paid capability run on Stellar testnet (0.01 USDC settlement, verified receipt and brief) with all three paths recorded (success, rejected_policy, rejected_human) and one real verification failure kept as evidence.

### Added — first executable code

- `src/` (operation, authority, receipt — zero deps, 8/8 `node:test` green): same operation gates without authority (`needs_human_decision`, zero side effect) and continues with it (verified receipt), including counterparty-bound grants.
- `demo/x402/` (adapter and runner, own deps): official x402 v2 round-trip behind the kernel boundary; kernel imports nothing x402/Stellar.
- Live settlements on testnet with independent verification (see `experiments/002`).

### Not claimed

- General orchestration, arbitrary capabilities, production payments, swarms, brief generation (deterministic template, declared), multi-run budgeting.

## [v0.0.1-genesis] — 2026-09-22

### Added

- Public bilingual README (`README.md` / `README_es.md`).
- First public statement of the problem: capability, context, visibility and authority are not the same thing.
- Operation-first working thesis: **the unit is not the agent; the unit is the operation**.
- Initial bounded-authority model and non-transitive permissions.
- First description of heterogeneous bodies, including blind and Lore-bound roles.
- Stellar flagship direction: authorized payment changes what an operation can do.
- Public `GENESIS.md` recording provisional theses and explicit non-claims.
- Public build method inherited from the LUS / Lore Plugin practice.

### Not in this release

- No production runtime.
- No stable Vespi protocol.
- No production wallet or custody layer.
- No claim of regulatory compliance.
- No claim that current research hypotheses are product laws.
- No final visual identity.

### Next gate

Build and verify the first Stellar RC while preserving the public history of decisions, tests, rejected paths and releases.