# Changelog

## Instawards Chile · Week 2

November 23–25, 2026

Andrés Peña and Francisco Toro completed the team reference chain on Stellar mainnet: Andrés requested a contribution, Francisco delivered it and Andrés accepted it, each signing from their own account. People can now record help they gave or received, and the record becomes public only after both of them sign it.

### Added

- Stellar mainnet for the three-step flow (request, contribution, acceptance), limited to accounts we enable during the sprint. Each network keeps its own storage, keys and sponsor limits.
- One way to record a contribution: “I helped someone” or “Someone helped me”. The text and the two names appear on both profiles after both people sign. Vespi serves the text and both signatures; Stellar holds the fingerprint. Older records stay private.
- Voice notes of up to two minutes that draft a record for the person to review and edit before signing. Open to everyone with a published name on testnet, with a daily limit; on mainnet, to enabled accounts. It builds on Voice Ready, shared by Martín Pefaur.
- A shareable result page for each chain, and an exporter that checks every receipt and transaction before writing the public evidence package.
- An attendance page for the November 25 focus group on testnet: people who were there can sign that they attended.

### Changed

- One passkey sign-in on testnet lasts up to twelve hours. On mainnet the app asks for the passkey when signing, except within two minutes of its last use.
- A shorter composer: what happened, with whom, review, sign.

### Fixed

- Sign-out sends its request right away and cannot end a newer session.
- The full text that will become public, including links, is shown before signing.

### Team reference chain on mainnet

- Request: “Francisco, te pido que conduzcas conmigo el focus group "Aportar en Stellar" del 25 de noviembre y prepares una síntesis de lo conversado, sin nombres de participantes.” Signed November 24 from `GDQM65PI4KNF77PBPQAWY77CPHD67O5KJ235BMKZR4FZ33SETRCVFYXY`. [Transaction](https://stellar.expert/explorer/public/tx/9ab8eb6aa543876fee3c98ff0ccfbfb0573facee60e4003fd07fd0658bfb3638)
- Contribution: “Hola, ya se hizo el focus, ya procesamos los audios, ya hicimos la síntesis de los contenidos y estamos trabajando en la extracción de información crítica para mejorar nuestro proyecto.” Signed November 25 from `GC3657FJKWW4F25CHSLALHQVGZGFPXRVQCM57YA5IB254DA652PX7VAI`. [Transaction](https://stellar.expert/explorer/public/tx/1445ac09388e0cf6c5998e03f78ca61735e2fe903630ce2294bf40cd1757264b)
- Acceptance: “Acepto este aporte.” Signed November 25 by Andrés. [Transaction](https://stellar.expert/explorer/public/tx/9625a477e8bbfd4c2a7d60bbc70754b11a342a80dbec793c569bfc42b6f1669c)
- [Result page](https://vespi.xyz/app/cadena/994fb550c6fa11280b2d30228a956e8d75bd836c9ead3d77973caa71b6fa6886?network=mainnet) · Evidence package: [`contributions/receipts/mainnet`](contributions/receipts/mainnet/994fb550c6fa11280b2d30228a956e8d75bd836c9ead3d77973caa71b6fa6886)

We ran the full flow on testnet first, marked as a rehearsal. [Result page](https://vespi.xyz/app/cadena/c4ec25e012d738f21ef1aeff923fd48999c373278cfbc79c316b432267208d22) · [Request](https://stellar.expert/explorer/testnet/tx/676540930f7df90aca6018379733d8b137fe2276b9a76e31794ea2e20be967f2) · [Contribution](https://stellar.expert/explorer/testnet/tx/9a36bba6ac54b18a977b8f1f4a9380adca57860e576d769743f74afc97d2a7c1) · [Acceptance](https://stellar.expert/explorer/testnet/tx/82ae098bce99dd12222c2bf4eb07dbcc44fd86c7a1d30d76ebcada9069a17565)

### Use cases on testnet

These are real uses of the app. They do not count toward the three mainnet pilot pairs planned for Week 4.

- Martín Pefaur and Andrés Peña both signed a public record of Martín’s contribution of the Voice Ready code, which the record calls VoiceNote. [Record](https://vespi.xyz/app/aporte/21d481cecbb54c8a97fc7536b1e5ae1c)
- November 25 focus group: by the evening of November 25, two people had signed that they attended, each from their own account. One of them was Francisco, who ran it with Andrés. [1](https://stellar.expert/explorer/testnet/tx/de33ad766110ab858eb16f1549ea73d0a7c969f9f1288d03c5179d633c57f7e2) · [2](https://stellar.expert/explorer/testnet/tx/481640acf36f8dfb6548d083953e4a6cbaf2c617592538ebbe216d144fac366d) Signing stays open until November 26, 20:00 Chile time.

### Progress vs previous week

| Area | Week 1 | Week 2 |
| --- | --- | --- |
| Network | Testnet | Testnet, and mainnet for enabled accounts |
| Team chain | Planned | Request, contribution and acceptance on mainnet |
| Recording | Encounters and contributions as separate options | One record that both people sign before it becomes public |
| Input | Typing | Typing or a voice note, reviewed before signing |

### Evidence

The [published source](contributions/) passed all 398 Contributions tests and a production build with Node.js 26.13.0. We checked the mainnet evidence package against Horizon.

### Blockers and lessons

- We kept trying to make the app simpler. We had several ways to record almost the same thing. People think “I helped” or “someone helped me”, so we merged them.
- Asking for a passkey at every step was tiring. On testnet, one sign-in now covers the session; on mainnet the app asks again after two minutes.
- Mainnet and testnet share the same code, so we had to make sure nothing crosses between them. Each network has its own storage, keys and limits, and the server refuses mainnet if its settings are missing or reuse testnet’s storage.
- Our review before release found that a person could sign a title or a link destination that the screen did not show. We fixed it before publishing: the full public text is visible and the server rejects anything else.
- At the focus group we heard two first lessons: the first hurdle is knowing who to ask for help, and recording some favors can make them feel like debts. We'll share the results next week.

### Next week

- The independent verifier: one command that checks the team reference chain from a clean checkout.
- At least ten invalid scenarios it must reject, with sponsor-policy checks, and CI on Linux, macOS and Windows.
- A public GitHub issue with the steps, so someone outside the team can try to reproduce it.
- Stellar Wallets Kit, so people who already have a wallet can sign with it. This week we tested that it is viable on testnet.
- What we learned at the focus group, without participants’ names.
- We will also invite people to form the three organizer–contributor pairs for the Week 4 mainnet pilot.

### Links

- Focus group: https://luma.com/mt0nzpct

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

- Video: [Week 1 video, posted natively on X](https://x.com/andresanemic/status/2124207336428327045)
- X post: [https://x.com/andresanemic/status/2124207336428327045](https://x.com/andresanemic/status/2124207336428327045)
- Research essay: [The value of decentralized micro relationships](./docs/research/the-value-of-decentralized-micro-relationships.md), by Francisco Toro and Andrés Peña

Earlier kernel releases (v0.0.1 to v0.1.8) are in [docs/KERNEL_CHANGELOG.md](./docs/KERNEL_CHANGELOG.md).
