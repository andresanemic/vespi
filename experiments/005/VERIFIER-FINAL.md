# RUN 05 — Independent verifier, final local report

Date: 2026-09-23. Scope: public repository at C:\Vespi. This report records the first verification and the second pass after the documentation correction. I did not read the private Cuaderno, use real credentials or funds, or edit any other repository file. I did not use experiments/005/RUN.md as proof.

## Verdict

- PASS: kernel test suite, reproducible offline dependency installation, declared dependency/import match, basic local server guards, corrected rejection-path documentation, local and remote v0.1.1 tag/release consistency, and diff whitespace check.
- NOT VERIFIED: live 402 response, settlement, and blockchain verification in this environment. The facilitator could not be reached in the first local probe; no funded testnet account or credential was used.
- The first pass found one false public claim about the rejection path. The second pass confirmed the correction by rerunning the same no-server case. No remaining blocking public-claim mismatch was found in the checked surface.

## First pass: direct checks and original finding

| Check | Command or inspection | Result |
| --- | --- | --- |
| Kernel | From C:\Vespi: 'node --version'; 'node --test' | PASS. Node v24.15.0; 16 tests, 16 pass, 0 fail. |
| Diff whitespace | 'git diff --check' | PASS, exit 0. Git printed LF-to-CRLF warnings, not diff errors. |
| Dependency lock | Compare demo/x402/package.json dependencies with package-lock.json root dependencies using Node | PASS: six declarations match: @stellar/stellar-sdk, @x402/core, @x402/express, @x402/fetch, @x402/stellar, express. |
| Import boundary | rg search for import and require across src, test and demo/x402, plus source inspection | PASS: the kernel uses only local CommonJS modules; tests use node: built-ins and local modules; external demo imports are declared. |
| Fresh install | Copy package.json and package-lock.json to a unique directory under %TEMP%; run 'npm ci --offline --prefix <temp> --ignore-scripts --no-audit --no-fund'; then 'npm ls --prefix <temp> --depth=0' | PASS: npm ci exit 0, 168 packages added; npm ls exit 0 and all six direct dependencies present at their lockfile versions. This checks installability without writing to the repo. Because scripts were disabled, it does not certify arbitrary package lifecycle scripts. |
| Local endpoint guards | Run a copy of server.js from that temp install, hidden background Node process; HTTP GET without BORA_PAY_TO, then with a synthetic public address and unknown service | PASS: 503 JSON 'BORA_PAY_TO missing. Refusing to serve.'; 400 JSON 'Unknown service'. No secret, funds or payment. |
| Local paid route | HTTP GET /api/agent-service?service=marketing-plan on the same copied server with synthetic payTo | NOT VERIFIED: HTTP 500. stderr: 'Failed to fetch supported kinds from facilitator: TypeError: fetch failed' and 'Failed to initialize: no supported payment kinds loaded from any facilitator'; nested EACCES. This is a network limitation of this run, not proof the route is broken. |
| Original rejection claim | Read README.md:31, README_es.md:31 and demo/x402/README.md:48, then run the no-server rejection case below | FAIL in first pass: all three then said rejection also needed an initial 402. The runner instead stopped before contacting the endpoint. |

First-pass rejection repro, from C:\Vespi\demo\x402 (PowerShell; fake values only):

    $env:CLIENT_SECRET = 'S_FAKE_NO_CREDENTIAL'
    $env:BORA_PAY_TO_EXPECTED = 'G_FAKE_NO_ACCOUNT'
    $env:SERVICE_BASE_URL = 'http://127.0.0.1:39059/api/agent-service'
    'n' | node run.js --max-usdc=0

There was no listener on port 39059. The command exited 0 and printed status 'needs_human_decision', authority.exercised [], approval 'human_gate_rejected', evidence null, verification null. Source flow in src/operation.js checks authority and returns on rejection before capability.perform(); capability.js makes the initial fetch only inside perform(). The original claim was therefore false. The first pass did not edit it.

## Second pass after correction

