# Sandbox: a simulated role paying contributions on Stellar testnet

Proof of concept, built for an application deadline. It shows one thing: **a person grants authority once; an agent role operates inside it; the kernel allows or blocks every step before any effect; each payment leaves a receipt whose SHA-256 digest is in the memo of the transaction, and anyone can re-check the lot against the public ledger.**

What is simulated, said plainly: the **role** (`role/contributor-payments-sim`, marked `simulated` and named as such inside every receipt), the **person** who grants authority (a config file), and the **scenario** (Permamuseum-style contributors paid for approved contributions). What is real: the kernel decisions, the receipts and their digests, and the transactions on Stellar **testnet** (test XLM from Friendbot, no value). Mainnet is never touched; the code only knows the testnet Horizon URL and passphrase.

## Reproduce from a clean clone

Needs Node 24 (the repository tests fail on Node 26).

```sh
git clone --branch poc/instawards-sandbox https://github.com/andresanemic/vespi.git   # or the local clone
cd vespi
npm --prefix demo/sandbox ci
node --test demo/sandbox/sandbox.test.cjs        # offline, 9 tests, no network
node demo/sandbox/verify.cjs --offline           # re-checks the committed run from its saved Horizon snapshot
node demo/sandbox/verify.cjs                     # re-reads Horizon testnet NOW (fails if testnet was reset)
node demo/sandbox/run.cjs --out=/tmp/my-run      # a NEW run: fresh accounts, ~80 s, 7 payments + 7 blocked
node demo/sandbox/verify.cjs --evidence=/tmp/my-run
```

`run.cjs` without `--out` overwrites `evidence/` (the committed run).

## Files

| Path | What |
|---|---|
| `role/contributor-payments.role.json` | The simulated role: name, objective, limits |
| `config/run.config.json` | The person's one-time concession (budget, destinations, validity) and the scenario steps |
| `lib/sandbox.cjs` | Wiring to the kernel (`src/`, untouched): concession, derived authority, receipt, anchor |
| `lib/stellar.cjs` | Testnet adapter and Friendbot funding. Secret keys exist only in memory |
| `run.cjs` | The runner |
| `verify.cjs` | The verifier (extends the `--verify-mainnet` pattern to testnet) |
| `evidence/` | `run.json`, `receipts/*.json` (14), `horizon-snapshot.json`, `verification.json` |

## How it works

1. The concession (3 XLM, two listed destinations, expiry 60 min after the run starts) becomes one kernel spend grant per destination.
2. For each step the runner derives the authority the role holds right now: the concession with the ceiling lowered to the remaining budget. `attenuates()` proves the derived authority never exceeds the concession.
3. `runOperation` checks the requirement with `sufficient()`. Inside the grant: the kernel issues an authorization receipt. Outside it: `needs_human_decision`, nobody is at the gate, the gate answers no, nothing happens, and the receipt records why (the kernel's own reason).
4. For an authorized step the payment is made as the kernel's **anchor** step (`anchorReceiptAsync`): a native XLM payment whose memo (`MEMO_HASH`) is the receipt digest. The kernel then reads the transaction back; `receipt.anchor` is `anchored` with the transaction hash.
5. The verifier recomputes each digest from the published receipt, compares it with the memo and payment on Horizon, checks the payer, destination, amount and that the ledger holds exactly the payments the receipts account for. It saves what Horizon answered in `evidence/horizon-snapshot.json` because testnet can be reset.

Blocked attempts in the committed run: over the remaining budget, far over the budget, two destinations not on the list, two with an expired authority (a stale concession, real clock), one asset never granted.

## Limits (read these)

- **The receipt is an authorization receipt, not a settlement receipt.** The digest has to be in the transaction, so the receipt cannot contain the transaction hash. The hash lives in `receipt.anchor`, which the kernel keeps outside the digest. Settlement is proven by the verifier, not by the receipt (`ledger_settlement` is listed as not covered).
- **The budget across destinations is tracked by the runner, not by the kernel**, whose ceilings are per operation. The kernel enforces the derived ceiling; the runner is trusted to derive it.
- The digest is unkeyed: it shows the receipt was not edited, not who wrote it. Whoever controls the files and the key can write a consistent set.
- The role is simulated and unattended; the "person" is a config file, not a signature. No identity, no hardware approval.
- Testnet only. One payer, one role, one run of 14 steps. Testnet can reset; the snapshot is the surviving evidence of what Horizon said.
- The kernel in `src/` and the files that pin the release manifest were not modified.
