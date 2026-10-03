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
  It already integrates x402 and Stellar, and it gives you an authority a person grants, a receipt anyone can check, and an operation another agent can pick up tomorrow.
</p>

<p align="center">
  <b>Do you build on Stellar? This is for you.</b><br>
  Our goal is for Vespi, together with Lore, to become the definitive operating system of the Stellar ecosystem: a way to create apps on Stellar together with Raven MCP, quickly, reliably and securely.
</p>

<p align="center">
  <a href="https://github.com/andresanemic/lore-plugin">Lore Plugin</a> prepares the ground. Vespi operates on it.<br>
  I invite every builder in the Stellar ecosystem to review this kernel and to use it if it helps you.
</p>





---

<details>
<summary><b>Read in English</b></summary>

<a id="english"></a>

**Vespi keeps an operation alive when the people, the agents and the tools around it change.**

> **The unit is not the agent. The unit is the operation.**

Vespi is the kernel of Lore's operating system for working with AI. [Lore Plugin](https://github.com/andresanemic/lore-plugin) prepares the ground (criterion, Lore, the coordinator's method) and Vespi operates on it, running the hard parts for you: loops until the work is done, test-first development, blind readers who judge the result without seeing how it was made, and a check by someone other than whoever did the work. You say what you want; Vespi keeps the operation standing under an authority a person grants and leaves a receipt whose digest anyone can recompute to check integrity. This repository is the **kernel**: dependency-free JavaScript, no framework, no daemon, no network, built in part with Raven MCP (the MCP over the Stellar ecosystem's project directory). Before `1.0` its versions are public snapshots, not a stable protocol.

**Why.** Building with AI should not require being an expert in AI. Today an agent tells you "done" and you have to take its word for it, so only people who can audit the work can trust it. We want anyone with an idea to build real software, feel capable, and be able to check what was done. Vespi does the hard parts so the person does not have to know them.

**If you are judging Find Your Way or Meridian, start here.**

1. **What it is.** One idea, in [In one minute](#in-one-minute): the unit is the operation, not the agent.
2. **Why it belongs on Stellar.** A live x402 payment of 0.01 USDC [confirmed on Horizon](https://horizon-testnet.stellar.org/transactions/abb968e86d8997f6f555c4efe50dd5a70671dc5064b8220a7f2ea221de7650d5), receipts that can be anchored on Stellar, and [50 successful testnet transactions](./docs/TESTNET_EVIDENCE.md) in all. The detail is under *Evidence you can open*.
3. **Check it yourself.** The suite runs offline, with no wallet and no network, and one script re-asks Horizon about every transaction. The commands are under *Quickstart*.
4. **See what is built on it.** Ten functional projects, each with its agreement written before its code, on fictional data, in *The functional projects*.
5. **What we do not claim.** No mainnet, no second provider, no production readiness. It is listed under *What it does not do yet, and what is not verified*.


## In one minute

When you work with an agent, the session ends and the next one has to begin. What usually survives is a summary, and a summary does not say **who allowed this**, **how much**, **until when**, **to whom**, or **whether it actually happened**. Those are not details of a summary; they are the operation.

So Vespi starts from the operation. It carries a goal and an authority a person granted it (with a clock, a budget and a destination). The kernel permits at most one execution per operation and process; an uncertain result is `not_verified` and is never retried blindly. Verification stays **separate**, and the receipt says what was covered and what was not. When something changes, the operation is read back from its receipts and continues only if the next action still matches the agreement; otherwise it goes back to the person.

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

**Every function and capability of the kernel, explained in plain language, one by one: [`docs/CAPABILITIES.md`](./docs/CAPABILITIES.md).**

**With AI or without, with a blockchain or without.** The kernel does not care what your effect is. It is dependency-free JavaScript that talks to no network, so what it supervises can be a database write, a call to another system, a step by an AI agent or a payment, and the same authority, receipts, human gate and continuity apply. Stellar is an adapter, not a requirement: anchor a receipt when something must be publicly provable, or never touch a blockchain. x402 lives in one place, [`demo/x402/`](./demo/x402/).

**Designed with Chile's new laws in mind.** Vespi was designed thinking of the new Chilean laws on personal data protection (Law 21.719) and on the interoperability of clinical records (Law 21.668). A permission names who may act, on what, up to how much and until when; every access and every refusal leaves a readable receipt; receipts carry fingerprints and named checks, not the content; and the kernel stores nothing and calls no network, so each institution keeps its own records. It is design intent, not legal compliance: no regulator or lawyer has certified it.

**Why institutions can pilot it.** It is a library under Apache 2.0, with no dependencies and no hosted service, so a pilot runs inside the institution's own environment and nothing has to be handed over. Its permissions have the shape a compliance team asks about (who, what, how much, until when, who approved), and an auditor can recompute the proof of what happened. I hope to work soon with public and private institutions to create the apps they need to coordinate and work as a team; the functional projects are proofs of concept of that kind of task.

**Where this is going.** The goal is for Lore to become the definitive operating system, worldwide, for working and building with AI. We are also evaluating the launch of a Vespi token on Stellar. Nothing has been issued, and any design follows the principle that a token comes last, and only if an economic problem justifies it.

**How to use it today.** The kernel is plain JavaScript: require it and wrap your effect. To start building with Vespi by vibe coding, install the [Lore Plugin](https://github.com/andresanemic/lore-plugin) kit and use the Vespi skill that comes inside it. Lore Plugin `2.4.9` and kernel `0.1.4` are planned for publication on Monday, 2026-10-05. Installing Vespi on its own as a first-party skill, without the rest of the Lore kit, is planned for the end of Find Your Way; it is not available yet.

## What Vespi is, seen from the outside: a method

A request becomes work you can check. When you ask an agent for something that is not trivial, the coordinator follows one loop, and Vespi makes each step something you can verify instead of something you are told: **classify the ask**, **define done** as a named observation, **gather evidence** from the primary source, **decide** (an outward act needs the person's own words), **act surgically**, **verify by observation** apart from whoever built it, and **report the outcome first**, with what was skipped. The loop is written once, for the whole system, in [`docs/METHOD.md`](./docs/METHOD.md).

Each step lands in the operation: the receipt is the report (status, evidence, `coverage`, `notCovered`), an impossible task comes back `blocked` with its exit instead of being retried blindly, and the next session resumes from the last verified receipt, not from a summary.

**What it looked like on a real operation.** The first operation the whole system ran was building TEMIS, a layer that makes the commitments of a bilateral agreement checkable by a third party (testnet, fictional data). An independent advisor model reviewed the design before it was fixed and found four holes. A cheaper worker model implemented it seeing only the tests. Verification, done apart, found eight more holes the worker's tests did not cover. A third agent, with no access to the code, rebuilt the whole record from the public Stellar history alone (see *Evidence you can open*).

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

Lore Plugin `2.4.9` brings the flow into the kit: one checkpoint per project, tasks by role through the tools the host really exposes, and the economy of an operation declared before it runs. [LUS](https://github.com/andresanemic/lore-plugin/blob/main/docs/LUS_en.md) and Lore Plugin are Vespi's genealogy and criterion: Lore Plugin provides the durable ground an operation needs and Vespi operates inside those boundaries, with no second path for learning or writing.

## What 0.1.3 brings

Published as [`v0.1.3-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.3-kernel) (previous: [`v0.1.2-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.2-kernel)). Everything in it was read in the code, not in a plan; the capabilities are explained one by one in [`docs/CAPABILITIES.md`](./docs/CAPABILITIES.md). The kernel suite is **205/205** and the full run, including the x402 demo, **254/254**. At the release commits (`2dcfd92`, and again at `7dcec77`) they were 203/203 and 252/252; the two tests added since check the testnet evidence list.

## Evidence you can open

The newest record is the Stellar testnet evidence below. The first experiments that formed the kernel (RUN 01 to 05) are in [`experiments/`](./experiments/), with their blind reads and verifier reports; RUN 05 is **closed** within its declared local, offline scope. They were the first tests, not the latest work.

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

The projects with code have their own public repository, linked in the table and without code for now, explaining in detail the why, the how and the what: how it works, who takes part and with what rights, and what evidence it has. During the judging period of the Find Your Way hackathon the code opens for review, under a license that lets you read and clone it to evaluate it, not modify it. The aim is to show how Vespi works, not only to tell it.

| # | Project | What it is | Stage today | Suite today |
|---|---|---|---|---|
| 1 | [**Queen**](https://github.com/andresanemic/queen) | The marketing agency of the Stellar ecosystem: budgets inside the ceiling it was granted and charges through a **simulated** x402 layer. | Agreement + code + tests | 42 / 45 |
| 2 | **Permamuseum** | Latin American cultural heritage on Stellar, with provenance and permissions. | Idea: a study note, no code | — |
| 3 | [**Casa Firme**](https://github.com/andresanemic/casa-firme) | Housing for informal settlements: authority born in the committee's assembly; every donation leaves a trace. | Agreement + code + tests | 21 / 24 |
| 4 | [**Ficha Contigo**](https://github.com/andresanemic/ficha-contigo) | The clinical record: the institution uses only what the patient granted; emergency access is granted in advance. | Agreement + code + tests | 7 / 13 |
| 5 | [**Cátedra**](https://github.com/andresanemic/catedra) | The university: declared AI use, grades signed by the professor, degrees as verifiable credentials. | Agreement + code + tests | 34 / 35 |
| 6 | **Escribano** | A DAO with a legal record of every change to its contract (Wyoming W.S. 17-31). | Agreement + code + tests | 8 / 13 |
| 7 | [**Llavero**](https://github.com/andresanemic/llavero) | "My data": who asks for it, for what, under which permission, and what was refused. | Agreement + code + tests | 8 / 14 |
| 8 | [**Farolero**](https://github.com/andresanemic/farolero) | Authority for agents without code: delegating only narrows; what does not fit comes back blocked. | Agreement + code + tests | 8 / 13 |
| 9 | **Marea** | Verifying climate commitments between countries (Paris Agreement art. 6.2) without counting a reduction twice. | Agreement + code + tests | 25 / 25 |
| 10 | [**Vela**](https://github.com/andresanemic/vela) | Protecting whoever tells the truth through a legal channel; the zero-knowledge membership proof is pending. | Agreement + code + tests | 10 / 11 |
| — | [**TEMIS**](https://github.com/andresanemic/temis) | Legal validation for bilateral agreements by milestones: signed, counter-signed and anchored so a third party can rebuild what happened. The first real operation of Lore Plugin and Vespi as one. | Whitepaper + MVP: tests 0 to 8 run on Stellar testnet with fictional data (a full lifecycle run twice, 38 transactions, plus concurrent anchors and an idempotent x402 payment); owner's certificate and legal review pending | 135 / 135 |

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
- **The receipt is not durable by itself, and its fingerprint proves integrity, not authenticity.** Whoever calls the kernel owns where it lives, and anyone who can rewrite the receipts can recompute the digest; authenticity belongs to whoever stores and hands them over.
- **No cross-host runtime, scheduler, daemon, migration engine or quota manager.** The continuation semantics are here; what wakes the process is the host's.
- **Not verified:** x402 on mainnet, with more than one provider, or run by someone else; production readiness, regulatory compliance or a stable protocol.

</details>

**Terms.** A **capability** is an available action. A **grant** is the authority for an effect. A **human gate** is the decision surface consulted when the authority is insufficient: not a signature system. A **receipt** is the structured object the operation returns, not automatic durable persistence.

**The bet** *(direction, not current implementation)*: an operation that stays meaningful beyond the lifetime of one model, host or session, with enough state to continue honestly after an interruption. A resource limit should interrupt computation before it interrupts the human. Autonomy is not how long Vespi can run without a human but how much legitimate work it completes without consuming unnecessary human attention. Use the least expensive sufficient intelligence.

**Origin and context.** Vespi grows from work on criterion, continuity and operational authority, not from a payment protocol; x402 on Stellar testnet was the first economic pressure that exposed real authority questions. Find Your Way + Tellus is the current public context and the [HackMeridian event](https://meridian.stellar.org/event-details) a public horizon. No ownership, sponsorship, endorsement, partnership, funding or official affiliation is claimed.

## Quickstart

**Level 1, kernel, nothing external:**

```bash
git clone https://github.com/andresanemic/vespi.git
cd vespi
node --test test/*.test.js                 # ℹ tests 205 · ℹ pass 205 · ℹ fail 0
node scripts/verify-testnet-evidence.mjs   # re-checks the 50 testnet transactions against Horizon (needs a network)
```

The suite covers the operation, bounded authority, multi-person approval, the impossible task, pausing, the human gate, receipts, anchoring states and continuity by receipts. `node --test` alone also runs the x402 demo suite.

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

<a id="español"></a>

**Vespi mantiene viva una operación cuando cambian las personas, los agentes y las herramientas que la rodean.**

> **La unidad no es el agente. La unidad es la operación.**

Vespi es el kernel del sistema operativo de Lore para trabajar con IA, y te permite construir aplicaciones complejas sin que tengas que saber cómo se hace. [Lore Plugin](https://github.com/andresanemic/lore-plugin) prepara el terreno (criterio, Lore, el método del coordinador) y Vespi opera sobre él, ejecutando por ti lo difícil: ciclos hasta terminar el trabajo, desarrollo con la prueba primero, lectores ciegos que juzgan el resultado sin ver cómo se hizo y una verificación hecha por alguien distinto de quien trabajó. Tú dices qué quieres; Vespi mantiene viva la operación bajo una autoridad que otorga una persona y deja un recibo cuyo digest cualquiera puede recalcular para comprobar su integridad. Este repositorio es el **kernel**: JavaScript sin dependencias, sin framework, sin demonio y sin red, construido en parte con Raven MCP (el MCP sobre el directorio de proyectos del ecosistema Stellar). Antes de la `1.0` sus versiones son fotos públicas, no un protocolo estable.

**Por qué.** Construir con IA no debería exigir ser experto en IA. Hoy un agente te dice "terminé" y tienes que creerle, así que solo confía quien puede auditar el trabajo. Queremos que cualquiera con una idea pueda construir software real, se sienta capaz y pueda comprobar lo que se hizo. Vespi hace lo difícil para que la persona no tenga que saberlo.

**¿Construyes en Stellar? Esto es para ti.** Nuestra meta es que Vespi, junto con Lore, se convierta en el sistema operativo definitivo del ecosistema de Stellar: una forma de crear apps en Stellar junto con Raven MCP, de manera rápida, confiable y segura. Invito a cada persona que construye en el ecosistema de Stellar a revisar este kernel y a usarlo si le sirve.

**Si estás evaluando Find Your Way o Meridian, empieza aquí.**

1. **Qué es.** Una idea, en [En un minuto](#en-un-minuto): la unidad es la operación, no el agente.
2. **Por qué es un proyecto de Stellar.** Un pago x402 en vivo de 0,01 USDC [confirmado en Horizon](https://horizon-testnet.stellar.org/transactions/abb968e86d8997f6f555c4efe50dd5a70671dc5064b8220a7f2ea221de7650d5), recibos que se pueden anclar en Stellar y [50 transacciones exitosas en testnet](./docs/TESTNET_EVIDENCE.md) en total. El detalle está en *Evidencia que puedes abrir*.
3. **Compruébalo tú.** La suite corre sin red y sin billetera, y un script le vuelve a preguntar a Horizon por cada transacción. Los comandos están en *Quickstart*.
4. **Mira lo que se construye encima.** Diez proyectos funcionales, cada uno con su acuerdo escrito antes de su código, sobre datos ficcionados, en *Los proyectos funcionales*.
5. **Lo que no afirmamos.** Nada de mainnet, ni un segundo proveedor, ni listo para producción. Está en *Lo que todavía no hace, y lo que no está verificado*.


## En un minuto

Cuando trabajas con un agente, la sesión termina y la siguiente tiene que empezar. Lo que suele sobrevivir es un resumen, y un resumen no dice **quién permitió esto**, **cuánto**, **hasta cuándo**, **a quién** ni **si de verdad ocurrió**. Eso no son detalles de un resumen: son la operación.

Por eso Vespi parte de la operación. Lleva un objetivo y una autoridad que una persona le otorgó (con un reloj, un presupuesto y un destino). El kernel permite como máximo una ejecución por operación y proceso; un resultado incierto queda `not_verified` y nunca se reintenta a ciegas. La verificación sigue **separada**, y el recibo dice qué se cubrió y qué no. Cuando algo cambia, la operación se relee desde sus recibos y continúa solo si la próxima acción sigue de acuerdo con lo pactado; si no, vuelve a la persona.

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

**Cada función y capacidad del kernel, explicada en lenguaje claro y una por una: [`docs/CAPABILITIES.md`](./docs/CAPABILITIES.md).**

**Con IA o sin ella, con blockchain o sin ella.** Al kernel no le importa cuál es tu efecto. Es JavaScript sin dependencias que no habla con ninguna red, así que lo que supervisa puede ser una escritura en una base de datos, una llamada a otro sistema, un paso de un agente de IA o un pago, y valen la misma autoridad, los mismos recibos, la misma puerta humana y la misma continuidad. Stellar es un adaptador, no un requisito: ancla un recibo cuando algo deba poder probarse públicamente, o no toques nunca una blockchain. x402 vive en un solo lugar, [`demo/x402/`](./demo/x402/).

**Pensado para las nuevas leyes de Chile.** Vespi se diseñó pensando en las nuevas leyes chilenas de protección de datos personales (Ley 21.719) y de interoperabilidad de fichas clínicas (Ley 21.668). Un permiso nombra quién puede actuar, sobre qué, hasta cuánto y hasta cuándo; cada acceso y cada rechazo deja un recibo legible; los recibos llevan huellas y comprobaciones con nombre, no el contenido; y el kernel no guarda nada y no llama a ninguna red, así que cada institución conserva sus propios registros. Es intención de diseño, no cumplimiento legal: ninguna autoridad ni abogado lo certificó.

**Por qué las instituciones pueden hacer pilotos.** Es una biblioteca bajo Apache 2.0, sin dependencias y sin servicio alojado, así que un piloto corre dentro del entorno de la propia institución y no hay que entregar nada. Sus permisos tienen la forma que pregunta un equipo de cumplimiento (quién, qué, cuánto, hasta cuándo, quién aprobó), y un auditor puede recalcular la prueba de lo que ocurrió. Espero trabajar pronto con instituciones públicas y privadas para crear las apps que necesitan para coordinarse y trabajar en equipo; los proyectos funcionales son pruebas de concepto de ese tipo de tarea.

**Hacia dónde va.** La meta es que Lore se convierta en el sistema operativo definitivo, a nivel mundial, para trabajar y construir con IA. También estamos evaluando el lanzamiento de un token de Vespi en Stellar. No se ha emitido nada, y cualquier diseño sigue el principio de que el token va al final, y solo si un problema económico lo justifica.

**Cómo usarlo hoy.** El kernel es JavaScript simple: lo importas y envuelves tu efecto. Para empezar a construir con Vespi haciendo vibe coding, instala el kit de [Lore Plugin](https://github.com/andresanemic/lore-plugin) y usa la skill de Vespi que viene dentro. Lore Plugin `2.4.9` y el kernel `0.1.4` se publicarán el lunes 2026-10-05. Instalar Vespi por sí sola como skill de primera parte, sin el resto del kit de Lore, está planeado para el final de Find Your Way; todavía no está disponible.

## Qué es Vespi visto desde fuera: un método

Un encargo se vuelve trabajo que puedes comprobar. Cuando le pides a un agente algo que no es trivial, el coordinador sigue un ciclo, y Vespi hace que cada paso sea algo que puedes verificar en vez de algo que te cuentan: **clasificar el encargo**, **definir terminado** como una observación con nombre, **reunir evidencia** de la fuente primaria, **decidir** (un acto hacia afuera necesita las palabras propias de la persona), **actuar con precisión**, **verificar por observación** aparte de quien lo construyó y **reportar primero el resultado**, con lo que se omitió. El ciclo está escrito una sola vez, para todo el sistema, en [`docs/METHOD.md`](./docs/METHOD.md).

Cada paso aterriza en la operación: el recibo es el reporte (estado, evidencia, `coverage`, `notCovered`), una tarea imposible vuelve `blocked` con su salida en vez de reintentarse a ciegas, y la sesión siguiente retoma desde el último recibo verificado, no desde un resumen.

**Cómo se vio en una operación real.** La primera operación que corrió todo el sistema fue construir TEMIS, una capa que hace comprobables por un tercero los compromisos de un acuerdo bilateral (testnet, datos ficcionados). Un modelo asesor independiente revisó el diseño antes de fijarlo y encontró cuatro huecos. Un modelo trabajador más barato lo implementó viendo solo las pruebas. La verificación, hecha aparte, encontró ocho huecos más que las pruebas del trabajador no cubrían. Un tercer agente, sin acceso al código, reconstruyó todo el registro solo desde el historial público de Stellar (mira *Evidencia que puedes abrir*).

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

Lore Plugin `2.4.9` trae el flujo al kit: un checkpoint por proyecto, tareas por rol con las herramientas que el host realmente expone y la economía de una operación declarada antes de correr. [LUS](https://github.com/andresanemic/lore-plugin/blob/main/docs/LUS_es.md) y Lore Plugin son la genealogía y el criterio de Vespi: Lore Plugin aporta el terreno durable que una operación necesita y Vespi opera dentro de esos límites, sin un segundo camino para aprender o escribir.

## Qué trae el 0.1.3

Publicado como [`v0.1.3-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.3-kernel) (anterior: [`v0.1.2-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.2-kernel)). Todo lo que trae se leyó en el código, no en un plan; las capacidades están explicadas una por una en [`docs/CAPABILITIES.md`](./docs/CAPABILITIES.md). La suite del kernel está en **205/205** y la corrida completa, con la demo x402, en **254/254**. En los commits de la versión (`2dcfd92`, y de nuevo en `7dcec77`) eran 203/203 y 252/252; las dos pruebas añadidas desde entonces revisan la lista de evidencia de testnet.

## Evidencia que puedes abrir

El registro más nuevo es la evidencia en la testnet de Stellar de más abajo. Los primeros experimentos que formaron el kernel (RUN 01 a 05) están en [`experiments/`](./experiments/), con sus lecturas ciegas y los informes del verificador; el RUN 05 está **cerrado** dentro de su alcance local y sin red declarado. Fueron las primeras pruebas, no lo último que se hizo.

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

Los proyectos con código tienen su propio repositorio público, enlazado en la tabla y por ahora sin código, que explica en detalle el porqué, el cómo y el qué: cómo funciona, quién participa y con qué derechos, y qué evidencia tiene. Durante el periodo de revisión de los jueces de la hackatón Find Your Way el código se abre, con una licencia que permite leerlo y clonarlo para evaluar, no modificarlo. La idea es mostrar cómo funciona Vespi, no solo contarlo.

| # | Proyecto | Qué es | Estado hoy | Su suite hoy |
|---|---|---|---|---|
| 1 | [**Queen**](https://github.com/andresanemic/queen) | La agencia de marketing del ecosistema Stellar: presupuesta dentro del techo que se le otorgó y cobra con una capa x402 **simulada**. | Acuerdo + código + pruebas | 42 / 45 |
| 2 | **Permamuseum** | Patrimonio cultural latinoamericano en Stellar, con procedencia y permisos. | Idea: una nota de estudio, sin código | — |
| 3 | [**Casa Firme**](https://github.com/andresanemic/casa-firme) | Vivienda para asentamientos informales: la autoridad nace en la asamblea del comité; cada donación deja rastro. | Acuerdo + código + pruebas | 21 / 24 |
| 4 | [**Ficha Contigo**](https://github.com/andresanemic/ficha-contigo) | La ficha clínica: la institución usa solo lo que el paciente otorgó; el acceso de emergencia se otorga de antemano. | Acuerdo + código + pruebas | 7 / 13 |
| 5 | [**Cátedra**](https://github.com/andresanemic/catedra) | La universidad: uso declarado de IA, notas firmadas por el profesor, títulos como credenciales verificables. | Acuerdo + código + pruebas | 34 / 35 |
| 6 | **Escribano** | Una DAO con registro legal de cada cambio de su contrato (Wyoming W.S. 17-31). | Acuerdo + código + pruebas | 8 / 13 |
| 7 | [**Llavero**](https://github.com/andresanemic/llavero) | «Mis datos»: quién los pide, para qué, bajo qué permiso y qué se rechazó. | Acuerdo + código + pruebas | 8 / 14 |
| 8 | [**Farolero**](https://github.com/andresanemic/farolero) | Autoridad para agentes sin código: delegar solo estrecha; lo que no cabe vuelve bloqueado. | Acuerdo + código + pruebas | 8 / 13 |
| 9 | **Marea** | Verificar compromisos climáticos entre países (Acuerdo de París art. 6.2) sin contar una reducción dos veces. | Acuerdo + código + pruebas | 25 / 25 |
| 10 | [**Vela**](https://github.com/andresanemic/vela) | Proteger a quien dice la verdad por un canal legal; la prueba de conocimiento cero de pertenencia está pendiente. | Acuerdo + código + pruebas | 10 / 11 |
| — | [**TEMIS**](https://github.com/andresanemic/temis) | Validación legal de acuerdos bilaterales por hitos: firmados, contrafirmados y anclados para que un tercero reconstruya lo ocurrido. La primera operación real de Lore Plugin y Vespi como uno. | Whitepaper + MVP: pruebas 0 a 8 corridas en Stellar testnet con datos ficcionados (un ciclo completo corrido dos veces, 38 transacciones, más anclajes concurrentes y un pago x402 idempotente); falta el certificado de su dueño y la revisión jurídica | 135 / 135 |

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
- **El recibo no es durable por sí solo, y su huella prueba integridad, no autenticidad.** Quien llama al kernel decide dónde vive, y quien pueda reescribir los recibos puede recalcular el digest; la autenticidad es de quien los guarda y los entrega.
- **No hay runtime entre hosts, scheduler, demonio, motor de migración ni gestor de cuotas.** La semántica de continuación está aquí; lo que despierta el proceso es del host.
- **No verificado:** x402 en mainnet, con más de un proveedor o corrido por otra persona; preparación para producción, cumplimiento regulatorio o un protocolo estable.

</details>

**Términos.** Una **capability** es una acción disponible. Un **grant** es la autoridad para un efecto. Una **puerta humana** es la superficie de decisión que se consulta cuando la autoridad no basta: no es un sistema de firmas. Un **recibo** es el objeto estructurado que devuelve la operación, no persistencia durable automática.

**La apuesta** *(dirección, no implementación actual)*: una operación que sigue teniendo sentido más allá de la vida de un modelo, un host o una sesión, con estado suficiente para continuar con honestidad tras una interrupción. Un límite de recursos debería interrumpir la computación antes que a la persona. La autonomía no es cuánto tiempo puede operar Vespi sin una persona, sino cuánto trabajo legítimo completa sin consumir atención humana innecesaria. Usa la inteligencia suficiente menos costosa.

**Origen y contexto.** Vespi nace de trabajo sobre criterio, continuidad y autoridad operativa, no de un protocolo de pagos; x402 sobre Stellar testnet fue la primera presión económica que expuso preguntas reales de autoridad. Find Your Way + Tellus es el contexto público actual y el [evento HackMeridian](https://meridian.stellar.org/event-details) un horizonte público. No se reclama propiedad, patrocinio, respaldo, alianza, financiamiento ni afiliación oficial.

## Quickstart

**Nivel 1, kernel, nada externo:**

```bash
git clone https://github.com/andresanemic/vespi.git
cd vespi
node --test test/*.test.js                 # ℹ tests 205 · ℹ pass 205 · ℹ fail 0
node scripts/verify-testnet-evidence.mjs   # vuelve a comprobar las 50 transacciones de testnet contra Horizon (necesita red)
```

La suite cubre la operación, la autoridad acotada, la aprobación de varias personas, la tarea imposible, la pausa, la puerta humana, los recibos, los estados del anclaje y la continuidad por recibos. `node --test` solo también corre la suite de la demo x402.

**Nivel 2, demo x402 acotada en testnet:** mira [`demo/x402/README.md`](./demo/x402/README.md). La ruta pagada necesita una cuenta de testnet con fondos, una línea de confianza a USDC, un receptor, variables de entorno y acceso a red. Un pago en vivo en testnet está verificado; eso es todo lo que certifica.

**¿Por qué publicarlo tan temprano?** Porque la historia es parte de la evidencia: lo que sobrevive, lo que falla, lo que cambia y lo que se rechaza queda a la vista mientras el proyecto todavía se está volviendo a sí mismo.

## Autor

**Andrés Peña Mellado**, Director de Arte Digital y Desarrollador Creativo que trabaja entre agentes de IA, Web3, diseño e investigación.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/) &nbsp;&nbsp; <img src="./assets/icons/v2/discord.svg" width="28" alt="Discord">

---

[Génesis](./docs/GENESIS.md) · [Changelog](./CHANGELOG.md) · [Nota de la versión 0.1.3](./docs/RELEASE_0.1.3_KERNEL.md) · [Método del coordinador](./docs/METHOD.md) · [Experimentos](./experiments/) · [Última etiqueta v0.1.3-kernel](https://github.com/andresanemic/vespi/releases/tag/v0.1.3-kernel) · [Licencia Apache 2.0](./LICENSE) · [NOTICE](./NOTICE)

</details>