| Check | Command or inspection | Result |
| --- | --- | --- |
| Corrected claim | 'rg -n "rejection path|ruta de rechazo|402" README.md README_es.md demo/x402/README.md'; inspect diff and source | PASS. README.md:31 and README_es.md:31 now say the rejection can stop at the human gate before endpoint contact and the paid route needs the 402. demo/x402/README.md:48 now says the same. |
| Same no-server repro | Run the four PowerShell lines above again; clear the three environment variables afterward | PASS: exit 0; status 'needs_human_decision', exercised [], approval 'human_gate_rejected', evidence null, verification null. No server, credential or payment. |
| Kernel | 'node --version'; 'node --test' from repo root | PASS: Node v24.15.0; 16/16, zero failures (duration 166 ms). |
| Diff whitespace | 'git diff --check' | PASS: exit 0, only LF-to-CRLF warnings. |
| Version text | Inspect README.md, README_es.md, CHANGELOG.md and 'git log -1 --format=%h %s v0.1.1-kernel^{}' | PASS: both READMEs link and badge v0.1.1-kernel and state 16/16 at release; CHANGELOG has v0.1.1-kernel and a separate Unreleased RUN 05 section. Local annotated tag dereferences to 32493e0, current HEAD. Earlier v0.1.0 entries are historical. |
| Remote tag | With read-only network escalation: 'git ls-remote origin refs/tags/v0.1.1-kernel*' | PASS, independently corroborated: tag object 3f38ddb4d113f32ba6502e2b1464e7f3fa3a0ec4; dereferenced commit 32493e00b592c854ebe844a7bd98e036624f29e9. The first-pass sandboxed ls-remote had failed to connect, so this is a new second-pass verification. |
| GitHub release | With read-only network escalation: 'gh release view v0.1.1-kernel --repo andresanemic/vespi --json tagName,publishedAt,url,isDraft,isPrerelease,targetCommitish' | PASS, independently corroborated: tagName v0.1.1-kernel, publishedAt 2026-09-23T17:26:43Z, isDraft false, isPrerelease false, targetCommitish master, URL https://github.com/andresanemic/vespi/releases/tag/v0.1.1-kernel. |

## Public surface and boundaries

- The documented commands and routes exist: 'node --test' at the root; demo/x402 scripts 'demo' and 'server'; npm ci installs the lockfile; server.js serves /api/agent-service and accepts PORT/BORA_PAY_TO; run.js accepts --max-usdc and environment settings. The shell examples in demo/x402/README.md are POSIX shell examples.
- The kernel's zero-dependency and authority-gate claims are supported by direct source inspection and the 16 tests. The no-server run independently demonstrates the rejection path without side effect.
- The live-paid path described in the README requires a facilitator, network access, a valid testnet payer and receiver, and funds. These were deliberately absent. The claim that it returns a verified receipt for a fresh paid run is NOT VERIFIED here.
- experiments/002-x402-slice1/receipt-success.json contains a public settlement transaction hash, claimed verification checks and a local provenance path. I inspected the receipt as an artifact but did not independently query the Stellar chain, so its transfer and 0.01 USDC claim remain NOT VERIFIED by this verifier. The appended provenance note in experiments/002-x402-slice1/RUN.md does not change that receipt.
- The v0.1.1 remote release is verified; RUN 05 itself is marked local/unreleased in CHANGELOG. The README direction (user profiles, model economy, longer autonomous work) is explicitly labeled as direction rather than current capability.

## Working tree and RUN 05 inventory

At the start of the first pass, experiments/005 had PROTOCOL.md, BLIND-CHECK.md and RUN.md. BLIND-READ-FINAL.md appeared during that pass. At the start of the second pass, those four files were present, all untracked; this report is the fifth file being added on explicit request. None was treated as independent execution proof.

Before writing this report, 'git status --porcelain=v1 --untracked-files=all' showed eight modified tracked files: CHANGELOG.md, README.md, README_es.md, demo/x402/README.md, demo/x402/package-lock.json, demo/x402/package.json, demo/x402/run.js, experiments/002-x402-slice1/RUN.md. Untracked: demo/x402/server.js and the four RUN 05 files named above. Git also warned that it could not read C:\Users\andre\.config\git\ignore; this did not block status or tests.

## Final boundary

No code or documentation outside this verifier report was changed by me. I did not certify a fresh paid testnet run, facilitator availability, chain settlement, the private Cuaderno, or the methodological conclusions in experiments/005/RUN.md. If closure files change after this report, rerun the relevant checks against that final state.





