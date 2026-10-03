[![Vespiqueen genesis](./assets/vespiqueen-genesis.png)](./assets/vespiqueen-genesis.png)

# Vespi

<p align="center">
  <a href="#english"><img src="https://img.shields.io/badge/version-v0.1.3-D7B698?style=for-the-badge&labelColor=07111A" alt="Version: v0.1.3"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-D7B698?style=for-the-badge&labelColor=07111A" alt="License: Apache 2.0"></a>
  <a href="#the-functional-projects"><img src="https://img.shields.io/badge/projects-10_functional-D7B698?style=for-the-badge&labelColor=07111A" alt="Functional projects: 10"></a>
  <a href="./docs/TESTNET_EVIDENCE.md"><img src="https://img.shields.io/badge/testnet_transactions-50_verified-E0C170?style=for-the-badge&labelColor=07111A" alt="50 successful transactions on Stellar testnet"></a>
  <a href="./demo/x402/"><img src="https://img.shields.io/badge/built_with-Stellar_%C2%B7_x402_%C2%B7_Raven_MCP-E0C170?style=for-the-badge&labelColor=07111A" alt="Built with Stellar, x402 and Raven MCP"></a>
</p>

<p align="center">
  <b>Vespi is the kernel that lets you build great apps without having to know the hardest parts of AI.</b><br><br>
  It already integrates x402 and Stellar, and it gives you an authority a person grants, a receipt anyone can check, and an operation another agent can pick up tomorrow.<br>
  <br>
  <a href="https://github.com/andresanemic/lore-plugin">Lore Plugin</a> prepares the ground. Vespi operates on it.
</p>

<p align="center">
  <b>Do you build on Stellar? This is for you.</b><br>
  The idea is that Lore, the operating system whose kernel is Vespi, becomes the definitive operating system of the Stellar ecosystem: a way to create apps on Stellar together with Raven MCP, quickly, reliably and securely.<br>
  I invite every builder in the Stellar ecosystem to review this kernel and to use it if it helps you.
</p>





---

<details>
<summary><b>Read in English</b></summary>

<a id="english"></a>

**Vespi keeps an operation alive when the people, the agents and the tools around it change.**

> **The unit is not the agent. The unit is the operation.**

Vespi is the kernel of Lore's operating system for working with AI, and it lets you build complex applications without having to know how it is done. The goal behind it is that Lore becomes the definitive operating system, worldwide, for working and building with AI. [Lore Plugin](https://github.com/andresanemic/lore-plugin) prepares the ground — criterion, Lore, the coordinator's method — and Vespi operates on it, running the hard parts for you: loops until the work is done, test-first development, blind readers who judge the result without seeing how it was made, and a check by someone other than whoever did the work.

