# Changelog

## [v0.1.4-kernel] | candidate cut, publication date pending

This cut preserves the authority you granted and the next agreed action while returning uncertain exercised effects to you for reconciliation. The previous version is `v0.1.3-kernel`; the [bilingual release note](./docs/RELEASE_0.1.4_KERNEL.md) explains what entered from its promise and the limits of each part.

### Continuity, authority and receipts

[Continuation tests](./test/v014.test.js) cover `reconciliation_required` after exercised uncertainty, a stable `idempotencyKey` passed to `perform`, per-action attempt limits and an injected synchronous clock, but receipt storage, trusted time, destination deduplication and waking the process remain host responsibilities. Delegation deadlines report status when queried; they do not schedule work. [Anchor regressions](./test/anchor-digest-stability.test.js) preserve the digest sent and confirmed, but a digest proves integrity, not authenticity.

### What entered from the 0.1.3 scope

[Emergency regressions](./test/k1-emergencia-r6-advisor.test.js) cover prior grants, declared triggers and separate post-use reviews based on opaque host-issued principals, but do not authenticate real people, persist state, supply trusted time or execute and verify effects. Exercise requires the grantee's principal; independence follows the host's identity mapping. D4 counts uses, with money ceilings imposed by the consuming project.

[Provenance regressions](./test/k2-procedencia-r5-advisor.test.js) cover comparison against a resolver's own evidence without passing declared `author` or `contentDigest` to it, but the resolver is not authenticated and built-in function replacement by same-process code is outside the contract. Hostile data, including polluted prototype data, is in scope. Receipts distinguish verified from declared provenance; the name remains declared.

[x402 regressions](./test/k4-x402-r3-advisor.test.js) cover the 0.1.4 paid-effect contract with injected ports, mandatory synchronous `claims` and operation identity in the effect key. The memory store is not durable, reservations are not released and the validator's output digest is not recomputed by the kernel. Anyone can build on this contract with their own ports. The reference bridge using the real Stellar SDK is excluded from this cut because two independent reviews rejected it: 15 of 20 attacks were not blocked in the first review and 13 of 26 were not blocked in the second, including authorization replay, an overwritten inspection window and reads that continue after cancellation. Neither review demonstrated improper settlement or key disclosure. The bridge remains for 0.1.5.

[ZK port tests](./test/k3b-zk-port.test.js) cover a pinned key and agreed public inputs, but the cryptographic backend is injected. The [internal BN254 Groth16 reference](./src/zk-bn254-reference.js) has [independent fixture evidence](./test/fixtures/zk/independent-report.md), but is unexported as a public API, unaudited, not constant time and not production ready. Proofs are malleable, a degenerate key accepts forgeries, and synchronous CPU work cannot be interrupted by a Promise timeout. It does not authenticate a presenter, attest an institution or prevent replay.

### Evidence and compatibility

The [saved suite result](./docs/SUITE_RESULT.txt) records the command and exact counts for this cut. [Saved evidence](./docs/testnet-evidence.json) records 50 Horizon readbacks, 5 semantically verified cases, 45 partially verified cases and 0 discrepancies, against local execution records rather than expectations taken from Horizon. This is testnet with fictional data and no real money. The historical payments do not demonstrate the excluded reference bridge or integration with Casa Firme and Vela.

D3 stamps `stellar:testnet` in every newly built pending anchor, without affecting the digest; it becomes configurable in 0.1.5. Old receipts without `checks` retain their shape and digest in [regressions](./test/k3-zkref-r2-advisor.test.js), but unknown reserved `zk.` controls are now refused and change the rebuilt digest; unknown exercised shapes carry `exercisedUnknown`. Compatibility is not universal. D5 keeps Vela's demonstration content plaintext; a real deployment requires encryption at rest and third-party key custody.

### Qué NO trae el 0.1.4 y pasa al 0.1.5

Spend-authority narrowing stays out because the base `grantSpend` constructor has an inherited-setter defect. The [release note](./docs/RELEASE_0.1.4_KERNEL.md#what-014-does-not-bring-and-moves-to-015) records the exact reasons for x402 HX-09, HX-11, HX-12, HX-13 and R2-05; provenance N07, N08, H12d and H13d; emergency H21; and the real-SDK reference bridge, deferred after two independent rejections. Recursive x402 output inspection is also later work; other boundary `todo` cases do not promise future fixes. No durable stores, refunds, shared money budgets, scheduler, autonomous cross-host runtime, mainnet evidence or production readiness enter this cut.

All notable public changes to Vespi are recorded here. Earlier sections below are historical evidence, not current suite counts or current scope.

## [v0.1.3-kernel] — 2026-10-03 (historical)

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
