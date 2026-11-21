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

- Video: [Week 1 video, posted natively on X](https://x.com/andresanemic/status/2124207336428327045)
- X post: [https://x.com/andresanemic/status/2124207336428327045](https://x.com/andresanemic/status/2124207336428327045)
- Research essay: [The value of decentralized micro relationships](./docs/research/the-value-of-decentralized-micro-relationships.md), by Francisco Toro and Andrés Peña

Earlier kernel releases (v0.0.1 to v0.1.8) are in [docs/KERNEL_CHANGELOG.md](./docs/KERNEL_CHANGELOG.md).