You say what you want; Vespi keeps the operation standing under an authority a person grants and leaves a receipt whose digest anyone can recompute to check integrity. The kernel was built in part with Raven MCP (the MCP over the Stellar ecosystem's project directory), and this repository is the **kernel**: dependency-free JavaScript, no framework, no daemon, no network. Before `1.0` its versions are public snapshots, not a stable protocol.

**Why.** Building with AI should not require being an expert in AI. Today an agent tells you "done" and you have to take its word for it, so only people who can audit the work can trust it. We want anyone with an idea to build real software, feel capable, and be able to check what was done. Vespi does the hard parts so the person does not have to know them.

**If you are judging Find Your Way or Meridian, start here.**

1. **What it is.** The kernel of Lore's operating system for working with AI: an authority a person grants, a receipt anyone can check, and an operation another agent can pick up tomorrow.
2. **Why it belongs on Stellar.** A live x402 payment of 0.01 USDC on Stellar testnet came back `verified`, and [Horizon confirms the transaction](https://horizon-testnet.stellar.org/transactions/abb968e86d8997f6f555c4efe50dd5a70671dc5064b8220a7f2ea221de7650d5) separately. Receipts can be anchored on Stellar, and TEMIS, the first real operation, anchors its records there and was rebuilt by a third party from the public history alone. In all, [50 successful testnet transactions from 8 accounts](./docs/TESTNET_EVIDENCE.md), read back from Horizon, back the project: a full agreement lifecycle run twice, concurrent anchors, an idempotent payment and the x402 runs.
3. **Check it yourself, offline.** `node --test test/*.test.js` runs 205 tests with no wallet and no network. The live receipt is [in the repository](./demo/x402/receipts/live-testnet-2026-10-02.json). With a network, `node scripts/verify-testnet-evidence.mjs` asks Horizon about every transaction listed in the evidence file.
4. **See what is built on it.** Ten functional projects, each with its agreement written before its code, run on fictional data. Several will be open for review during the judging period. The table is in the section below.
5. **What we do not claim.** No mainnet, no second provider, no production readiness. It is listed under *Not verified*.


## In one minute

When you work with an agent, the session ends and the next one has to begin. What usually survives is a summary, and a summary does not say **who allowed this**, **how much**, **until when**, **to whom**, or **whether it actually happened**. Those are not details of a summary; they are the operation.

So Vespi starts from the operation. It carries a goal and an authority a person granted it (with a clock, a budget and a destination). The kernel permits at most one execution per operation and process; an uncertain result is `not_verified` and is never retried blindly. Verification stays **separate**, and the receipt says what was covered and what was not. When something changes, the operation is read back from its receipts and continues only if the next action still matches the agreement; otherwise it goes back to the person.

```bash
git clone https://github.com/andresanemic/vespi.git
cd vespi
node --test test/*.test.js     # ℹ tests 205 · ℹ pass 205 · ℹ fail 0
node scripts/verify-testnet-evidence.mjs   # re-checks the 50 testnet transactions against Horizon (needs a network)
```

## Why Vespi, and not building it yourself

Writing an app is the easy part. What takes months, and usually gets skipped, is everything around the work: who may do what, up to when and for how much; proof of what happened; stopping honestly when an outcome is uncertain; resuming tomorrow where you stopped; a human decision where one is needed; and a check by someone who did not do the work. Vespi gives you those as a tested kernel, so each app does not reinvent them and the person with the idea does not have to be an expert in how they are done.

| You need | What Vespi gives you | Where it lives |
|---|---|---|
| Permission with limits | A grant with an asset, a ceiling, a destination and an expiry; one budget that cannot be spent twice; an expired grant is refused; several named people can be required | `authority`: `{ asset, maxAmount, to, expiresAt }`, `signers`, `pausers` |
| Proof of what happened | A receipt with a SHA-256 fingerprint, the checks that came back true, and what was not covered, by name | `buildReceipt`, `verifyReceipt`, `notCovered` |
| Honest stops | A task with no legitimate exit comes back blocked with its way out; an outcome of uncertain result is never retried blindly | `impossible`, `not_verified`, `resumeFromReceipts` |
| A human where one is needed | A gate that shows the cost first, never lets the agent consent for the person, and names the exit in every refusal | the human gate and its four gestures |
| Continuing tomorrow | Resuming from receipts: the last verified state, the next action, and whether a person must step in | `resumeFromReceipts(receipts, agreement)` |
| An independent check | The verifier is never the executor; blind readers judge without seeing how it was made; a third agent without code access rebuilds the result | [`docs/METHOD.md`](./docs/METHOD.md), [`experiments/`](./experiments/) |
| Public proof, if you want it | An anchor on Stellar that only counts when a verifier confirms the digest and the network | `anchorReceipt`: `pending` → `submitted` → `anchored` |

**With AI or without it, with a blockchain or without one.** The kernel does not care what your effect is. It is dependency-free JavaScript that talks to no network: the thing it supervises can be a database write, a call to another system, a step done by an AI agent or a payment, and authority, receipts, the human gate and continuity work the same way in every case. Stellar is an adapter, not a requirement: you can anchor a receipt on the network when something has to be publicly provable, or never touch a blockchain at all. x402 lives in one place, [`demo/x402/`](./demo/x402/), and nowhere else. That is why the same kernel can sit under an app that uses AI and Stellar and under one that uses neither.

**Designed with Chile's new laws in mind.** Vespi was designed thinking of the new Chilean laws on personal data protection (Law 21.719) and on the interoperability of clinical records (Law 21.668). In practice: authority is limited by purpose, amount and time, because a permission names who may act, on what, up to how much and until when; the authority can name who is allowed to pause and resume an operation; every access and every refusal leaves a readable receipt, so someone can see who asked for what and what was refused; receipts are built to carry fingerprints and named checks rather than the content itself; and the kernel stores nothing and calls no network, so each institution keeps its own systems of record. Two of the ten functional projects are proofs of concept of exactly this: **Llavero** (my data: who asks for it, for what, under which permission) and **Ficha Contigo** (the clinical record). This is design intent. It is not legal compliance, and no regulator or lawyer has certified it.

**Why institutions can pilot it.** The kernel was shaped so that an institution can try it without adopting a platform: it is a library under Apache 2.0, with no dependencies and no hosted service, so a pilot runs inside the institution's own environment and nothing has to be handed over; its permissions are the shape a compliance team asks about (who, what, how much, until when, who approved); and the proof of what happened is something the institution's own auditor can recompute. I hope to work soon with institutions from the public and the private world to create the apps they need to coordinate and work as a team. The functional projects are proofs of concept of exactly that kind of task.

**Where this is going.** The goal is for Lore to become the definitive operating system, worldwide, for working and building with AI, and for the Stellar ecosystem in particular: a way to create apps on Stellar, together with Raven MCP, quickly, reliably and securely.

**How to use it today.** The kernel is plain JavaScript: require it and wrap your effect. The Vespi skill comes inside [Lore Plugin](https://github.com/andresanemic/lore-plugin). Installing Vespi on its own as a first-party skill, without the rest of the Lore kit, is planned for the end of Find Your Way; it is not available yet.

## What Vespi is, seen from the outside: a method

A request becomes work you can check. When you ask an agent for something that is not trivial, the coordinator follows one loop, and Vespi makes each step something you can verify instead of something you are told: **classify the ask**, **define done** as a named observation, **gather evidence** from the primary source, **decide** (an outward act needs the person's own words), **act surgically**, **verify by observation** apart from whoever built it, and **report the outcome first**, with what was skipped. The loop is written once, for the whole system, in [`docs/METHOD.md`](./docs/METHOD.md).

| In the loop | In the operation |
|---|---|
| Done is a named observation | The operation declares its effect and what verification will observe |
| The outward-facing gate | Authority is proved before the border; the agent cannot answer the gate for the person |
| Verify apart from whoever built it | A verifier that is not the executor, and a receipt that lists what it covered and what it did not |
| Report the outcome first, with caveats | The receipt is the report: status, evidence, `coverage`, `notCovered` |
| A surprise returns to an earlier step | A material premise that falls opens revalidation before the operation continues |
| Stop after three failed cycles | An impossible task comes back `blocked` with its exit, not retried blindly |
| Resume from the checkpoint, not from a summary | Continuity by receipts: the last verified state, the next action, and whether a person must step in |

**What it looked like on a real operation.** The first operation the whole system ran was building TEMIS, a layer that makes the commitments of a bilateral agreement checkable by a third party (testnet, fictional data). An independent advisor model reviewed the design before it was fixed and found four holes. A cheaper worker model implemented it seeing only the tests. Verification, done apart, found eight more holes the worker's tests did not cover. A third agent, with no access to the code, rebuilt the whole record from the public Stellar history and reproduced all 22 outcomes.

## Vespi and Lore Plugin: an operating system for working with AI

```
  you        say what you want, in your own words
  ──────────────────────────────────────────────────────────────────────────
  hosts      Claude Code · Codex · OpenCode          where the agent runs
  ──────────────────────────────────────────────────────────────────────────
  Lore Plugin   the ground: your criterion (Lore), the routing that opens the
                right criterion for each task, the coordinator's method, and
                the hooks that keep a session honest
  ──────────────────────────────────────────────────────────────────────────
  Vespi         the kernel: operations under granted authority, verification
                apart from execution, receipts, continuity from the last
                verified state
  ──────────────────────────────────────────────────────────────────────────
  apps          what gets built on top: the functional projects below
```

You say what you want. The coordinator opens the criterion that governs it, defines what done will look like, and asks you only for what is yours to decide: authority, money, publishing. It hands bounded stretches of work to other models, each with its own question, its own limits and a receipt, verifies apart, and writes one checkpoint in the project's `FASES.md`. The next session resumes from the receipts, not from a summary. You never need to know the kernel exists.

**Where it stands.** The first experiments (RUN 01 to 05) were only the start: they were the tests that shaped the kernel, and the project has moved a long way since. Today there is a published kernel (`0.1.3`, with `0.1.4` prepared and not yet published), the Vespi skill inside Lore Plugin, the coordinator's method, ten functional projects built on it (nine with code and tests), and one real operation run end to end: TEMIS, whose agreement records are anchored on Stellar and were rebuilt by an independent third agent from Horizon alone (22 of 22 statuses). On Stellar testnet there are now [50 successful transactions from 8 accounts](./docs/TESTNET_EVIDENCE.md), including a live x402 payment through the real facilitator, concurrent anchors and an idempotent payment, and the repository carries a [study of how kernels, schedulers and durable-execution systems solved the same problems](./docs/PRIOR_ART.md). Lore Plugin `2.4.9` brings the flow into the kit: one checkpoint per project, tasks by role through the tools the host really exposes, and the economy of an operation declared before it runs. Next: the first applications for real users.

## What 0.1.3 brings

Published as [`v0.1.3-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.3-kernel) (previous: [`v0.1.2-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.2-kernel)). Everything below was read in the code, not in a plan. The kernel suite is **205/205** and the full run, including the x402 demo, **254/254**. At the release commits (`2dcfd92`, and again at `7dcec77`) they were 203/203 and 252/252; the two tests added since check the testnet evidence list.

<details>
<summary><b>The capabilities, one by one</b></summary>

- **Authority with clock, budget and destination.** A grant is `{ asset, maxAmount, to, expiresAt }`. A grant with `to` covers only that destination; without `to` it keeps **one** budget (400 + 400 against a 500 ceiling is not enough). An expired grant is refused with the moment it expired. In `runOperation`, `io.now` can supply the clock for checking expiry and issuing receipts.
- **Authority of several people.** `authority.signers = { required, allowed }`: the gate counts *distinct* named identities from `allowed`, never the operation's own agent, and never approvals pre-loaded into the authority. These are identities, not cryptographic signatures.
- **Receipts with a SHA-256 fingerprint and real coverage.** `verifyReceipt` recomputes the digest, so editing the status, evidence or coverage fails. **The fingerprint proves integrity, not authenticity.** A check counts as covered only when it came back `true`; anything else is listed in `notCovered` by name. The status is one of six values and is the same one the operation returns; unrecognized evidence fields are dropped.
- **Anchoring on Stellar, as an honest interface.** `anchorReceipt` climbs `pending` → `submitted` → `anchored` and skips none: `anchored` only when a verifier confirms the digest *and* the network (`stellar:testnet` or `stellar:pubnet`). A transaction hash alone is not an anchor. The verifier is told which network the anchor claims, because the network passphrase is part of what Stellar signs: an anchor on the testnet cannot be presented as one on mainnet. The kernel talks to no network; the adapter is the caller's, with a sync and an async path.
- **The impossible task comes back blocked, with its exit.** A capability can declare `{ impossible: true, reason }` from `required()`, and then `perform` is never called. Never retried blindly: running again returns the same receipt, and it names the way out.
- **Who can pause is written down.** `authority.pausers` is checked on `pauseOperation` and `resumeOperation`.
- **The human gate and its four gestures.** It opens when the authority on hand does not cover the requirement, and always when the authority declares `signers`. It shows the cost first, never lets the agent consent for the person (such an approval is refused and the operation returns to `needs_human_decision`), keeps what goes public off by default, and names the exit in every refusal. With no `ask` there is no approval, so the operation stops and asks; the receipt names who approved (`decidedBy`).
- **Continuity by receipts.** `resumeFromReceipts(receipts, agreement)` answers: the last verified state, the next action, and whether a person must step in. Receipts that do not verify are discarded and counted. Resuming what was agreed does **not** open the gate; three things do: a verified receipt for an action outside the agreement, a change to the scope, amount, ceiling or status of the next action, and a last receipt for the next action that was `blocked`, `paused` or `needs_human_decision`. There is no handoff document: any agent on any host continues from the receipts.
- **An optional decision model that only advises.** It may attach a suggestion to the gate above a threshold; it never approves.

</details>

## Evidence you can open

The newest record is the Stellar testnet evidence below. Underneath it are the first experiments that formed the kernel, in [`experiments/`](./experiments/): the first bodies and receipts, an Operator ↔ Professor loop with independent arbitration, an earlier x402 / Stellar testnet slice that kept one real verification failure as evidence, and the final RUN 05 evaluation, **closed** within its declared local, offline scope, with the blind reads and the verifier reports that closed it. Those runs were the first tests, not the latest work: the evidence below is what the kernel and the projects built on it have done since.

**A live x402 payment on Stellar testnet is verified for this release.** On 2026-10-02 the repaired adapter paid 0.01 USDC through the real facilitator, the receipt came back `verified`, and Horizon confirmed the transaction separately (`abb968e8…`, ledger 4988161). It is one of the 50 transactions below, on testnet, and its receipt still lists `external anchor` in `notCovered`: no mainnet, no second provider, no one else's run. The paid example lives in [`demo/x402/`](./demo/x402/), the only place that knows x402, Stellar or USDC.

**It was not one transaction.** Between 2026-10-02 and 2026-10-03 the work around Vespi wrote **50 successful testnet transactions** from 8 accounts to the Stellar testnet (ledgers 4987795 to 4996153), on fictional data and with no real money. Every hash is in [docs/TESTNET_EVIDENCE.md](./docs/TESTNET_EVIDENCE.md) and in a [machine-readable file](./docs/testnet-evidence.json), and `node scripts/verify-testnet-evidence.mjs` asks Horizon about each one (50 of 50 were successful when this was written).

| What was exercised on Stellar | Transactions | What it shows |
|---|---|---|
| Full agreement lifecycle of TEMIS (registration, signature and counter-signature, anchor, milestone, challenge, correction, dispute), run twice | 38 | Commitments written as ordered ledger transactions with their digest in a hash memo. A third agent with no access to the code rebuilt the record from Horizon history alone: 22 of 22 statuses matched, and it found a defect no test had seen. |
| Concurrent anchors, two processes, three rounds | 6 | Two writers racing from one account: the loser retries and the order by (ledger, index) stays deterministic. |
| Operation-type probe: a classic payment and a Soroban asset-contract transfer | 2 | Both emit the same `transfer` event, so an event alone does not prove how a payment was made. |
| Idempotent x402 payment | 1 | One call, one real credit, and a retried delivery was not charged twice. |
| x402 payment runs through the real facilitator | 3 | The first came back `not_verified` because of our own bug (we read the wrong field); the repaired adapter verified, and Horizon confirmed it separately. |

Two more findings came from testnet without a transaction: the facilitator rejects a muxed-account `payTo` at `/verify` (`invalid_exact_stellar_payload_event_wrong_to`), and a payload that was already settled is rejected when it is replayed at `/settle`. What this exercises on Stellar: classic payments, hash-memo anchoring, a Soroban asset-contract transfer, the x402 `exact` scheme through the real facilitator, concurrent writers, and read-back from Horizon. All of it is testnet, with one facilitator and one payer. Stellar resets the testnet a few times a year, so the receipts in this repository are the lasting record.

A second capability lives outside the kernel: [`capabilities/respaldo/`](./capabilities/respaldo/LEEME.md) copies a person's working tree into a folder that Drive, Dropbox or OneDrive already sync, never deletes, and verifies every hash. It does not encrypt, upload through APIs or keep versions yet. 17 tests.

## The functional projects

Vespi is a kernel, not an app. What shows it works is what gets built on it: ten projects, each with its **own agreement written before its code**, on **fictional data**. Their stage was read on **2026-10-02** by running each project's own suite against the kernel installed today (`0.1.3`).

**During the judging period of the Find Your Way hackathon, several of these projects will be released so their code can be reviewed.** Next week the repositories of the functional projects start going public, first without code, each explaining in detail the why, the how and the what: how it works, who takes part and with what rights, and what evidence it has. The code opens for review during the judging period under a license that lets you read and clone it to evaluate it, not modify it. The aim is to show how Vespi works, not only to tell it.

| # | Project | What it is | Stage today | Suite today |
|---|---|---|---|---|
| 1 | **Queen** | The marketing agency of the Stellar ecosystem: budgets inside the ceiling it was granted and charges through a **simulated** x402 layer. | Agreement + code + tests | 42 / 45 |
| 2 | **Permamuseum** | Latin American cultural heritage on Stellar, with provenance and permissions. | Idea: a study note, no code | — |
| 3 | **Casa Firme** | Housing for informal settlements: authority born in the committee's assembly; every donation leaves a trace. | Agreement + code + tests | 21 / 24 |
| 4 | **Ficha Contigo** | The clinical record: the institution uses only what the patient granted; emergency access is granted in advance. | Agreement + code + tests | 7 / 13 |
| 5 | **Cátedra** | The university: declared AI use, grades signed by the professor, degrees as verifiable credentials. | Agreement + code + tests | 34 / 35 |
| 6 | **Escribano** | A DAO with a legal record of every change to its contract (Wyoming W.S. 17-31). | Agreement + code + tests | 8 / 13 |
| 7 | **Llavero** | "My data": who asks for it, for what, under which permission, and what was refused. | Agreement + code + tests | 8 / 14 |
| 8 | **Farolero** | Authority for agents without code: delegating only narrows; what does not fit comes back blocked. | Agreement + code + tests | 8 / 13 |
| 9 | **Marea** | Verifying climate commitments between countries (Paris Agreement art. 6.2) without counting a reduction twice. | Agreement + code + tests | 25 / 25 |
| 10 | **Vela** | Protecting whoever tells the truth through a legal channel; the zero-knowledge membership proof is pending. | Agreement + code + tests | 10 / 11 |
| — | **TEMIS** | Legal validation for bilateral agreements by milestones: signed, counter-signed and anchored so a third party can rebuild what happened. The first real operation of Lore Plugin and Vespi as one. | Whitepaper + MVP: tests 0 to 8 run on Stellar testnet with fictional data (a full lifecycle run twice, 38 transactions, plus concurrent anchors and an idempotent x402 payment); owner's certificate and legal review pending | 135 / 135 |

**How to read the last column.** Nine of the ten were built on 2026-09-29 against the kernel cut `54c20c7` and their own records report them green there; that was not re-run here. Each pins the kernel it consumes by digest and fails on purpose when the kernel moves, so against `0.1.3` part of every suite fails until it is re-pinned. That re-pinning is pending, and so is any claim that these ten are ready: today they show a working path, not a finished product.

## How this was built

A claim without a receipt does not go in. These are the reviews that formed Vespi:

<details>
<summary><b>The reviews and sources that formed Vespi</b></summary>

- **Discipline: how it is verified.** Tests first, someone else verifying, attacks written as tests, and a security review with Anthropic's method that found a real flaw in our own kit and was fixed test first. What is simulated so far (the superreview) and what comes next are listed with their limits in [`docs/VERIFICATION.md`](./docs/VERIFICATION.md).
- **Raven and the Stellar ecosystem.** Raven, the MCP over the ecosystem's project directory, was active during the whole construction: without it x402 and Stellar would not have been possible, and the study it enabled showed that the missing piece was a kernel to coordinate the projects that exist, not another payment project.
- **The Fable Method.** The coordinator's loop is Vespi's own wording of [The Fable Method](https://github.com/Sahir619/fable-method) by Sahir619 (MIT), distilled so that it depends on no installed skill: see [`docs/METHOD.md`](./docs/METHOD.md).
- **Prior art.** [`docs/PRIOR_ART.md`](./docs/PRIOR_ART.md) summarizes the technical comparisons and their limits.
- **The OpenAI report.** [OpenAI — Hugging Face Incident, Technical Report](https://cdn.openai.com/pdf/67869394-cb91-4c12-888c-5cbd85c7814c/OpenAI-Hugging-Face%20Incident-Technical-Report.pdf): an operation is authorized before it acts, a task with no legitimate exit pushes an agent off the edge, and verification has to live outside the agent.
- **Ultrareview.** [Its documentation](https://code.claude.com/docs/en/ultrareview) gave the human gate its four gestures.
- **The fly.** The [Eon Systems connectome of the adult fly brain](https://github.com/eonsystemspbc/fly-brain) shows behaviour coming out of structure, which is why the kernel governs with structure and does not depend on the model. It enters as a story and nothing else: Vespi is not a brain and does not learn.
- **The skills.** The `writing-skills` discipline of [Superpowers](https://github.com/obra/superpowers) (MIT) gave the kernel its red first; skill provenance is queued for `0.1.4`.

</details>

Reviews launched by the person rather than by the agent (an ultrareview, a security review) enter this repository with their run, report or session log attached, or they do not enter.

## The search in the ecosystem

We searched so as to offer something new and not repeat what other projects already do. Each was read in its own repository and confirmed on **2026-09-28**; credit, never disparagement. [REAPP](https://github.com/mks044/reapp-poc) (signed mandates for agent payments, enforced in a Soroban registry) arrived at a shape close to this kernel from the other side. The [Stellar AI Agent Kit](https://github.com/JoseCToscano/stellar-mcp) turns any Soroban contract into an MCP server. Trustless Work, Soroban Governor, Teken, Trustful and Chaincerts already cover escrow, governance, multisig and credentials; Vespi does not rebuild them, they are its capabilities. What we saw: the ecosystem is rich in pieces and no piece coordinates an operation across several people and organizations from beginning to end. That gap is where Vespi sits; it is a claim about a moving landscape, not a law.

## What it does not do yet, and what is not verified

<details>
<summary><b>What is not built or not verified</b></summary>

- **`0.1.4` is prepared, not published:** a result of uncertain outcome is never proposed again, `perform` receives a stable idempotency key, delegations get a deadline, attempts get a cap, and the injectable clock reaches the receipt. It comes from the [prior-art study](./docs/PRIOR_ART.md); its code is still under independent verification.
- **The receipt is not durable by itself.** Whoever calls the kernel owns where it lives.
- **No cross-host runtime, scheduler, daemon, migration engine or quota manager.** The continuation semantics are here; what wakes the process is the host's.
- **Not verified:** x402 on mainnet, with more than one provider, or run by someone else; production readiness, regulatory compliance or a stable protocol.

</details>

**Terms.** A **capability** is an available action. A **grant** is the authority for an effect. A **human gate** is the decision surface consulted when the authority is insufficient: not a signature system. A **receipt** is the structured object the operation returns, not automatic durable persistence.

**The bet** *(direction, not current implementation)*: an operation that stays meaningful beyond the lifetime of one model, host or session, with enough state to continue honestly after an interruption. A resource limit should interrupt computation before it interrupts the human. Autonomy is not how long Vespi can run without a human but how much legitimate work it completes without consuming unnecessary human attention. Use the least expensive sufficient intelligence.

**Relationship to Lore Plugin.** [LUS](https://github.com/andresanemic/lore-plugin/blob/main/docs/LUS_en.md) and [Lore Plugin](https://github.com/andresanemic/lore-plugin) are Vespi's genealogy and criterion. Lore Plugin provides the durable ground an operation needs and Vespi operates inside those boundaries; it does not replace Lore Plugin and creates no second path for learning or writing.

**Origin and context.** Vespi grows from work on criterion, continuity and operational authority, not from a payment protocol; x402 on Stellar testnet was the first economic pressure that exposed real authority questions. Find Your Way + Tellus is the current public context and the [HackMeridian event](https://meridian.stellar.org/event-details) a public horizon. No ownership, sponsorship, endorsement, partnership, funding or official affiliation is claimed.

## Quickstart

**Level 1, kernel, nothing external:** `node --test test/*.test.js`. It covers the operation, bounded authority, multi-person approval, the impossible task, pausing, the human gate, receipts, anchoring states and continuity by receipts. `node --test` alone also runs the x402 demo suite.

**Level 2, bounded x402 testnet demo:** see [`demo/x402/README.md`](./demo/x402/README.md). The paid route needs a funded testnet account, a USDC trustline, a receiver, environment variables and network access. One live testnet payment is verified; that is all it certifies.

**Why publish this early?** Because the history is part of the evidence: what survives, what fails, what changes and what gets rejected stays inspectable while the project is still becoming itself.

## Author

**Andrés Peña Mellado**, Digital Art Director & Creative Developer working across AI agents, Web3, design and research.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/) &nbsp;&nbsp; <img src="./assets/icons/v2/discord.svg" width="28" alt="Discord">

---

[Genesis](./docs/GENESIS.md) · [Changelog](./CHANGELOG.md) · [0.1.3 release note](./docs/RELEASE_0.1.3_KERNEL.md) · [Coordinator method](./docs/METHOD.md) · [Experiments](./experiments/) · [Last tag v0.1.3-kernel](https://github.com/andresanemic/vespi/releases/tag/v0.1.3-kernel) · [Apache 2.0 License](./LICENSE) · [NOTICE](./NOTICE)

</details>

<details>
<summary><b>Leer en español</b></summary>

> **¿Construyes en Stellar? Esto es para ti.** La idea es que Lore, el sistema operativo cuyo kernel es Vespi, se convierta en el sistema operativo definitivo del ecosistema de Stellar: una forma de crear apps en Stellar junto con Raven MCP, de manera rápida, confiable y segura. Invito a cada persona que construye en el ecosistema de Stellar a revisar este kernel y a usarlo si le sirve.

<a id="español"></a>

**Vespi mantiene viva una operación cuando cambian las personas, los agentes y las herramientas que la rodean.**

> **La unidad no es el agente. La unidad es la operación.**

Vespi es el kernel del sistema operativo de Lore para trabajar con IA, y te permite construir aplicaciones complejas sin que tengas que saber cómo se hace. La meta detrás es que Lore se convierta en el sistema operativo definitivo, a nivel mundial, para trabajar y construir con IA. [Lore Plugin](https://github.com/andresanemic/lore-plugin) prepara el terreno —criterio, Lore, el método del coordinador— y Vespi opera sobre él, ejecutando por ti lo difícil: ciclos hasta terminar el trabajo, desarrollo con la prueba primero, lectores ciegos que juzgan el resultado sin ver cómo se hizo y una verificación hecha por alguien distinto de quien trabajó.

Tú dices qué quieres; Vespi mantiene viva la operación bajo una autoridad que otorga una persona y deja un recibo cuyo digest cualquiera puede recalcular para comprobar su integridad. El kernel se construyó en parte con Raven MCP (el MCP sobre el directorio de proyectos del ecosistema Stellar). Este repositorio es el **kernel**: JavaScript sin dependencias, sin framework, sin demonio y sin red. Antes de la `1.0` sus versiones son fotos públicas, no un protocolo estable.

**Por qué.** Construir con IA no debería exigir ser experto en IA. Hoy un agente te dice "terminé" y tienes que creerle, así que solo confía quien puede auditar el trabajo. Queremos que cualquiera con una idea pueda construir software real, se sienta capaz y pueda comprobar lo que se hizo. Vespi hace lo difícil para que la persona no tenga que saberlo.

**Si estás evaluando Find Your Way o Meridian, empieza aquí.**

1. **Qué es.** El kernel del sistema operativo de Lore para trabajar con IA: una autoridad que otorga una persona, un recibo que cualquiera puede comprobar y una operación que otro agente puede retomar mañana.
2. **Por qué es un proyecto de Stellar.** Un pago x402 en vivo de 0,01 USDC en Stellar testnet volvió `verified`, y [Horizon confirma la transacción](https://horizon-testnet.stellar.org/transactions/abb968e86d8997f6f555c4efe50dd5a70671dc5064b8220a7f2ea221de7650d5) por separado. Los recibos se pueden anclar en Stellar, y TEMIS, la primera operación real, ancla ahí sus registros y un tercero los reconstruyó solo desde el historial público. En total, [50 transacciones exitosas en testnet desde 8 cuentas](./docs/TESTNET_EVIDENCE.md), releídas desde Horizon, respaldan el proyecto: un ciclo completo de un acuerdo corrido dos veces, anclajes concurrentes, un pago idempotente y las corridas de x402.
3. **Compruébalo tú, sin red.** `node --test test/*.test.js` corre 205 pruebas sin billetera y sin red. El recibo en vivo está [en el repositorio](./demo/x402/receipts/live-testnet-2026-10-02.json). Con red, `node scripts/verify-testnet-evidence.mjs` le pregunta a Horizon por cada transacción listada en el archivo de evidencia.
4. **Mira lo que se construye encima.** Diez proyectos funcionales, cada uno con su acuerdo escrito antes de su código, sobre datos ficcionados. Varios estarán abiertos para revisión durante el periodo de los jueces. La tabla está en la sección de abajo.
5. **Lo que no afirmamos.** Nada de mainnet, ni un segundo proveedor, ni listo para producción. Está en *No verificado*.


## En un minuto

Cuando trabajas con un agente, la sesión termina y la siguiente tiene que empezar. Lo que suele sobrevivir es un resumen, y un resumen no dice **quién permitió esto**, **cuánto**, **hasta cuándo**, **a quién** ni **si de verdad ocurrió**. Eso no son detalles de un resumen: son la operación.

Por eso Vespi parte de la operación. Lleva un objetivo y una autoridad que una persona le otorgó (con un reloj, un presupuesto y un destino). El kernel permite como máximo una ejecución por operación y proceso; un resultado incierto queda `not_verified` y nunca se reintenta a ciegas. La verificación sigue **separada**, y el recibo dice qué se cubrió y qué no. Cuando algo cambia, la operación se relee desde sus recibos y continúa solo si la próxima acción sigue de acuerdo con lo pactado; si no, vuelve a la persona.

```bash
git clone https://github.com/andresanemic/vespi.git
cd vespi
node --test test/*.test.js     # ℹ tests 205 · ℹ pass 205 · ℹ fail 0
node scripts/verify-testnet-evidence.mjs   # vuelve a comprobar las 50 transacciones de testnet contra Horizon (necesita red)
```

## Por qué Vespi, y no hacerlo uno mismo

Escribir una app es la parte fácil. Lo que toma meses, y casi siempre se omite, es todo lo que rodea al trabajo: quién puede hacer qué, hasta cuándo y por cuánto; la prueba de lo que ocurrió; detenerse con honestidad cuando un resultado es incierto; retomar mañana donde quedaste; una decisión humana donde hace falta; y una verificación hecha por alguien que no hizo el trabajo. Vespi te da todo eso como un kernel probado, para que cada app no lo reinvente y para que la persona con la idea no tenga que ser experta en cómo se hace.

| Necesitas | Lo que te da Vespi | Dónde vive |
|---|---|---|
| Permiso con límites | Una autorización con un activo, un tope, un destino y un vencimiento; un solo presupuesto que no se puede gastar dos veces; una autorización vencida se rechaza; se puede exigir a varias personas con nombre | `authority`: `{ asset, maxAmount, to, expiresAt }`, `signers`, `pausers` |
| Prueba de lo que ocurrió | Un recibo con huella SHA-256, las comprobaciones que dieron verdadero y lo que no se cubrió, por nombre | `buildReceipt`, `verifyReceipt`, `notCovered` |
| Detenciones honestas | Una tarea sin salida legítima vuelve bloqueada con su salida; un resultado de desenlace incierto nunca se reintenta a ciegas | `impossible`, `not_verified`, `resumeFromReceipts` |
| Una persona donde hace falta | Una puerta que muestra el costo primero, nunca deja que el agente consienta por la persona y nombra la salida en cada rechazo | la puerta humana y sus cuatro gestos |
| Continuar mañana | Reanudar desde los recibos: el último estado verificado, la próxima acción y si debe intervenir una persona | `resumeFromReceipts(receipts, agreement)` |
| Una verificación independiente | Quien verifica nunca es quien ejecuta; lectores ciegos juzgan sin ver cómo se hizo; un tercer agente sin acceso al código reconstruye el resultado | [`docs/METHOD.md`](./docs/METHOD.md), [`experiments/`](./experiments/) |
| Prueba pública, si la quieres | Un anclaje en Stellar que solo cuenta cuando un verificador confirma el digest y la red | `anchorReceipt`: `pending` → `submitted` → `anchored` |

**Con IA o sin ella, con blockchain o sin ella.** Al kernel no le importa cuál es tu efecto. Es JavaScript sin dependencias que no habla con ninguna red: lo que supervisa puede ser una escritura en una base de datos, una llamada a otro sistema, un paso hecho por un agente de IA o un pago, y la autoridad, los recibos, la puerta humana y la continuidad funcionan igual en todos los casos. Stellar es un adaptador, no un requisito: puedes anclar un recibo en la red cuando algo deba poder probarse públicamente, o no tocar nunca una blockchain. x402 vive en un solo lugar, [`demo/x402/`](./demo/x402/), y en ningún otro. Por eso el mismo kernel puede estar bajo una app que usa IA y Stellar y bajo una que no usa ninguna de las dos.

**Pensado para las nuevas leyes de Chile.** Vespi se diseñó pensando en las nuevas leyes chilenas de protección de datos personales (Ley 21.719) y de interoperabilidad de fichas clínicas (Ley 21.668). En la práctica: la autoridad se limita por finalidad, monto y tiempo, porque un permiso nombra quién puede actuar, sobre qué, hasta cuánto y hasta cuándo; la autoridad puede nombrar quién puede pausar y reanudar una operación; cada acceso y cada rechazo deja un recibo legible, de modo que alguien puede ver quién pidió qué y qué se rechazó; los recibos están hechos para llevar huellas y comprobaciones con nombre en vez del contenido mismo; y el kernel no guarda nada y no llama a ninguna red, de modo que cada institución conserva sus propios sistemas de registro. Dos de los diez proyectos funcionales son pruebas de concepto de justo esto: **Llavero** (mis datos: quién los pide, para qué, bajo qué permiso) y **Ficha Contigo** (la ficha clínica). Esto es intención de diseño. No es cumplimiento legal, y ninguna autoridad ni abogado lo certificó.

**Por qué las instituciones pueden hacer pilotos.** El kernel se pensó para que una institución pueda probarlo sin adoptar una plataforma: es una biblioteca bajo Apache 2.0, sin dependencias y sin servicio alojado, así que un piloto corre dentro del entorno de la propia institución y no hay que entregar nada; sus permisos tienen la forma que pregunta un equipo de cumplimiento (quién, qué, cuánto, hasta cuándo, quién aprobó); y la prueba de lo que ocurrió es algo que el propio auditor de la institución puede recalcular. Espero trabajar pronto con instituciones del mundo público y del privado para crear las apps que necesitan para coordinarse y trabajar en equipo. Los proyectos funcionales son pruebas de concepto de justo ese tipo de tarea.

**Hacia dónde va.** La meta es que Lore se convierta en el sistema operativo definitivo, a nivel mundial, para trabajar y construir con IA, y para el ecosistema de Stellar en particular: una forma de crear apps en Stellar, junto con Raven MCP, de manera rápida, confiable y segura.

**Cómo usarlo hoy.** El kernel es JavaScript simple: lo importas y envuelves tu efecto. La skill de Vespi viene dentro de [Lore Plugin](https://github.com/andresanemic/lore-plugin). Instalar Vespi por sí sola como skill de primera parte, sin el resto del kit de Lore, está planeado para el final de Find Your Way; todavía no está disponible.

## Qué es Vespi visto desde fuera: un método

Un encargo se vuelve trabajo que puedes comprobar. Cuando le pides a un agente algo que no es trivial, el coordinador sigue un ciclo, y Vespi hace que cada paso sea algo que puedes verificar en vez de algo que te cuentan: **clasificar el encargo**, **definir terminado** como una observación con nombre, **reunir evidencia** de la fuente primaria, **decidir** (un acto hacia afuera necesita las palabras propias de la persona), **actuar con precisión**, **verificar por observación** aparte de quien lo construyó y **reportar primero el resultado**, con lo que se omitió. El ciclo está escrito una sola vez, para todo el sistema, en [`docs/METHOD.md`](./docs/METHOD.md).

| En el ciclo | En la operación |
|---|---|
| Terminado es una observación con nombre | La operación declara su efecto y lo que observará la verificación |
| La puerta hacia afuera | La autoridad se prueba antes de la frontera; el agente no puede contestar la puerta por la persona |
| Verificar aparte de quien lo construyó | Un verificador que no es el ejecutor, y un recibo que lista lo que cubrió y lo que no |
| Reportar primero el resultado, con salvedades | El recibo es el reporte: estado, evidencia, `coverage`, `notCovered` |
| Una sorpresa vuelve a un paso anterior | Una premisa material que cae abre revalidación antes de que la operación continúe |
| Parar tras tres ciclos fallidos | Una tarea imposible vuelve `blocked` con su salida, sin reintentarse a ciegas |
| Retomar desde el checkpoint, no desde un resumen | Continuidad por recibos: el último estado verificado, la próxima acción y si una persona debe intervenir |

**Cómo se vio en una operación real.** La primera operación que corrió todo el sistema fue construir TEMIS, una capa que hace comprobables por un tercero los compromisos de un acuerdo bilateral (testnet, datos ficcionados). Un modelo asesor independiente revisó el diseño antes de fijarlo y encontró cuatro huecos. Un modelo trabajador más barato lo implementó viendo solo las pruebas. La verificación, hecha aparte, encontró ocho huecos más que las pruebas del trabajador no cubrían. Un tercer agente, sin acceso al código, reconstruyó todo el registro desde el historial público de Stellar y reprodujo los 22 resultados.

## Vespi y Lore Plugin: un sistema operativo para trabajar con IA

```
  tú         dices lo que quieres, con tus palabras
  ──────────────────────────────────────────────────────────────────────────
  hosts      Claude Code · Codex · OpenCode          donde corre el agente
  ──────────────────────────────────────────────────────────────────────────
  Lore Plugin   el terreno: tu criterio (Lore), el enrutamiento que abre el
                criterio correcto para cada tarea, el método del coordinador
                y los hooks que mantienen honesta una sesión
  ──────────────────────────────────────────────────────────────────────────
  Vespi         el kernel: operaciones bajo autoridad otorgada, verificación
                aparte de la ejecución, recibos, continuidad desde el último
                estado verificado
  ──────────────────────────────────────────────────────────────────────────
  apps          lo que se construye encima: los proyectos funcionales de abajo
```

Tú dices qué quieres. El coordinador abre el criterio que lo gobierna, define cómo se verá terminado y te pide solo lo que te toca decidir: autoridad, dinero, publicar. Reparte tramos acotados de trabajo a otros modelos, cada uno con su pregunta, sus límites y un recibo, verifica aparte y escribe un checkpoint en el `FASES.md` del proyecto. La sesión siguiente retoma desde los recibos, no desde un resumen. Nunca necesitas saber que existe el kernel.

**Dónde está hoy.** Los primeros experimentos (RUN 01 a 05) fueron solo el comienzo: fueron las pruebas que dieron forma al kernel, y el proyecto avanzó mucho desde entonces. Hoy hay un kernel publicado (`0.1.3`, con `0.1.4` preparada y sin publicar), la skill de Vespi dentro de Lore Plugin, el método del coordinador, diez proyectos funcionales construidos sobre él (nueve con código y pruebas) y una operación real corrida de punta a punta: TEMIS, cuyos registros de acuerdos están anclados en Stellar y los reconstruyó un tercer agente independiente solo desde Horizon (22 de 22 estatus). En la testnet de Stellar hay ahora [50 transacciones exitosas desde 8 cuentas](./docs/TESTNET_EVIDENCE.md), incluido un pago x402 en vivo a través del facilitador real, anclajes concurrentes y un pago idempotente, y el repositorio lleva un [estudio de cómo kernels, planificadores y sistemas de ejecución durable resolvieron los mismos problemas](./docs/PRIOR_ART.md). Lore Plugin `2.4.9` trae el flujo al kit: un checkpoint por proyecto, tareas por rol con las herramientas que el host realmente expone y la economía de una operación declarada antes de correr. Después: las primeras aplicaciones para personas reales.

## Qué trae el 0.1.3

Publicado como [`v0.1.3-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.3-kernel) (anterior: [`v0.1.2-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.2-kernel)). Todo lo que sigue se leyó en el código, no en un plan. La suite del kernel está en **205/205** y la corrida completa, con la demo x402, en **254/254**. En los commits de la versión (`2dcfd92`, y de nuevo en `7dcec77`) eran 203/203 y 252/252; las dos pruebas añadidas desde entonces revisan la lista de evidencia de testnet.

<details>
<summary><b>Las capacidades, una por una</b></summary>

- **Autoridad con reloj, presupuesto y destino.** Un permiso es `{ asset, maxAmount, to, expiresAt }`. Con `to` cubre solo ese destino; sin `to` conserva **un** presupuesto (400 + 400 contra un techo de 500 no alcanza). Un permiso vencido se rechaza diciendo el momento en que venció. En `runOperation`, `io.now` suministra la hora para revisar la vigencia y emitir recibos.
- **Autoridad de varias personas.** `authority.signers = { required, allowed }`: la puerta cuenta identidades nominales *distintas* de `allowed`, nunca la del propio agente de la operación ni aprobaciones precargadas en la autoridad. Son identidades, no firmas criptográficas.
- **Recibos con huella SHA-256 y cobertura real.** `verifyReceipt` recalcula el digest, así que editar el estado, la evidencia o la cobertura falla. **La huella prueba integridad, no autenticidad.** Una comprobación cuenta como cubierta solo si volvió `true`; lo demás queda en `notCovered` por nombre. El estado es uno de seis valores y es el mismo que devuelve la operación; los campos de evidencia no reconocidos se descartan.
- **Anclaje en Stellar, como una interfaz honesta.** `anchorReceipt` sube `pending` → `submitted` → `anchored` sin saltarse ninguno: `anchored` solo cuando un verificador confirma el digest *y* la red (`stellar:testnet` o `stellar:pubnet`). Un hash de transacción solo no es un ancla. Al verificador se le dice qué red reclama el ancla, porque la frase de red es parte de lo que Stellar firma: un ancla en testnet no puede presentarse como de mainnet. El kernel no habla con ninguna red; el adaptador es de quien lo llama, con un camino síncrono y otro asíncrono.
- **La tarea imposible vuelve bloqueada, con su salida.** Una capability puede declarar `{ impossible: true, reason }` desde `required()` y entonces `perform` nunca se llama. Nunca se reintenta a ciegas: correr de nuevo devuelve el mismo recibo, y nombra el camino de salida.
- **Quién puede pausar queda escrito.** `authority.pausers` se comprueba en `pauseOperation` y `resumeOperation`.
- **La puerta humana y sus cuatro gestos.** Se abre cuando la autoridad disponible no cubre el requisito, y siempre cuando la autoridad declara `signers`. Muestra el costo primero, nunca deja que el agente consienta por la persona (esa aprobación se rechaza y la operación vuelve a `needs_human_decision`), mantiene lo público apagado por defecto y nombra la salida en cada rechazo. Sin `ask` no hay aprobación, así que la operación se detiene y pregunta; el recibo nombra quién aprobó (`decidedBy`).
- **Continuidad por recibos.** `resumeFromReceipts(receipts, agreement)` responde: el último estado verificado, la próxima acción y si una persona debe intervenir. Los recibos que no verifican se descartan y se cuentan. Retomar lo acordado **no** abre la puerta; tres cosas sí: un recibo verificado de una acción fuera del acuerdo, un cambio del alcance, el monto, el techo o el estado de la próxima acción, y un último recibo de la próxima acción que quedó `blocked`, `paused` o `needs_human_decision`. No hay documento de traspaso: cualquier agente en cualquier host continúa desde los recibos.
- **Un modelo de decisión opcional que solo aconseja.** Puede adjuntar una sugerencia a la puerta por encima de un umbral; nunca aprueba.

</details>

## Evidencia que puedes abrir

El registro más nuevo es la evidencia en la testnet de Stellar de más abajo. Debajo están los primeros experimentos que formaron el kernel, en [`experiments/`](./experiments/): los primeros cuerpos y recibos, un ciclo Operador ↔ Profesor con arbitraje independiente, un corte anterior de x402 / Stellar testnet que conservó una falla real de verificación como evidencia y la evaluación final del RUN 05, **cerrada** dentro de su alcance local y sin red declarado, con las lecturas ciegas y los informes del verificador que la cerraron. Esas corridas fueron las primeras pruebas, no lo último que se hizo: la evidencia de abajo es lo que el kernel y los proyectos construidos sobre él han hecho desde entonces.

**Un pago x402 en vivo en Stellar testnet está verificado para esta versión.** El 2026-10-02 el adaptador reparado pagó 0,01 USDC a través del facilitador real, el recibo volvió `verified` y Horizon confirmó la transacción por separado (`abb968e8…`, ledger 4988161). Es una de las 50 transacciones de abajo, en testnet, y su recibo todavía lista `external anchor` en `notCovered`: sin mainnet, sin un segundo proveedor, sin la corrida de otra persona. El ejemplo pagado vive en [`demo/x402/`](./demo/x402/), el único lugar que conoce x402, Stellar o USDC.

**No fue una sola transacción.** Entre el 2026-10-02 y el 2026-10-03 el trabajo alrededor de Vespi escribió **50 transacciones exitosas en testnet** desde 8 cuentas en la testnet de Stellar (ledgers 4987795 a 4996153), con datos de fantasía y sin dinero real. Cada hash está en [docs/TESTNET_EVIDENCE.md](./docs/TESTNET_EVIDENCE.md) y en un [archivo legible por máquina](./docs/testnet-evidence.json), y `node scripts/verify-testnet-evidence.mjs` le pregunta a Horizon por cada una (50 de 50 estaban exitosas al escribir esto).

| Qué se ejerció en Stellar | Transacciones | Qué muestra |
|---|---|---|
| Ciclo completo de un acuerdo de TEMIS (alta, firma y contrafirma, anclaje, hito, impugnación, corrección, disputa), corrido dos veces | 38 | Compromisos escritos como transacciones ordenadas por ledger, con su digest en un memo de hash. Un tercer agente sin acceso al código reconstruyó el registro solo desde el historial de Horizon: coincidieron 22 de 22 estatus y encontró un defecto que ninguna prueba había visto. |
| Anclajes concurrentes, dos procesos, tres rondas | 6 | Dos escritores compitiendo desde una cuenta: el que pierde reintenta y el orden por (ledger, índice) sigue siendo determinista. |
| Prueba de tipo de operación: un pago clásico y una transferencia del contrato de activo de Soroban | 2 | Ambas emiten el mismo evento `transfer`, así que un evento solo no prueba cómo se hizo el pago. |
| Pago x402 idempotente | 1 | Una llamada, un abono real, y una entrega reintentada no se cobró dos veces. |
| Corridas de pago x402 a través del facilitador real | 3 | La primera volvió `not_verified` por un error nuestro (leíamos el campo equivocado); el adaptador reparado verificó, y Horizon lo confirmó por separado. |

Otros dos hallazgos salieron de testnet sin una transacción: el facilitador rechaza en `/verify` una `payTo` de cuenta multiplexada (`invalid_exact_stellar_payload_event_wrong_to`), y un payload ya liquidado se rechaza cuando se reenvía a `/settle`. Lo que esto ejerce en Stellar: pagos clásicos, anclaje con memo de hash, una transferencia del contrato de activo de Soroban, el esquema `exact` de x402 a través del facilitador real, escritores concurrentes y lectura de vuelta desde Horizon. Todo es testnet, con un facilitador y un pagador. Stellar reinicia la testnet unas veces al año, así que los recibos de este repositorio son el registro duradero.

Una segunda capacidad vive fuera del kernel: [`capabilities/respaldo/`](./capabilities/respaldo/LEEME.md) copia el árbol de trabajo de una persona a una carpeta que Drive, Dropbox o OneDrive ya sincronizan, nunca borra y verifica cada hash. Todavía no cifra, no sube por APIs ni guarda versiones. 17 pruebas.

## Los proyectos funcionales

Vespi es un kernel, no una aplicación. Lo que demuestra que funciona es lo que se construye encima: diez proyectos, cada uno con **su propio acuerdo escrito antes de su código**, sobre **datos ficcionados**. Su estado se leyó el **2026-10-02** corriendo la suite propia de cada proyecto contra el kernel instalado hoy (`0.1.3`).

**Durante el periodo de revisión de los jueces de la hackatón Find Your Way, varios de estos proyectos estarán liberados para que se revise su código.** La próxima semana los repositorios de los proyectos funcionales empiezan a hacerse públicos, primero sin código, cada uno explicando en detalle el porqué, el cómo y el qué: cómo funciona, quién participa y con qué derechos, y qué evidencia tiene. El código se abre para revisión durante el periodo de los jueces, con una licencia que permite leerlo y clonarlo para evaluar, no modificarlo. La idea es mostrar cómo funciona Vespi, no solo contarlo.

| # | Proyecto | Qué es | Estado hoy | Su suite hoy |
|---|---|---|---|---|
| 1 | **Queen** | La agencia de marketing del ecosistema Stellar: presupuesta dentro del techo que se le otorgó y cobra con una capa x402 **simulada**. | Acuerdo + código + pruebas | 42 / 45 |
| 2 | **Permamuseum** | Patrimonio cultural latinoamericano en Stellar, con procedencia y permisos. | Idea: una nota de estudio, sin código | — |
| 3 | **Casa Firme** | Vivienda para asentamientos informales: la autoridad nace en la asamblea del comité; cada donación deja rastro. | Acuerdo + código + pruebas | 21 / 24 |
| 4 | **Ficha Contigo** | La ficha clínica: la institución usa solo lo que el paciente otorgó; el acceso de emergencia se otorga de antemano. | Acuerdo + código + pruebas | 7 / 13 |
| 5 | **Cátedra** | La universidad: uso declarado de IA, notas firmadas por el profesor, títulos como credenciales verificables. | Acuerdo + código + pruebas | 34 / 35 |
| 6 | **Escribano** | Una DAO con registro legal de cada cambio de su contrato (Wyoming W.S. 17-31). | Acuerdo + código + pruebas | 8 / 13 |
| 7 | **Llavero** | «Mis datos»: quién los pide, para qué, bajo qué permiso y qué se rechazó. | Acuerdo + código + pruebas | 8 / 14 |
| 8 | **Farolero** | Autoridad para agentes sin código: delegar solo estrecha; lo que no cabe vuelve bloqueado. | Acuerdo + código + pruebas | 8 / 13 |
| 9 | **Marea** | Verificar compromisos climáticos entre países (Acuerdo de París art. 6.2) sin contar una reducción dos veces. | Acuerdo + código + pruebas | 25 / 25 |
| 10 | **Vela** | Proteger a quien dice la verdad por un canal legal; la prueba de conocimiento cero de pertenencia está pendiente. | Acuerdo + código + pruebas | 10 / 11 |
| — | **TEMIS** | Validación legal de acuerdos bilaterales por hitos: firmados, contrafirmados y anclados para que un tercero reconstruya lo ocurrido. La primera operación real de Lore Plugin y Vespi como uno. | Whitepaper + MVP: pruebas 0 a 8 corridas en Stellar testnet con datos ficcionados (un ciclo completo corrido dos veces, 38 transacciones, más anclajes concurrentes y un pago x402 idempotente); falta el certificado de su dueño y la revisión jurídica | 135 / 135 |

**Cómo leer la última columna.** Nueve de los diez se construyeron el 2026-09-29 contra el corte `54c20c7` del kernel y sus propios registros los dan en verde ahí; aquí no se volvió a correr. Cada uno fija por digest el kernel que consume y falla a propósito cuando el kernel se mueve, así que contra `0.1.3` parte de cada suite falla hasta re-anclarlo. Ese re-anclaje está pendiente, y también lo está cualquier afirmación de que estos diez estén listos: hoy muestran un camino que funciona, no un producto terminado.

## Cómo se construyó

Una afirmación sin recibo no entra. Estas son las revisiones que formaron a Vespi:

<details>
<summary><b>Las revisiones y fuentes que formaron a Vespi</b></summary>

- **Disciplina: cómo se verifica.** La prueba primero, otro verificando, ataques escritos como pruebas y una revisión de seguridad con el método de Anthropic que encontró un fallo real en nuestro propio kit y se corrigió con la prueba primero. Lo que es simulado hasta ahora (el superreview) y lo que viene está con sus límites en [`docs/VERIFICATION.md`](./docs/VERIFICATION.md).
- **Raven y el ecosistema Stellar.** Raven, el MCP sobre el directorio de proyectos del ecosistema, estuvo activo durante toda la construcción: sin él no se habrían podido hacer x402 y Stellar, y el estudio que habilitó mostró que la pieza que faltaba era un kernel para coordinar los proyectos que existen, no otro proyecto de pagos.
- **The Fable Method.** El ciclo del coordinador es la redacción propia de Vespi de [The Fable Method](https://github.com/Sahir619/fable-method), de Sahir619 (MIT), destilada para que no dependa de ninguna skill instalada: mira [`docs/METHOD.md`](./docs/METHOD.md).
- **Arte previo.** [`docs/PRIOR_ART.md`](./docs/PRIOR_ART.md) resume las comparaciones técnicas y sus límites.
- **El informe de OpenAI.** [OpenAI — Hugging Face Incident, Technical Report](https://cdn.openai.com/pdf/67869394-cb91-4c12-888c-5cbd85c7814c/OpenAI-Hugging-Face%20Incident-Technical-Report.pdf): una operación se autoriza antes de actuar, una tarea sin salida legítima empuja a un agente al borde y la verificación tiene que vivir fuera del agente.
- **Ultrareview.** [Su documentación](https://code.claude.com/docs/en/ultrareview) le dio a la puerta humana sus cuatro gestos.
- **La mosca.** El [conectoma del cerebro de la mosca adulta de Eon Systems](https://github.com/eonsystemspbc/fly-brain) muestra conducta que sale de la estructura, por eso el kernel gobierna con estructura y no depende del modelo. Entra solo como relato: Vespi no es un cerebro y no aprende.
- **Las skills.** La disciplina `writing-skills` de [Superpowers](https://github.com/obra/superpowers) (MIT) le dio al kernel su rojo primero; la procedencia de skills queda en cola para `0.1.4`.

</details>

Las revisiones que lanza la persona y no el agente (un ultrareview, una revisión de seguridad) entran a este repositorio con su corrida, informe o registro de sesión adjunto, o no entran.

## La búsqueda en el ecosistema

Buscamos para ofrecer algo nuevo y no repetir lo que otros proyectos ya hacen. Cada uno se leyó en su propio repositorio y se confirmó el **2026-09-28**; crédito, nunca menosprecio. [REAPP](https://github.com/mks044/reapp-poc) (mandatos firmados para pagos de agentes, aplicados en un registro Soroban) llegó a una forma cercana a este kernel desde el otro lado. El [Stellar AI Agent Kit](https://github.com/JoseCToscano/stellar-mcp) convierte cualquier contrato Soroban en un servidor MCP. Trustless Work, Soroban Governor, Teken, Trustful y Chaincerts ya cubren escrow, gobernanza, multifirma y credenciales; Vespi no los reconstruye, son sus capacidades. Lo que vimos: el ecosistema es rico en piezas y ninguna coordina una operación entre varias personas y organizaciones de principio a fin. Ahí está el hueco de Vespi; es una afirmación sobre un paisaje que se mueve, no una ley.

## Lo que todavía no hace, y lo que no está verificado

<details>
<summary><b>Lo que no está construido o no está verificado</b></summary>

- **`0.1.4` está preparada, sin publicar:** un resultado de desenlace incierto no se vuelve a proponer, `perform` recibe una clave de idempotencia estable, las delegaciones tienen plazo, los intentos tienen tope y el reloj inyectable llega hasta el recibo. Sale del [estudio de arte previo](./docs/PRIOR_ART.md); su código sigue en verificación independiente.
- **El recibo no es durable por sí solo.** Quien llama al kernel decide dónde vive.
- **No hay runtime entre hosts, scheduler, demonio, motor de migración ni gestor de cuotas.** La semántica de continuación está aquí; lo que despierta el proceso es del host.
- **No verificado:** x402 en mainnet, con más de un proveedor o corrido por otra persona; preparación para producción, cumplimiento regulatorio o un protocolo estable.

</details>

**Términos.** Una **capability** es una acción disponible. Un **grant** es la autoridad para un efecto. Una **puerta humana** es la superficie de decisión que se consulta cuando la autoridad no basta: no es un sistema de firmas. Un **recibo** es el objeto estructurado que devuelve la operación, no persistencia durable automática.

**La apuesta** *(dirección, no implementación actual)*: una operación que sigue teniendo sentido más allá de la vida de un modelo, un host o una sesión, con estado suficiente para continuar con honestidad tras una interrupción. Un límite de recursos debería interrumpir la computación antes que a la persona. La autonomía no es cuánto tiempo puede operar Vespi sin una persona, sino cuánto trabajo legítimo completa sin consumir atención humana innecesaria. Usa la inteligencia suficiente menos costosa.

**Relación con Lore Plugin.** [LUS](https://github.com/andresanemic/lore-plugin/blob/main/docs/LUS_es.md) y [Lore Plugin](https://github.com/andresanemic/lore-plugin) son la genealogía y el criterio de Vespi. Lore Plugin aporta el terreno durable que una operación necesita y Vespi opera dentro de esos límites; no reemplaza a Lore Plugin ni crea un segundo camino para aprender o escribir.

**Origen y contexto.** Vespi nace de trabajo sobre criterio, continuidad y autoridad operativa, no de un protocolo de pagos; x402 sobre Stellar testnet fue la primera presión económica que expuso preguntas reales de autoridad. Find Your Way + Tellus es el contexto público actual y el [evento HackMeridian](https://meridian.stellar.org/event-details) un horizonte público. No se reclama propiedad, patrocinio, respaldo, alianza, financiamiento ni afiliación oficial.

## Quickstart

**Nivel 1, kernel, nada externo:** `node --test test/*.test.js`. Cubre la operación, la autoridad acotada, la aprobación de varias personas, la tarea imposible, la pausa, la puerta humana, los recibos, los estados del anclaje y la continuidad por recibos. `node --test` solo también corre la suite de la demo x402.

**Nivel 2, demo x402 acotada en testnet:** mira [`demo/x402/README.md`](./demo/x402/README.md). La ruta pagada necesita una cuenta de testnet con fondos, una línea de confianza a USDC, un receptor, variables de entorno y acceso a red. Un pago en vivo en testnet está verificado; eso es todo lo que certifica.

**¿Por qué publicarlo tan temprano?** Porque la historia es parte de la evidencia: lo que sobrevive, lo que falla, lo que cambia y lo que se rechaza queda a la vista mientras el proyecto todavía se está volviendo a sí mismo.

## Autor

**Andrés Peña Mellado**, Director de Arte Digital y Desarrollador Creativo que trabaja entre agentes de IA, Web3, diseño e investigación.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/) &nbsp;&nbsp; <img src="./assets/icons/v2/discord.svg" width="28" alt="Discord">

---

[Génesis](./docs/GENESIS.md) · [Changelog](./CHANGELOG.md) · [Nota de la versión 0.1.3](./docs/RELEASE_0.1.3_KERNEL.md) · [Método del coordinador](./docs/METHOD.md) · [Experimentos](./experiments/) · [Última etiqueta v0.1.3-kernel](https://github.com/andresanemic/vespi/releases/tag/v0.1.3-kernel) · [Licencia Apache 2.0](./LICENSE) · [NOTICE](./NOTICE)

</details>
