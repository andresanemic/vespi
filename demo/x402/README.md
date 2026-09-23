# Demo: x402 capability behind the kernel boundary

Runs one operation (`obtain-marketing-plan`) on kernel code from `../../src`
(zero dependencies there; this folder holds the x402/Stellar adapter + runner). It obtains a verified plan; this runner does not write a brief.

```sh
cd demo/x402 && npm ci
# Terminal 1: reference paid endpoint (needs BORA_PAY_TO set to a USDC-trustline testnet account)
BORA_PAY_TO=G... npm run server
# Terminal 2:
CLIENT_SECRET=S... BORA_PAY_TO_EXPECTED=G... SERVICE_BASE_URL=http://localhost:3777/api/agent-service \
  node run.js --max-usdc=0     # Case A: gate fires, decline -> needs_human_decision, nothing moves
CLIENT_SECRET=S... BORA_PAY_TO_EXPECTED=G... SERVICE_BASE_URL=http://localhost:3777/api/agent-service \
  node run.js --max-usdc=0.05  # Case B: grant covers 0.01 -> pays testnet USDC -> verified receipt
```

After npm ci, run the offline pre-signature adversarial check with `node --test capability.adversarial.mjs`. It uses an ephemeral unfunded key and intercepts payload creation; it does not sign or settle.

The endpoint code (`server.js`) lives here; no BORA checkout is needed.
The live path still needs testnet funds, credentials and facilitator access.

Same operation, different authority. Secrets live in env only, never in files (this folder
contains no keys). Demo accounts on testnet are temporary and labeled in receipts.

## The causal thesis (what this proves and what it does not)

Without the authorized payment, the capability does not exist for the operation:
the 402 carries no plan, and the runner cannot finalize without one. After settlement,
the operation can do something it could not do before. The point is not "Vespi can
pay USDC" — it is that Vespi continues an operation through a paid external capability
while keeping the economic side effect inside explicit authority, with verifiable evidence.

## Live prerequisites (testnet only, never mainnet)

- Node 24; `npm ci` in this folder.
- A Stellar testnet account with XLM (friendbot) + USDC trustline + ~0.02 testnet USDC
  (public Circle faucet; no account needed).
- A receiver testnet account with USDC trustline (any address you control for the demo).
- Env: `CLIENT_SECRET` (payer S... key), `BORA_PAY_TO_EXPECTED` (receiver G...),
  `SERVICE_BASE_URL` (local endpoint or deployed URL).
- A running paid endpoint: the reference server used here responds 402 with an official
  x402 v2 header and releases `marketing-plan` only after settlement.

## Expected output and verification

- Case A prints `needs_human_decision` with empty `exercised` and no transaction.
- Case B prints a `verified` receipt with `evidence.txHash`; check it at
  `https://stellar.expert/explorer/testnet/tx/<hash>` (successful + 0.01 USDC transfer).
- If the facilitator, faucet or network is down, the demo may fail before a receipt;
  `DEMO_FAIL` makes runner errors visible. Gate rejection can happen without contacting the endpoint. Once a 402 arrives, the adapter filters its offers before payload creation: exact 0.01 USDC on Stellar testnet, configured recipient, supported scheme and signing window, all covered by the operation grant. Out-of-bound offers return a failed receipt without signing; a later verifier checks the result but cannot authorize it. The paid path needs an initial 402.
