# Demo: make a real Stellar payment yourself, behind the human gate

One command, no account and no configuration. It creates two fresh Stellar **testnet** accounts, funds them with Friendbot (free test XLM, no real money), and asks the Vespi kernel to pay 1 XLM from one to the other.

```sh
cd demo/testnet
npm ci
node pay.cjs
```

What you will see:

1. **No authority to spend.** The operation starts with `authority: { spend: [] }`, so the kernel stops and opens the human gate.
2. **You approve one exact transaction.** The transaction is built before the question. Its hash is the operation's context, so the gate shows you that hash and the kernel's approval-request digest. Your answer must echo that digest, or the kernel treats it as stale.
3. **No yes, no signature.** The capability signs only inside `perform`, after the gate opens. Answer `n` and the receipt says `needs_human_decision`: nothing was signed and nothing was sent.
4. **The kernel re-checks before the effect.** Right before signing, the kernel reads the context again; if the transaction changed after your yes, it blocks.
5. **The ledger decides.** After submitting, the kernel reads the transaction on Horizon testnet and checks that it succeeded, that it is the exact transaction you approved (`approvedTxOnLedger`), and that it pays the approved amount of native XLM to the approved account. The receipt lists what it covered and what it did not (`external anchor`), and the command prints the stellar.expert link.

Non-interactive: `node pay.cjs --yes` or `node pay.cjs --no`. Another amount: `node pay.cjs --amount=2.5`. Each run saves its receipt in `out/` (ignored by git).

## The same flow on Stellar mainnet

`node pay.cjs --network=mainnet` runs the same flow with your own account: the secret key comes from `STELLAR_SECRET` or a hidden prompt and is never printed or saved; the amount defaults to 0.0001 XLM and is capped at 0.01 XLM; `--yes` is refused, so the gate is always answered by hand; the account must hold the amount above its reserve. On 26 October 2026 a person ran it with the team's LOBSTR account and answered yes: tx [`b402c623…d98f`](https://stellar.expert/explorer/public/tx/b402c62307e0c50fb859969a21a8e1277ed1c29899b19f79ee6f557f9a93d98f) (`b402c62307e0c50fb859969a21a8e1277ed1c29899b19f79ee6f557f9a93d98f`), ledger 65139109, 0.0001 XLM to the Pollar wallet, receipt `verified` with `approvedTxOnLedger` (`receipts/mainnet-receipt-b402c62307e0c50f.json`). Here the kernel signed after the yes: prevention on mainnet, not only detection.

## Re-verify the real mainnet transactions (read-only, no install)

From the repository root:

```sh
node demo/testnet/pay.cjs --verify-mainnet
```

It reads Stellar mainnet through Horizon and checks the three real transactions of 25–26 October 2026: the kernel-signed payment above, the 0.0001 XLM payment made with Pollar under the kernel's human gate (tx `52759df5db949d6bd9b506de0081f7bddb5254bb374de8f682b5a1e507e37bb2`, six checks) and the anchor of a Vespi receipt (tx `2ff744c69fc01c0de2016e45c5f157b0434382572f2dfc997e8e1d4e34af09d7`: the receipt digest as a hash memo and as a `manage_data` entry). It re-reads the ledger; it does not replay the approval or the payment.

## Evidence and tests

- `receipts/testnet-receipt-0e7be64d438bae71.json` — a real run of this demo on 26 October 2026: tx [`0e7be64d…88b7`](https://stellar.expert/explorer/testnet/tx/0e7be64d438bae713528de7d3e18ca628de8a522d50846f54fccc752462d88b7), receipt `verified` with seven checks.
- `npm test` (or `node --test demo/testnet/testnet.test.cjs` from the root, no install needed) runs eight offline tests: an approved exact transaction is verified and signed once; a decline signs nothing; an approval that does not echo the approval request signs nothing; a transaction changed after the yes is blocked before signing; a ledger showing another transaction or another amount is not verified; and the mainnet re-verification reads the recorded payment and anchor.

## Limits

This is a demo outside the kernel library: the Stellar SDK and the signing key live here, not in `src/`. The default flow uses testnet; the explicit `--network=mainnet` mode spends real XLM from the account provided by the operator, with an interactive approval and a 0.01 XLM cap. The approval is a terminal answer bound to the transaction hash through the kernel's approval-request digest; it is not a hardware signature by the person.
