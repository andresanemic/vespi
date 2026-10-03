# Changelog

All notable public changes to Vespi will be recorded here.

This project is experimental. Before `v1.0.0`, version numbers describe public snapshots of a system still under active arbitration.

## [v0.1.3-kernel] — 2026-10-03

Released: this version carries the `v0.1.3-kernel` tag; the previous tag is `v0.1.2-kernel`. Everything below was read in this tree.
The note that opens with what this changes for the person is [`RELEASE_0.1.3_KERNEL.md`](./docs/RELEASE_0.1.3_KERNEL.md).

### Added

- K1: the impossible task returns `blocked` with its exit, `authority.pausers` decides who may pause, and the human gate has its four gestures.
- K2: authority with a clock, a budget and a destination, and approval by several named people.
- K3: receipts with a SHA-256 fingerprint, coverage that is not a claim, and an honest anchoring ladder.
- K4: continuity by receipts with the revalidation gate, and a decision model that advises and never consents.
- K7: work delegated to a cheaper model returns with a receipt, is reviewed by the orchestrator before anything is integrated, and leaves sparks behind.
- Apache 2.0 with a NOTICE, and a bilingual README verified against the code.
- A backup capability outside the kernel, `capabilities/respaldo/`: it copies a working tree, binaries included, into a folder the person already syncs; incremental by SHA-256 with a manifest, with verification, restoration and «where is the latest copy». The destination is the grant's `to`. No encryption, no versions and no API upload yet; see its `LEEME.md`.

### Changed

- The x402 demo is told from Queen, not from Bora: the environment variables are now `QUEEN_PAY_TO` and `QUEEN_PAY_TO_EXPECTED` and the sample plan is titled «Queen Marketing Plan». The sealed historical receipts under `experiments/` are untouched.

### Fixed — adversarial review before the release

- x402 demo adapter, found by the first live testnet run on 2026-10-02: settlement verification read `txn.ledger` as a number when the Horizon SDK exposes it as a link (the sequence is `ledger_attr`), so a paid and settled run came back `not_verified`. A second run came back `verified`; a third, after the `checks`/`facts` split below, listed only `external anchor` in `notCovered` (transaction `abb968e8…`, confirmed on Horizon).
- x402 demo verification returns `checks` as booleans only and keeps hashes, names and counters in `facts`; before, those values showed up as `notCovered` on a receipt that had verified.
- Kernel messages are in English on every path, including the resume one.
- The receipt keeps the amount it exercised, and carries the action the agreement names, so a real receipt pairs with a real agreement.
- The receipt names who approved, and a gate approval no longer erases who can pause.
- The anchor names its network in CAIP-2 (`stellar:testnet` or `stellar:pubnet`), refuses any other, and its verifier confirms the network as well as the digest.
- `verifyReceipt` is declared, in the code and in the README, as a proof of integrity and not of authenticity.

### Not in this release — scoped for 0.1.4

- Emergency access granted in advance and exercised with an immediate receipt, a zero-knowledge proof verifier, skill provenance, and x402 live inside the kernel itself (the demo adapter already pays live on testnet).
- The receipt is not durable by itself: the caller owns where it lives, and nothing here makes it authentic.

## [v0.1.2-kernel]

Released: this version carries the `v0.1.2-kernel` tag. The release that follows it, 0.1.3, is described above.

### RUN 05 — public evaluation surface (local, not released)

- Judge quickstart in both language sections of `README.md`; reference x402 endpoint and explicit testnet prerequisites.
- Remove the compatibility-only `README_es.md`; `README.md` is now the single bilingual public surface.
- RUN 05 repair: x402 adapter checks effective 402 terms against its declared fixed effect and the operation grant, and prepares the exact Soroban transfer/auth digest before the paid request; offline adversarial test covers amount, token, recipient, network, scheme and signing-window divergence.
- Current code gate after external Stellar/blockchain/x402 review: destination-bound payment authority, no redirect forwarding, bounded fetch/body deadlines, abort propagation before the paid request, post-settlement exact Soroban authorization checks, transaction hash/network binding, marketing-plan schema validation, receipt evidence allowlist, and route-level in-process payment deduplication after x402 processing.
- Local verification at that release: 47/47 kernel tests and 53/53 demo tests; `npm test` in `demo/x402` includes the adversarial suite. Not a current figure — see 0.1.3 above.
- Scope remains an offline-testable demo. Durable cross-process operation/idempotency storage and production payment readiness are not claimed.

## [v0.1.1-kernel] — 2026-09-23 (16/16 tests at release)

### Fixed — authority integrity (external review findings, TDD)

- Verifier exception after side effect now returns a `not_verified` receipt (evidence kept, no rerun, never `running`, never `verified`).
- Grant consumption is per-grant, not per destination group: split requirements against one grant share its single `maxAmount`; destination-specific grants keep separate budgets.
- Gate provenance survives terminal outcomes: receipts record `preauthorized` / `human_gate_approved` / `human_gate_rejected` including failed runs.

### Public hygiene

- Test command documented in both READMEs; autonomy working direction published (labeled, not claimed as capability).

## [v0.1.0-kernel] — 2026-09-23

The entries below are historical release evidence; they do not describe the current working tree.

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