## Addendum — independent pre-signature authority audit (2026-09-23)

**Closure verdict superseded: BLOCKED.** The earlier PASS findings remain valid for their stated checks, but the public bounded-authority claim for the live x402 payment path is materially unsupported by the current adapter. This finding came from a new read-only audit prompted after the second verification; it does not assert an improper payment occurred in RUN 002.

### Direct flow

1. demo/x402/capability.js declares in required() one static spend requirement: testnet USDC, amount 100000 atomic (0.01 USDC), and the configured payTo.
2. src/operation.js calls sufficient() against that static requirement before perform(). demo/x402/run.js provides a default maxAmount of 0.05 USDC (500000 atomic) and passes the operation authority to perform(), but capability.perform() does not inspect that authority.
3. capability.perform() reads the server's PAYMENT-REQUIRED header and immediately calls client.createPaymentPayload(pr), with no comparison of the selected 402 amount, asset, network or payTo to required() or the operation grant.
4. Installed @x402/core 2.27.0 selects an accepted requirement and applies its own default spendControls cap of $1 per payment for a default asset. This is a real partial guard, but it is above the runner's 0.05 USDC grant; it does not bind payTo to Vespi's configured recipient. Registration for 'stellar:*' admits both Stellar testnet and pubnet at the core-selection stage. Default-asset controls exclude non-default assets absent opt-in; this limits, but does not close, the amount/destination gap.
5. Installed @x402/stellar 2.27.0 ExactStellarScheme validates positive amount, exact scheme, Stellar network and address shapes, then builds the transfer from the selected 402 asset, payTo and amount and calls signAuthEntries. Its input validation does not compare these fields to Vespi's static requirement or grant.
6. run.js verifies after the paid request, querying testnet settlement and finding a USDC transfer to expected PAY_TO with amount >= 0.01. It does not enforce <= authorized max. A same-recipient 0.50 USDC transfer that settled would satisfy that amount predicate and could be reported 'verified'; a changed-recipient transfer would be rejected only after the attempted side effect.

### Offline reproduction, no key, signer or funds

From C:\Vespi\demo\x402, a Node stdin script imported the installed x402Client and findDefaultAsset, registered a fake exact scheme that records inputs and returns 'NO_SIGNATURE', and supplied a synthetic v2 PaymentRequired with testnet USDC amount 5000000 (0.50 USDC). The real core selector accepted it and passed it to the fake scheme. Output with the expected recipient: '{"acceptedAmount":"5000000","expectedPayTo":true,"exceedsRunnerGrant":true,"exceedsDeclaredRequirement":true}'. A second variant with another valid public payTo also reached the scheme. Amount 20000000 (2 USDC) was rejected by the library's default $1 cap. Calling the real ExactStellarScheme.validateCreateAndSignPaymentInput on the 0.50 USDC/other-recipient requirement returned successfully, without signing or network access.

Relevant local source: demo/x402/capability.js (required, createPaymentPayload); demo/x402/run.js (MAX_USDC, verification hit); src/operation.js (static check before perform); node_modules/@x402/core/dist/esm/client/index.mjs (DEFAULT_MAX_AMOUNT_PER_PAYMENT, selectPaymentRequirements, applySpendControls, createPaymentPayload); node_modules/@x402/stellar/dist/esm/chunk-EGJCLWK3.mjs (selected-field transfer construction and signAuthEntries).

### Boundary and closure action

This proves missing pre-signature enforcement of Vespi's own amount and recipient bounds in the checked code path, and demonstrates that the installed library's default controls accept a requirement above the declared grant. It does not prove a successful on-chain overpayment: no real key was created or used, no RPC simulation, signing, facilitator settlement or chain transfer ran. Pubnet selection also passed core filtering, but actual pubnet signing may fail because the demo signer is initialized with the testnet passphrase and RPC_URL defaults to testnet; the blocking case needs only testnet USDC and the expected recipient.

Block closure of RUN 05 as a trustworthy bounded-payment demonstration until the selected 402 requirement is checked against the actual operation grant and expected asset, network, amount and payTo **before** invoking createPaymentPayload/signing, with a local adversarial check. Post-payment verification alone cannot make the authority boundary preventive.
