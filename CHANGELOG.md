# Changelog

## Instawards Chile · Week 1

November 16–20, 2026 · updated November 21 with the results of the November 19 talk

Vespi Contributions is live on Stellar testnet. Two people can record a meeting or collaboration, confirm what each person contributed, and share a receipt. We tested this across a desktop browser and an Android phone. At the Tellus talk on November 19, the speaker signed the talk as a contribution and six people signed that they attended, each from their own account.

### Added

- A bilingual web app with passkey accounts, a list of recent encounters, and drafts you can resume.
- Records for one-way and mutual contributions, with invitations for people who already have an account and people who need to create one.
- Photo evidence, signed receipts, and public receipt verification. Stellar records the receipt digest. Images are stored separately.
- A page for Yerko Pincheira Sánchez’s talk at Tellus, with slides and a flow for multiple attendees to attest after the speaker signs.
- A bilingual Tellus feedback survey. Survey answers are stored separately from the testnet commitment.

### Changed

- The primary flow starts with what already happened: a meeting, a talk, or help someone gave. The encounter shows who is expected to act next.
- Public release evidence and instructions are collected in the submission repository.

### Fixed

- Tightened the iPhone date field and horizontal layout, and added breathing room between the mobile home sections.
- Kept the app, talk and survey in the same visual system, with theme and language controls.

### At the Tellus talk · November 19

This was a real use of the app on Stellar testnet. It does not count toward the three mainnet pilot pairs planned for Week 4.

