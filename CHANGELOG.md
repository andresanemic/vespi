# Changelog

All notable public changes to Vespi will be recorded here.

This project is experimental. Before `v1.0.0`, version numbers describe public snapshots of a system still under active arbitration.

## [Unreleased]

### Added

- `experiments/001-operator-professor-loop`: first live Operator↔Professor run (evidence + independent arbitration, 0 human interventions).
- `experiments/002-x402-slice1`: paid capability run on Stellar testnet (0.01 USDC settlement, verified receipt + brief) with all three paths recorded (success, rejected_policy, rejected_human) and one real verification failure kept as evidence.

### Not yet

- Production receiver and deploy still pending; demo accounts are temporary and labeled as such.

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