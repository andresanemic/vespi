# Demo: x402 capability behind the kernel boundary

Runs ONE real operation (`compose-launch-brief`) on kernel code from `../../src`
(zero dependencies there; this folder holds the x402/Stellar adapter + runner).

```sh
cd demo/x402 && npm install
# Terminal 1: paid endpoint (needs BORA_PAY_TO set to a USDC-trustline testnet account)
# Terminal 2:
CLIENT_SECRET=S... BORA_PAY_TO_EXPECTED=G... SERVICE_BASE_URL=http://localhost:3777/api/agent-service \
  node run.js --max-usdc=0     # Case A: gate fires, decline -> needs_human_decision, nothing moves
CLIENT_SECRET=S... BORA_PAY_TO_EXPECTED=G... SERVICE_BASE_URL=http://localhost:3777/api/agent-service \
  node run.js --max-usdc=0.05  # Case B: grant covers 0.01 -> pays testnet USDC -> verified receipt
```

Same operation, different authority. Secrets live in env only, never in files (this folder
contains no keys). Demo accounts on testnet are temporary and labeled in receipts.
