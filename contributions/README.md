# Vespi Contributions

Record a meeting, a talk, or help someone gave. Add what each person contributed, send an invitation, and share a receipt after they confirm. The November 2026 pilot runs on Stellar testnet. [Open the live app](https://vespi.xyz/app).

This directory is the Week 1 snapshot of the deployed Contributions app, including the browser interface, API routes, and receipt verification code. The root layout and redirects let this snapshot run independently of the Vespi public site. The public site serves the original event slides.

## Run locally

Use Node.js 26.13.0 or a compatible release.

```sh
npm ci
npm run test:contributions
npm run build
npm start
```

Open `http://localhost:3000/app`. The interface and tests run without production credentials. For a separate testnet deployment that can create accounts, issue invitations and anchor receipts, configure the following on the server.

| Purpose | Configuration |
| --- | --- |
| Stellar testnet sponsorship and fee bumps | `CONTRIB_SPONSOR_SECRET`, `CONTRIB_CHANNEL_SECRETS` (comma-separated testnet channel keys), sponsor limits and expiry defined in `src/lib/contributions/sponsor-policy.ts` |
| Sessions and authorization tokens | `CONTRIB_TOKEN_KEY`, a fresh server-side secret |
| Profiles, encounters, receipts and survey | `CONTRIB_KV_REST_API_URL` and `CONTRIB_KV_REST_API_TOKEN` for Redis REST storage |
| Photo attachments | `BLOB_READ_WRITE_TOKEN` for a private Vercel Blob store |
| Tellus speaker and attendance | `CONTRIB_YERKO_ROOT` (the organizer's signed request digest), `CONTRIB_YERKO_ACCOUNT` (the designated speaker's public Stellar testnet account), and optional `CONTRIB_YERKO_CLOSED` |
| Tellus survey and team reporting | Optional controls in `src/lib/contributions/survey-intake.ts` and `src/lib/contributions/team-survey.ts` |

Keep the signing and storage credentials server-side. A passkey authorizes signing in the participant's browser. Sponsorship covers testnet reserves and fees. Stellar anchors a digest so someone can check the receipt and its signing account. The receipt records what the signer attested.

The kernel copy has [pinned provenance](src/lib/contributions/kernel/SOURCE.md). [Week 1 changelog](../CHANGELOG.md#instawards-chile--week-1) · [Week 1 release](https://github.com/andresanemic/vespi/releases/tag/instawards-2026-week-1)