- The talk was recorded in three steps, each signed by its own author: the organizer requested it, the speaker delivered it, and the organizer accepted it. [Request](https://stellar.expert/explorer/testnet/tx/d092e5755f56d85b0721e2db5a95193c6e229cd83bd18bd50ed7333aa641c778) · [Contribution](https://stellar.expert/explorer/testnet/tx/2d6787e9334e042f1664cdf5e8312992132a41408e512ed262a18b0dd0e9b3a7) · [Acceptance](https://stellar.expert/explorer/testnet/tx/df49f10ad3ba9beac6c20a01a318f853f791a571ac126c68942d880ec9b43b81)
- Six people signed an attendance attestation linked to the speaker’s contribution, from six different accounts. [1](https://stellar.expert/explorer/testnet/tx/51e99b62fad19a7630434e5b591ca0bbaf1f799aed759adedc1aa738319e55ee) · [2](https://stellar.expert/explorer/testnet/tx/ac7d0e3e84ed6bd8630bacc6b13c87369a2dba330f40b996605d1e1a638d9817) · [3](https://stellar.expert/explorer/testnet/tx/4952bc98c25543acd5a7ee6e8e74a8d268ac098c4edb7682ecb61c5e9403ecb3) · [4](https://stellar.expert/explorer/testnet/tx/04c88b31f787db8b659314a56bbd4305e3bfbd6ea2cb336a62f14681540c33e7) · [5](https://stellar.expert/explorer/testnet/tx/7418522a8f7e2d1923ce896d44d20483dbc2ba129d77dd3dd7551b23a63020b4) · [6](https://stellar.expert/explorer/testnet/tx/e75424b72dc0176bb914e46f5a3e7852c1e18e61ea9e8e218ec15203b91f7ca0)
- In total, eight accounts signed nine records on the day.

### Progress vs previous week

| Area | Starting point | Week 1 |
| --- | --- | --- |
| Participants | Single-payer sandbox and simulated roles | Two signing accounts in a desktop-to-Android trial, and eight accounts at the Tellus talk |
| Onboarding | Test fixtures | Passkeys and sponsored testnet accounts |
| Receipts | Sandbox artifacts | Shareable receipt pages and testnet transactions |
| Event | Planned trial | Request, contribution and acceptance for one talk, plus six attendance attestations |

### Evidence

The published source passed all 156 Contributions tests and a production build with Node.js 26.13.0.

- [Live app](https://vespi.xyz/app)
- [Example mutual contribution on testnet](https://vespi.xyz/app?mutual=abf70f4d3339cb1276222e721e83a0516fecdb0f164c9f63846a5789902eed49&return=ab919ba6d40f6deda88180022ed0a394c04a6089bad8830ffa0eadba29a229f9)
- [Receipt signed on iPhone](https://vespi.xyz/app?receipt=92c08f2b27d4f78b5db522b4aec1aafd8da5a845ffbfc2873043e19dc5392e5f)
- [Tellus talk page](https://vespi.xyz/app/evento/yerko)
- [Synthetic survey commitment on Stellar testnet](https://stellar.expert/explorer/testnet/tx/54813dd8f863f49dbf2a02794c5bd069d55328189d7d97e86e6d493ac2c85b12)

### Blockers and lessons

- Showing who needs to confirm next made it easier to resume a record.
- Only the talk we set up in advance could collect attestations from several people. The Chilean Instawards projects that presented the same day had no way to let more than one person sign for their presentation.
- Writing down what you did is slow. At an event, people would rather say it than type it.

### Next week

Andrés and Francisco record a contribution between them on Stellar mainnet, each with a separate account, and publish its receipts and a shareable result page.

We also plan to add voice input, based on [Voice Ready](https://github.com/mpefaur/voice-ready), shared with us by its author. A person records a voice note of up to 30 seconds, AI drafts the record, and the person reviews and edits the draft before signing.

### Links

- Video: [pending]
- X post: [pending]
- Research essay: [The value of decentralized micro relationships](./docs/research/the-value-of-decentralized-micro-relationships.md), by Andrés Peña and Francisco Toro

## [v0.1.8-kernel] — 2026-10-23

This version adds checkpoint/continuation handling and closes host-callback return validation before effects. Callback receivers vary by port; see [the callback contract and compatibility limits](./docs/HOST_CALLBACKS.md) and do not rely on a receiver. `runOperation` and x402 reject non-native thenables without subscribing; host-provided functions in emergency and delegation may return thenables, which the kernel subscribes to. `attenuates` rejects an authority with too many grants to verify within its fixed work budget; `MAX_ATTENUATION_WORK` is 1,000,000 units. Two limits stay declared: a checkpoint's generation does not order two checkpoints by itself when the authority already covers the spend, so the host must consume each checkpoint atomically and enforce its own minimum generation (`minGeneration` does not tell such checkpoints apart); and the context is re-read once just before `perform`, so in x402 it can change while `prepare` runs. The source suite passes 1,319/1,319 with zero skipped or TODO tests. [Evidence and adoption limits](./docs/RELEASE_0.1.8_KERNEL.md).

Esta versión incorpora checkpoints y continuación, y cierra la validación de resultados de callbacks del host antes de los efectos. `runOperation` y x402 rechazan thenables no nativos sin suscribirse; las funciones que entrega el host en emergency y delegation pueden devolver thenables, a los que el kernel se suscribe. `attenuates` rechaza una autoridad con demasiadas concesiones para comprobarla dentro de un presupuesto fijo; `MAX_ATTENUATION_WORK` es de 1.000.000 unidades. Quedan dos límites declarados: la generación de un checkpoint no ordena por sí sola dos checkpoints cuando la autoridad ya cubre el gasto, así que el host debe consumir cada checkpoint de forma atómica y aplicar su propia generación mínima (`minGeneration` no distingue esos checkpoints); y el contexto se relee una vez justo antes de `perform`, por lo que en x402 puede cambiar mientras corre `prepare`.

## [v0.1.7-kernel] — 2026-10-13

Current source preserves the scope of a payment approval, keeps uncertain sends reserved, and records provenance verification time and rejected requests. It also verifies the bytes of delivered JSON and exposes the sealed effect key and public x402 code catalog. Twelve pending tests are now active; twelve obsolete or out-of-contract expectations were retired with their reasons recorded. Six regressions were added. [Release suite](./docs/SUITE_RESULT_0.1.7.txt): 1,218 passed, 0 failed, 0 todo, 0 skipped; x402 demo: 86 passed. Old receipts remain verifiable; new provenance/x402 receipts contain additional sealed fields. The published v0.1.6 tag and pinned copies remain unchanged. [Resolution and limits](./docs/TODO_RESOLUTION.md).

## [v0.1.6-kernel] — 2026-10-10 (local cut)

Servine. A local cut: it is not published. It closes a gap in skill provenance (a duplicated declared capability no longer leaves the registered authority incomplete), adds `examples/refusal.js` (an over-limit operation is refused with no effect, an in-limit one runs and verifies), a threat model and a note on why Stellar, and says exactly what the x402 demo adapter is: the SDK bridge inside the kernel stays deferred. Reviewed with our own Claude Code superreviews, not audited. Find Your Way: the submission is complete except for its video; this is its last tag. Suite: 1224 tests, 1200 pass, 0 fail, 24 todo.

## [v0.1.5-kernel] — 2026-10-08

This release lets callers name the network of a new pending receipt anchor with `buildReceipt({ anchorNetwork })`, retaining `stellar:testnet` as the default and accepting `stellar:pubnet`. It also carries an opt-in x402 reference bridge in `demo/x402/`, gated behind `--bridge=1`, with a single-authorization transfer shape and bounded, cancellable settlement reads. A Horizon response that resolves to a malformed shape (e.g. `null`) now returns a closed settlement failure instead of leaking a raw `TypeError` — regression F5e in `test/f5e-settlement-malformed.test.js` and `demo/x402/bridge.test.mjs`. The [bilingual release note](./docs/RELEASE_0.1.5_KERNEL.md) records its tests and limits; the bridge SPEC (`docs/x402-recorte/SPEC.md`) is now synchronized with the implemented closures. The bridge tests use the real Stellar SDK with local fixtures; there is no live payment in this cut.

## [v0.1.4-kernel] — 2026-10-05 (published)

This cut preserves the authority you granted and the next agreed action while returning uncertain exercised effects to you for reconciliation. The previous version is `v0.1.3-kernel`; the [bilingual release note](./docs/RELEASE_0.1.4_KERNEL.md) explains what entered from its promise and the limits of each part.

### Continuity, authority and receipts

[Continuation tests](./test/v014.test.js) cover `reconciliation_required` after exercised uncertainty, a stable `idempotencyKey` passed to `perform`, per-action attempt limits and an injected synchronous clock, but receipt storage, trusted time, destination deduplication and waking the process remain host responsibilities. Delegation deadlines report status when queried; they do not schedule work. [Anchor regressions](./test/anchor-digest-stability.test.js) preserve the digest sent and confirmed, but a digest proves integrity, not authenticity.

### What entered from the 0.1.3 scope

[Emergency regressions](./test/k1-emergencia-r6-advisor.test.js) cover prior grants, declared triggers and separate post-use reviews based on opaque host-issued principals, but do not authenticate real people, persist state, supply trusted time or execute and verify effects. Exercise requires the grantee's principal; independence follows the host's identity mapping. D4 counts uses, with money ceilings imposed by the consuming project.

[Provenance regressions](./test/k2-procedencia-r5-advisor.test.js) cover comparison against a resolver's own evidence without passing declared `author` or `contentDigest` to it, but the resolver is not authenticated and built-in function replacement by same-process code is outside the contract. Hostile data, including polluted prototype data, is in scope. Receipts distinguish verified from declared provenance; the name remains declared.

[x402 regressions](./test/k4-x402-r3-advisor.test.js) cover the 0.1.4 paid-effect contract with injected ports, mandatory synchronous `claims` and operation identity in the effect key. The memory store is not durable, reservations are not released and the validator's output digest is not recomputed by the kernel. Anyone can build on this contract with their own ports. The reference bridge using the real Stellar SDK is excluded from this cut because two independent reviews rejected it: 15 of 20 attacks were not blocked in the first review and 13 of 26 were not blocked in the second, including authorization replay, an overwritten inspection window and reads that continue after cancellation. Neither review demonstrated improper settlement or key disclosure. The bridge remains for 0.1.5.

[ZK port tests](./test/k3b-zk-port.test.js) cover a pinned key and agreed public inputs, but the cryptographic backend is injected. The [internal BN254 Groth16 reference](./src/zk-bn254-reference.js) has [independent fixture evidence](./test/fixtures/zk/independent-report.md), but is unexported as a public API, unaudited, not constant time and not production ready. Proofs are malleable, a degenerate key accepts forgeries, and synchronous CPU work cannot be interrupted by a Promise timeout. It does not authenticate a presenter, attest an institution or prevent replay.

### Evidence and compatibility

The [saved suite result](./docs/SUITE_RESULT.txt) records the command and exact counts for this cut. [Saved evidence](./docs/testnet-evidence.json) records 50 Horizon readbacks, 5 semantically verified cases, 45 partially verified cases and 0 discrepancies, against local execution records rather than expectations taken from Horizon. This is testnet with fictional data and no real money. The historical payments do not demonstrate the excluded reference bridge or integration with Casa Firme and Vela. A simulated security review (three reviewers on OpenCode models plus a verifier that reproduced each finding; it is not a review by Anthropic) found ten issues in this cut, all fixed with a red test first: error text from a port sealed in receipts, record collection following links or reading oversized files, an unvalidated hash in a Horizon URL, a self-calling settlement reader in the demo, a digest blind to a `__proto__` key, exception text in `verifyReceipt`, and an unguarded `JSON.stringify` on delegate output.

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

- The x402 demo is told from Queen, not from Vespi: the environment variables are now `QUEEN_PAY_TO` and `QUEEN_PAY_TO_EXPECTED` and the sample plan is titled «Queen Marketing Plan». The sealed historical receipts under `experiments/` are untouched.

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
