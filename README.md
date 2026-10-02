[![Vespiqueen genesis](./assets/vespiqueen-genesis.png)](./assets/vespiqueen-genesis.png)

# Vespi

<p align="center">
  <a href="#english"><img src="https://img.shields.io/badge/version-v0.1.3--candidate-D7B698?style=for-the-badge&labelColor=07111A" alt="Version: v0.1.3 candidate"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-D7B698?style=for-the-badge&labelColor=07111A" alt="License: Apache 2.0"></a>
  <a href="./docs/GENESIS.md"><img src="https://img.shields.io/badge/status-experimental-E0C170?style=for-the-badge&labelColor=07111A" alt="Status: experimental"></a>
  <a href="./experiments/005/RUN.md"><img src="https://img.shields.io/badge/run-05--closed-E0C170?style=for-the-badge&labelColor=07111A" alt="RUN 05: closed"></a>
  <a href="#what-exists-today"><img src="https://img.shields.io/badge/authority-bounded-D7B698?style=for-the-badge&labelColor=07111A" alt="Bounded authority"></a>
</p>

<p align="center">
  <b>Vespi keeps an operation alive when the people, the agents and the tools around it change.</b><br>
  The kernel of the operating system for working with AI: authority a person grants, a receipt anyone can check, and an operation another agent can pick up tomorrow.<br>
  <a href="https://github.com/andresanemic/lore-plugin">Lore Plugin</a> prepares the ground. Vespi operates on it.
</p>

<p align="center">
  <b>Vespi mantiene viva una operación cuando cambian las personas, los agentes y las herramientas que la rodean.</b><br>
  El kernel del sistema operativo para trabajar con IA: autoridad que otorga una persona, un recibo que cualquiera puede comprobar y una operación que otro agente puede retomar mañana.
</p>

---

<details>
<summary><b>Read in English</b></summary>

<a id="english"></a>

**Vespi keeps an operation alive when the people, the agents and the tools around it change.**

> **The unit is not the agent. The unit is the operation.**

Vespi is a small public experiment in operational continuity under bounded authority, built in public by **Andrés Peña Mellado**. This repository is its **kernel**: dependency-free JavaScript, no framework, no daemon, no network. It is experimental, and it records what exists, what fails, what changes and what is deliberately still unclaimed.

## In one minute

Here is the problem, in plain words.

When you work with an agent, there is a moment when the session ends and the next one has to begin. What usually survives is a summary. A summary does not say **who allowed this to happen**, **how much**, **until when**, **to whom**, or **whether the thing that was supposed to happen actually happened**. Those are not details of a summary; they are the operation.

So Vespi starts from the operation instead of from the agent. An operation carries a goal, an authority that a person granted it — with a clock, a budget and a destination — a way to execute exactly once, a **separate** way to verify, and a receipt that says what was covered and what was not. When something changes, the operation is not restarted from a summary: it is read back from its receipts, and it only continues if what it is about to do is still what was agreed. If it is not, it goes back to the person.

You can see the whole thing run in a minute, offline, with no wallet, no funds, no keys and no network:

```bash
git clone https://github.com/andresanemic/vespi.git
cd vespi
node --test test/*.test.js
```

```
ℹ tests 203
ℹ pass 203
ℹ fail 0
```

<a id="what-exists-today"></a>
## What the 0.1.3 candidate brings

`0.1.3` is a **candidate** release, not a tag: the last tag in this repository is [`v0.1.2-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.2-kernel). Everything below was read in the code of this tree, not in a plan. The kernel suite is **203/203** green at commit `2dcfd92`, reproduced with `node --test test/*.test.js`. The full `node --test` run, including the x402 demo with its dependencies, is **252/252** at that same commit; both scopes are listed in the candidate release note.

- **Authority of several people.** A permission can require several approvals: `authority.signers = { required, allowed }`. The human gate returns **identities, not cryptographic signatures** — `{ approved: true, approvals: [{ by: 'ana' }, { by: 'bob' }] }` — and the kernel counts *distinct* identities drawn from `allowed`. The same identity twice counts once. An identity outside `allowed` does not count. **The operation's own agent never counts.** With fewer approvals than `required`, `perform` is not called and the receipt says how many are missing. Approvals pre-loaded into the authority do not count either: only approvals that arrive through the gate count. Nothing here signs anything; it is a named identity compared in process.
- **Authority with clock, budget and destination.** A grant is `{ asset, maxAmount, to, expiresAt }`. A grant with `to` covers only that destination; a grant without `to` covers any destination but keeps **one** budget, and several requirements spend from that same budget — 400 + 400 against a 500 ceiling is not enough. An expired grant is refused with a reason that names the moment it expired, and `now` is injectable, so the same grant can be exercised on both sides of its own clock.
- **Receipts with a SHA-256 fingerprint and real coverage.** Every receipt carries a `digest`: SHA-256 over the canonical form of the receipt — keys sorted, `digest` and `anchor` excluded — as 64 hex characters. `verifyReceipt` recomputes it, so changing the status, the evidence, the coverage or the detail makes verification fail. **The fingerprint proves integrity, not authenticity:** the digest carries no key, so it proves the receipt was not edited after it was written, and it proves nothing about who wrote it. Anyone able to rewrite the receipts file can recompute it. Authenticity belongs to whoever stores and hands the receipts over, not to the kernel. **Coverage is not a claim:** a check counts as covered only when it came back `true`; a check that came back anything else is listed in `notCovered` by name, next to `external anchor` until there is an external anchor. The receipt's status is one of six values and is the same status the operation returns. Unrecognized evidence fields are dropped.
- **Anchoring on a Stellar network, as an honest interface.** `anchorReceipt(receipt, anchor, verifyAnchor)` climbs three states and skips none: `pending` when nothing reached the network (no adapter, the adapter threw, it named a network the kernel cannot anchor on, or no transaction hash came back), `submitted` when the adapter returned a transaction hash, and `anchored` **only** when `verifyAnchor(txHash, digest, network)` confirms it. A transaction hash on its own is not an anchor. The network is named the way Stellar names it, in CAIP-2: `stellar:testnet` or `stellar:pubnet`, and any other value leaves the receipt in `pending`. The verifier is told which network the anchor claims, because the network passphrase is part of what Stellar signs: an anchor on the testnet cannot be presented as one on mainnet. The kernel does not talk to any network — the adapter is the caller's. A sync and an async path exist, so a real network works, and the digest survives anchoring.
- **The impossible task comes back blocked, with its exit.** A capability can declare `{ impossible: true, reason }` from `required()` — then `perform` is never called — or return it from `perform`. Either way the operation ends `blocked`, the reason travels in the receipt, and the receipt carries an `exit`: the way out, by default *return to the person: change the agreement or cancel*. Running again returns the same receipt without a second attempt.
- **Who can pause is written down.** `authority.pausers` is a list of identities. `pauseOperation(op, who)` throws if `who` is not on it, and the error names who is. Pausing is refused while the operation is running and refused on a terminal one; asking again is a no-op. `resumeOperation` asks the same list. Both leave a `{ state, by, at }` line in the operation's history.
- **The human gate and its four gestures.** The gate opens when the authority on hand does not cover the requirement, and also whenever the authority declares `signers`: a declared multi-person authority is always put to its people, even when the grant already covers the spend, because that grant still needs its named identities to be counted. An operation whose grant already covers it and declares no `signers` runs without asking. What the person receives carries the cost (`requirements` and `cost`), the exit (`exit`), and `publicByDefault: false` — publishing is opt-in. And when the operation declares an agent, an approval whose `by` is that agent is refused: the kernel records that the agent cannot consent for the person, and the operation returns to `needs_human_decision`. Every refusal carries the exit. With no `ask` there is no approval, so the operation stops and asks. The receipt names who approved (`decidedBy`), including when the approval was short of what it needed.
- **Continuity by receipts.** `resumeFromReceipts(receipts, agreement)` takes receipts plus an agreement and answers three questions: what was the last verified state, what is the next action, and does a person have to get involved. Each receipt carries the `action` the agreement names that step by, so a receipt the kernel really produced pairs with a real agreement instead of an id that exists only inside one process. Receipts that do not verify are discarded, and the count is reported. Resuming what was agreed does **not** open the gate. Three things do: a verified receipt for an action outside the agreement, a change to the scope, amount, ceiling or status of the next action, and a last receipt for the next action that was `blocked`, `paused` or `needs_human_decision`. There is no handoff document: any agent, on any host, continues from the receipts.
- **An optional decision model that only advises.** Give the kernel an `io.decide` and it may show a suggestion to the person — only when the probability clears `decideThreshold`, 0.9 by default — attached to the gate payload and marked as coming from the decision model. It never approves: the gate is always answered by the person, and without that answer the capability does not run. A model that throws, times out, misreports or is simply absent leaves the gate untouched. The kernel is identical without it.

## Using it as a laboratory

For pilots, experiments and case studies, the public record is in [`experiments/`](./experiments/):

- [`000-genesis-hive`](./experiments/000-genesis-hive/) — the first bodies and the first receipts.
- [`001-operator-professor-loop`](./experiments/001-operator-professor-loop/RUN.md) — an Operator ↔ Professor loop, with its evidence and its independent arbitration.
- [`002-x402-slice1`](./experiments/002-x402-slice1/RUN.md) — an earlier x402 / Stellar testnet slice with receipts and one real verification failure kept as evidence.
- [`005`](./experiments/005/RUN.md) — the final RUN 05 evaluation, **CLOSED** within its declared local/offline scope, with the blind reads and the verifier reports that closed it.

The paid example lives in [`demo/x402/`](./demo/x402/), and it is the only place that knows x402, Stellar or USDC — an economic capability example, not Vespi's identity. **A live x402 payment on Stellar testnet is verified for this candidate:** on 2026-10-02 the repaired adapter paid 0.01 USDC through the real facilitator, the receipt came back `verified`, and Horizon confirmed the transaction separately (`abb968e86d8997f6f555c4efe50dd5a70671dc5064b8220a7f2ea221de7650d5`, ledger 4988161). It is one payment, on testnet, and its receipt still lists `external anchor` in `notCovered`: no mainnet, no second provider, no one else's run. The receipt is [`demo/x402/receipts/live-testnet-2026-10-02.json`](./demo/x402/receipts/live-testnet-2026-10-02.json). Experiment 002 stays as historical testnet evidence.

## The functional projects

Vespi is a kernel, not an app. What shows it works is what gets built on top of it: ten projects, each with its **own agreement written before its code**, each running on **synthetic data** with no network and no real institution behind it. Their stage below was read on **2026-10-02** by running each project's own test suite against the kernel installed today (the `0.1.3` candidate).

| # | Project | What it is | Stage today | Its suite today |
|---|---|---|---|---|
| 1 | **Queen** | The marketing agency of the Stellar ecosystem: takes a commission, talks to the project through Vespi, budgets inside the ceiling it was granted and charges through a **simulated** x402 layer. | Agreement + code + tests | 42 / 45 |
| 2 | **Permamuseum** | Latin American cultural heritage on Stellar: a museum registers its works, with provenance and permissions. The project this would coordinate already has smart contracts written outside Vespi, with tests that assert nothing yet. | Idea: Vespi has only a study note, no code | — |
| 3 | **Casa Firme** | Housing for informal settlements: authority is born in the housing committee's assembly; volunteers, foundation and municipality enter with different permissions; every donation leaves a trace. | Agreement + code + tests | 21 / 24 |
| 4 | **Ficha Contigo** | The clinical record: the patient hands it to an institution, the institution can use only what was granted, and emergency access is granted in advance. | Agreement + code + tests | 7 / 13 |
| 5 | **Cátedra** | The university: enrolment, work with declared AI use, grades signed by the professor, degrees as verifiable credentials. | Agreement + code + tests | 34 / 35 |
| 6 | **Escribano** | A DAO with a legal record of every change to its contract (Wyoming W.S. 17-31): append-only, each change with its receipt and the signatures the quorum requires. | Agreement + code + tests | 8 / 13 |
| 7 | **Llavero** | "My data": the person sees who asks for it, for what, under which permission; grants or revokes; and reads which access happened and which was refused. | Agreement + code + tests | 8 / 14 |
| 8 | **Farolero** | Authority for agents without code: an organization's agent registry fused with the authority layer. Delegating only narrows; what does not fit comes back blocked with its exit. | Agreement + code + tests | 8 / 13 |
| 9 | **Marea** | Verifying climate commitments between countries (Paris Agreement art. 6.2): the verifier refuses to count the same reduction twice. | Agreement + code + tests | 25 / 25 |
| 10 | **Vela** | Protecting whoever tells the truth through a legal channel: the document is sealed and unpublished until several media sign their verification. It neither leaks nor identifies the source; the zero-knowledge proof of membership is marked pending. | Agreement + code + tests | 10 / 11 |
| — | **TEMIS** | A legal-validation layer for bilateral agreements by milestones: signed, counter-signed and anchored so a third party can rebuild what happened. The first real operation of Lore Plugin and Vespi working as one. | Whitepaper + MVP under construction: canonical form and signatures built, chain, anchoring and payments pending | 56 / 56 (what exists) |

**How to read the last column.** Nine of the ten were built on 2026-09-29 against the kernel cut `54c20c7`, and their own records report them green at that cut; that was not re-run here. Each one pins the kernel it consumes by digest and fails on purpose when the kernel moves, so against the `0.1.3` candidate part of every suite fails until it is re-pinned. That re-pinning is pending, and so is any claim that these ten are ready: today they show a working path, not a finished product. Everything is synthetic: no real people, no real money, no network and no blockchain in the ten projects, and none of them claims to comply with any law. TEMIS is not one of the ten; it is the operation that tests the unit.

## How this was built

Every claim in a repository like this needs a receipt, and a claim without one does not go in. These are the reviews that formed Vespi, each with what it gave:

- **Raven and the Stellar ecosystem.** Raven, the MCP over the ecosystem's project directory, was active during the whole construction: without it x402 and Stellar would not have been possible, and the study it enabled is what showed that the missing piece was not another payment project but a kernel to coordinate the ones that exist. The absence of a tool is not made up with assumptions.
- **The OpenAI report.** [OpenAI — Hugging Face Incident, Technical Report](https://cdn.openai.com/pdf/67869394-cb91-4c12-888c-5cbd85c7814c/OpenAI-Hugging-Face%20Incident-Technical-Report.pdf) gave the direction that an operation is authorized before it acts and not improvised while it acts: agents do organize themselves, what went wrong was the channel that was not authorized and the credential that was shared, a task with no legitimate exit pushes an agent off the edge, and the verification has to live outside the agent.
- **Ultrareview.** [Ultrareview's documentation](https://code.claude.com/docs/en/ultrareview) gave the human gate its four gestures: show the cost first and let the person confirm it, never let the agent give the consent that belongs to the person, keep what goes public optional and off, and name the exit in every refusal.
- **The fly.** The [Eon Systems connectome of the adult fly brain](https://github.com/eonsystemspbc/fly-brain) shows behaviour coming out of structure, with no training and no reward, which is why the kernel governs with structure — agreement, granted authority, separate verification — and does not depend on the model. It enters as a story and nothing else: Vespi is not a brain, and it does not learn.
- **The skills.** The `writing-skills` discipline of [Superpowers](https://github.com/obra/superpowers) (MIT, with credit) gave the kernel its red first: a test that fails before the feature, and a badge that says what actually happened instead of what would be nice to have happened. The separate study of the skill ecosystem gave the rule that a skill is a capability like any other and enters only with written provenance — work that is queued for `0.1.4`.

Reviews launched by the person rather than by the agent — an ultrareview run over this kernel, a security review — enter this repository with their run, report, commit or session log attached, or they do not enter.

## The search in the ecosystem

We did this search so as to offer something new and not repeat what other projects already do. Every project below was read in its own repository and confirmed on **2026-09-28**; their state changes, so the date is part of the claim. Credit, never disparagement: these are good projects and most of them are ahead of us in their own piece.

- [REAPP](https://github.com/mks044/reapp-poc) — signed mandates for agent payments, validated in seven gates and enforced in a Soroban registry. It arrived at the same shape as this kernel from the other side, and is the closest thing in the ecosystem to what `0.1.3` builds: authority before the effect. No license shown in the repository, so it is called as a service, not grafted.
- [Stellar AI Agent Kit](https://github.com/JoseCToscano/stellar-mcp) — turns any Soroban contract into an MCP server, and its policy-contract CLI is authority on chain. It is what makes "Vespi over MCP" more than a wish.
- Trustless Work, Soroban Governor, Teken, Trustful and Chaincerts — escrow by milestones, audited collective governance, multisig, verifiable reputation and verifiable credentials already exist in Stellar. Vespi does not rebuild them; they are its capabilities.
- Eascrow went inactive in 2026-07 after 147,950 USD in funds. A block alone does not hold a product up; what holds it up is someone using it in a real operation.

What came out of it, said as what we saw and with its date: the ecosystem is rich in pieces and no piece coordinates an operation across several people and organizations from beginning to end. That gap is where Vespi sits, and it is a claim about a moving landscape, not a law.

## What it does not do yet

- **`0.1.4` is already scoped and not built:** emergency access granted in advance and exercised with an immediate receipt, a zero-knowledge proof verifier, skill provenance, and x402 live inside the kernel itself (the demo adapter already pays live on testnet). They are not in `0.1.3` because `0.1.3` builds only what all the projects share.
- **The receipt is not durable by itself.** The kernel returns a receipt; whoever calls it owns where it lives. The external anchor is what makes it findable later in a public explorer, and only once verification confirms it.
- **No cross-host runtime, scheduler, migration engine or quota manager.** The continuation semantics are here; the machinery that wakes the process is the host's, and it does not exist here.
- **The six functions of the autonomy gap are not built**, and neither is a stable protocol, production readiness or regulatory compliance.
- **The how of a resumable receipt is not decided yet**: where it lives and what an agent on another host needs to continue without a handoff.

## Terms in this repository

A **capability** is an available action. A **grant** is the authority for an effect. A **human gate** is the decision surface the kernel consults when the authority is insufficient — not a complete authenticated approval workflow, and not a signature system. **Provenance** records where a result or a decision came from. A **receipt** is the structured object the operation returns, not automatic durable persistence. A **criterion** is the governing standard used to judge the operation.

## The bet

> **DIRECTION, NOT CURRENT IMPLEMENTATION.**

The bet is an operation that stays meaningful beyond the lifetime of one model, host or session, with enough state to continue honestly after an interruption.

### Continuity

An operation that survives changes of model, changes of host, quota or capacity exhaustion, interruptions, capability failures, and reconstruction from durable state — while preserving the goal, the authority, the evidence, the provenance, the verification state and the conditions for human intervention. A model, host or provider may disappear without the operation ceasing to exist. **Direction, not current implementation:** Vespi owns the continuation semantics; the host may own waking the process. `resumeFromReceipts` is the first piece of that semantics, not the whole of it.

### Mechanical interruption is not human interruption

> **A resource limit should interrupt computation before it interrupts the human.**

### Attention is finite

> **Autonomy is not how long Vespi can operate without a human. It is how much legitimate work it can complete without consuming unnecessary human attention.**

Waiting, asking or stopping can be the correct result of an operation.

### Model and capability economy

> **Use the least expensive sufficient intelligence. Escalation must be earned.**

A capability may be local, host-native, external or paid. Its economic form does not define Vespi.

### Honest uncertainty

> **We do not yet know how much of this requires something specifically called Vespi. Some of it may reduce to good state, policy, routing, host capabilities and verification. That is part of the experiment.**

The bet can be strong and still falsable. We do not invent "that Vespi" to justify the name.

## Relationship to [Lore Plugin](https://github.com/andresanemic/lore-plugin)

> **Lore Plugin prepares the ground. Vespi operates on it.**

Vespi is a separate technical repository. [LUS](https://github.com/andresanemic/lore-plugin/blob/main/docs/LUS_en.md) and [Lore Plugin](https://github.com/andresanemic/lore-plugin) are part of its genealogy and its criterion. In the intended division of labor, Lore Plugin provides the durable ground an operation needs — goal and state, the relevant criterion and owner, the authority boundary, evidence and provenance — and Vespi operates inside those boundaries. It does not replace Lore Plugin and it does not create a second path for learning or writing.

## Origin, catalyst, pressure, horizon

- **ORIGIN: [LUS](https://github.com/andresanemic/lore-plugin/blob/main/docs/LUS_en.md) + [Lore Plugin](https://github.com/andresanemic/lore-plugin).** Vespi grows from work on criterion, continuity and operational authority, not from a payment protocol.
- **CATALYST / CURRENT PUBLIC PRESSURE: Find Your Way + Tellus.** Context and evaluation pressure only. No ownership, sponsorship, endorsement, partnership, funding or official affiliation is claimed.
- **FIRST EXERCISED ECONOMIC PRESSURE: x402 + Stellar testnet.** Payment is a pressure that exposed real authority questions; it is not the project's origin.
- **HORIZON: Meridian / HackMeridian 2026.** The [HackMeridian event](https://meridian.stellar.org/event-details) is context and a public horizon, not a claim of ownership, sponsorship, endorsement, partnership, funding or official affiliation.

## Not verified

- x402 on mainnet, with more than one provider, or a live payment run by someone else;
- automatic durable receipt persistence or persistent memory;
- a general orchestration runtime, universal scheduler, daemon, migration engine or quota manager;
- production readiness, regulatory compliance or a stable protocol;
- a claim that Vespi is a crypto payment agent, a Tellus product, a hackathon-created project, or an app backed by the Stellar Development Foundation or by any university.

## Quickstart

**Level 1 — kernel, nothing external.** Clone and run:

```bash
node --test test/*.test.js
```

The suite covers the operation, bounded authority with clock, budget and destination, multi-person approval, the impossible task, pausing, the four gestures of the human gate, receipts with a SHA-256 fingerprint and real coverage, the three states of anchoring, and continuity by receipts. `node --test` alone also runs the x402 demo suite. No wallet, no funds, no network.

**Level 2 — bounded x402 testnet demo.** See [`demo/x402/README.md`](./demo/x402/README.md). The paid route needs a funded testnet account, a USDC trustline, a receiver, environment variables and network access. The rejection route stops before contacting the endpoint. One live testnet payment is verified (see above); that is all it certifies.

## Why publish this early?

Because the history is part of the evidence. Vespi should not arrive later with a polished origin story. What survives, what fails, what changes and what gets rejected should stay inspectable while the project is still becoming itself.

## Author

**Andrés Peña Mellado**

Digital Art Director & Creative Developer working across AI agents, Web3, design and research.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/) &nbsp;&nbsp; <img src="./assets/icons/v2/discord.svg" width="28" alt="Discord">

---

[Genesis](./docs/GENESIS.md) · [Changelog](./CHANGELOG.md) · [0.1.3 candidate note](./docs/RELEASE_0.1.3_KERNEL.md) · [Coordinator method](./docs/METHOD.md) · [Experiments](./experiments/) · [Last tag v0.1.2-kernel](https://github.com/andresanemic/vespi/releases/tag/v0.1.2-kernel) · [Apache 2.0 License](./LICENSE) · [NOTICE](./NOTICE)

</details>

<details>
<summary><b>Leer en español</b></summary>

<a id="español"></a>

**Vespi mantiene viva una operación cuando cambian las personas, los agentes y las herramientas que la rodean.**

> **La unidad no es el agente. La unidad es la operación.**

Vespi es un pequeño experimento público de continuidad operacional bajo autoridad acotada, construido en público por **Andrés Peña Mellado**. Este repositorio es su **kernel**: JavaScript sin dependencias, sin framework, sin demonio y sin red. Es experimental, y conserva lo que existe, lo que falla, lo que cambia y lo que sigue deliberadamente sin reclamar.

## En un minuto

Este es el problema, en llano.

Cuando trabajas con un agente, hay un momento en que la sesión termina y la siguiente tiene que empezar. Lo que sobrevive suele ser un resumen. Un resumen no dice **quién autorizó esto**, **cuánto**, **hasta cuándo**, **a quién**, ni **si lo que debía pasar de verdad pasó**. Eso no son detalles de un resumen: es la operación.

Por eso Vespi parte de la operación y no del agente. Una operación lleva un objetivo, una autoridad que una persona le otorgó —con reloj, presupuesto y destino—, una forma de ejecutarse exactamente una vez, una forma **separada** de verificar y un recibo que dice qué cubrió y qué no. Cuando algo cambia, la operación no se reinicia desde un resumen: se relee desde sus recibos, y solo continúa si lo que está a punto de hacer sigue siendo lo acordado. Si no lo es, vuelve a la persona.

Puedes verlo completo en un minuto, sin conexión, sin wallet, sin fondos, sin llaves y sin red:

```bash
git clone https://github.com/andresanemic/vespi.git
cd vespi
node --test test/*.test.js
```

```
ℹ tests 203
ℹ pass 203
ℹ fail 0
```

<a id="que-existe-hoy"></a>
## Qué trae el 0.1.3 candidato

`0.1.3` es una versión **candidata**, no una etiqueta: la última etiqueta de este repositorio es [`v0.1.2-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.2-kernel). Todo lo que sigue se leyó en el código de este árbol, no en un plan. La suite del kernel está en **203/203** en el commit `2dcfd92`, corrida con `node --test test/*.test.js`. La suite completa `node --test`, incluida la demo x402 con sus dependencias, quedó en **252/252** en ese mismo commit; ambas coberturas están en la nota candidata.

- **Autoridad de varias personas.** Un permiso puede exigir varias aprobaciones: `authority.signers = { required, allowed }`. La puerta humana devuelve **identidades, no firmas criptográficas** — `{ approved: true, approvals: [{ by: 'ana' }, { by: 'bob' }] }` — y el kernel cuenta identidades *distintas* tomadas de `allowed`. La misma identidad dos veces cuenta una sola vez. Una identidad fuera de `allowed` no cuenta. **El agente de la operación nunca cuenta.** Con menos aprobaciones que `required`, `perform` no se llama y el recibo dice cuántas faltan. Las aprobaciones cargadas de antemano en la autoridad tampoco cuentan: solo cuentan las que llegan por la puerta. Aquí no se firma nada; es una identidad nombrada comparada en el proceso.
- **Autoridad con reloj, presupuesto y destino.** Un grant es `{ asset, maxAmount, to, expiresAt }`. Un grant con `to` cubre solo ese destino; uno sin `to` cubre cualquier destino pero conserva **un** presupuesto, y varias exigencias gastan de ese mismo presupuesto — 400 + 400 contra un techo de 500 no alcanza. Un grant vencido se rechaza con una razón que nombra el momento en que venció, y `now` es inyectable, así que el mismo grant se puede ejercitar a los dos lados de su propio reloj.
- **Recibos con huella SHA-256 y cobertura real.** Cada recibo trae un `digest`: SHA-256 sobre la forma canónica del recibo —claves ordenadas, `digest` y `anchor` excluidos— como 64 caracteres hexadecimales. `verifyReceipt` lo recalcula, así que cambiar el estado, la evidencia, la cobertura o el detalle hace fallar la verificación. **La huella prueba integridad, no autenticidad:** el digest no lleva clave, así que prueba que el recibo no se editó después de escribirse, y no prueba quién lo escribió. Cualquiera que pueda reescribir el archivo de recibos puede recalcularlo. La autenticidad le toca a quien guarda y entrega los recibos, no al kernel. **La cobertura no es una afirmación:** un chequeo cuenta como cubierto solo cuando volvió `true`; un chequeo que volvió otra cosa aparece en `notCovered` por su nombre, junto a `external anchor` mientras no haya anclaje externo. El estado del recibo es uno de seis valores y es el mismo estado que devuelve la operación. Los campos de evidencia no reconocidos se descartan.
- **Anclaje en una red de Stellar, como interfaz honesta.** `anchorReceipt(receipt, anchor, verifyAnchor)` sube por tres estados y no salta ninguno: `pending` cuando nada llegó a la red (no hay adaptador, el adaptador lanzó, nombró una red en la que el kernel no puede anclar, o no volvió hash de transacción), `submitted` cuando el adaptador devolvió un hash, y `anchored` **solo** cuando `verifyAnchor(txHash, digest, network)` lo confirma. Un hash por sí solo no es un anclaje. La red se nombra como la nombra Stellar, en CAIP-2: `stellar:testnet` o `stellar:pubnet`, y cualquier otro valor deja el recibo en `pending`. El verificador recibe en qué red dice estar el anclaje, porque la contraseña de red es parte de lo que Stellar firma: un anclaje en la red de pruebas no puede presentarse como uno de la red principal. El kernel no habla con ninguna red: el adaptador lo aporta quien lo usa. Hay un camino síncrono y uno asíncrono, así que una red real funciona, y el digest sobrevive al anclaje.
- **La tarea imposible vuelve bloqueada, con su salida.** Una capability puede declarar `{ impossible: true, reason }` desde `required()` —entonces `perform` no se llama nunca— o devolverlo desde `perform`. En los dos casos la operación termina `blocked`, la razón viaja en el recibo y el recibo trae una `exit`: la salida, por defecto *return to the person: change the agreement or cancel*. Correr de nuevo devuelve el mismo recibo sin un segundo intento.
- **Quién puede pausar está escrito.** `authority.pausers` es una lista de identidades. `pauseOperation(op, who)` lanza error si `who` no está en ella, y el error nombra quién sí. Pausar se rechaza mientras la operación corre y se rechaza en una terminal; preguntar otra vez no hace nada. `resumeOperation` pregunta la misma lista. Las dos dejan una línea `{ state, by, at }` en el historial de la operación.
- **La puerta humana y sus cuatro gestos.** La puerta se abre cuando la autoridad disponible no cubre lo exigido, y también siempre que la autoridad declare `signers`: una autoridad de varias personas declarada se le pregunta a esas personas aunque el grant ya cubra el gasto, porque ese grant igual necesita sus identidades nombradas para contar. Una operación cuyo grant ya cubre el gasto y no declara `signers` corre sin preguntar. Lo que recibe la persona lleva el costo (`requirements` y `cost`), la salida (`exit`) y `publicByDefault: false` —publicar es opcional—. Y cuando la operación declara un agente, se rechaza una aprobación cuyo `by` sea ese agente: el kernel deja escrito que el agente no puede consentir por la persona, y la operación vuelve a `needs_human_decision`. Todo rechazo lleva la salida. Sin `ask` no hay aprobación, así que la operación se detiene y pregunta. El recibo nombra quién aprobó (`decidedBy`), también cuando la aprobación quedó incompleta.
- **Continuidad por recibos.** `resumeFromReceipts(receipts, agreement)` recibe recibos más un acuerdo y contesta tres preguntas: cuál fue el último estado verificado, cuál es la siguiente acción y si hace falta que entre una persona. Cada recibo lleva la `action` con la que el acuerdo nombra ese paso, así que un recibo que produjo el kernel se empareja con un acuerdo real y no con un id que solo existe dentro de un proceso. Los recibos que no verifican se descartan, y el número se reporta. Retomar lo acordado **no** abre la puerta. Tres cosas sí la abren: un recibo verificado de una acción fuera del acuerdo, un cambio en el alcance, la cantidad, el techo o el estado de la siguiente acción, y un último recibo de esa acción que fuera `blocked`, `paused` o `needs_human_decision`. No hay documento de traspaso: cualquier agente, en cualquier host, continúa desde los recibos.
- **Un modelo de decisión opcional que solo aconseja.** Si le das al kernel un `io.decide`, puede mostrar una sugerencia a la persona —solo cuando la probabilidad supera `decideThreshold`, 0.9 por defecto— pegada al payload de la puerta y marcada como venida del modelo de decisión. Nunca aprueba: la puerta siempre la contesta la persona, y sin ese sí la capability no corre. Un modelo que lanza, expira, miente o simplemente no está deja la puerta intacta. El kernel es idéntico sin él.

## Usarlo como laboratorio

Para pilotos, experimentos y casos de estudio, el registro público está en [`experiments/`](./experiments/):

- [`000-genesis-hive`](./experiments/000-genesis-hive/) — los primeros cuerpos y los primeros recibos.
- [`001-operator-professor-loop`](./experiments/001-operator-professor-loop/RUN.md) — un loop Operator ↔ Professor, con su evidencia y su arbitraje independiente.
- [`002-x402-slice1`](./experiments/002-x402-slice1/RUN.md) — una slice anterior de x402 / Stellar en testnet, con recibos y un fallo de verificación real conservado como evidencia.
- [`005`](./experiments/005/RUN.md) — la evaluación final de RUN 05, **CLOSED** dentro de su alcance local/offline declarado, con las lecturas ciegas y los reportes del verificador que la cerraron.

El ejemplo pagado vive en [`demo/x402/`](./demo/x402/), y es el único lugar que conoce x402, Stellar o USDC: un ejemplo de capability económica, no la identidad de Vespi. **Un pago x402 live en Stellar testnet está verificado para este candidato:** el 2026-10-02 el adaptador reparado pagó 0,01 USDC a través del facilitator real, el recibo volvió `verified` y Horizon confirmó la transacción por separado (`abb968e86d8997f6f555c4efe50dd5a70671dc5064b8220a7f2ea221de7650d5`, ledger 4988161). Es un solo pago, en testnet, y su recibo todavía lista `external anchor` en `notCovered`: sin mainnet, sin un segundo proveedor, sin la corrida de otra persona. El recibo es [`demo/x402/receipts/live-testnet-2026-10-02.json`](./demo/x402/receipts/live-testnet-2026-10-02.json). El experimento 002 queda como evidencia histórica de testnet.

## Los proyectos funcionales

Vespi es un kernel, no una aplicación. Lo que demuestra que funciona es lo que se construye encima: diez proyectos, cada uno con **su propio acuerdo escrito antes de su código**, cada uno sobre **datos sintéticos**, sin red y sin una institución real detrás. El estado de abajo se leyó el **2026-10-02** corriendo la suite de cada proyecto contra el kernel instalado hoy (el candidato `0.1.3`).

| # | Proyecto | Qué es | Estado hoy | Su suite hoy |
|---|---|---|---|---|
| 1 | **Queen** | La agencia de marketing del ecosistema Stellar: recibe un encargo, conversa con el proyecto a través de Vespi, presupuesta dentro del techo que le otorgaron y cobra con una capa x402 **simulada**. | Acuerdo + código + pruebas | 42 / 45 |
| 2 | **Permamuseum** | Patrimonio cultural latinoamericano en Stellar: un museo registra sus obras, con procedencia y permisos. El proyecto que esto coordinaría ya tiene contratos escritos fuera de Vespi, con pruebas que todavía no afirman nada. | Idea: en Vespi solo hay una nota de estudio, sin código | — |
| 3 | **Casa Firme** | Vivienda en campamentos: la autoridad nace en la asamblea del comité de vivienda; voluntarios, fundación y municipio entran con permisos distintos; cada donación deja su rastro. | Acuerdo + código + pruebas | 21 / 24 |
| 4 | **Ficha Contigo** | La ficha clínica: la paciente la entrega a una institución, la institución usa solo lo que se le otorgó y el acceso de emergencia se otorga por adelantado. | Acuerdo + código + pruebas | 7 / 13 |
| 5 | **Cátedra** | La universidad: matrícula, trabajos con uso de IA declarado, notas firmadas por el profesor y títulos como credenciales verificables. | Acuerdo + código + pruebas | 34 / 35 |
| 6 | **Escribano** | Una DAO con registro legal de cada cambio de su contrato (Wyoming, W.S. 17-31): solo se agrega, y cada cambio entra con su recibo y las firmas que exige el quórum. | Acuerdo + código + pruebas | 8 / 13 |
| 7 | **Llavero** | «Mis datos»: la persona ve quién los pide, para qué y bajo qué permiso; concede o revoca; y lee qué acceso ocurrió y cuál se rechazó. | Acuerdo + código + pruebas | 8 / 14 |
| 8 | **Farolero** | Autoridad para agentes sin código: el registro de agentes de una organización fusionado con la capa de autoridad. Delegar solo reduce; lo que no cabe vuelve bloqueado con su salida. | Acuerdo + código + pruebas | 8 / 13 |
| 9 | **Marea** | Verificación de compromisos climáticos entre países (Acuerdo de París, art. 6.2): el verificador se niega a contar dos veces la misma reducción. | Acuerdo + código + pruebas | 25 / 25 |
| 10 | **Vela** | Proteger a quien dice la verdad por un canal legal: el documento queda sellado y sin publicar hasta que varios medios firmen su verificación. No filtra ni identifica a la fuente; la prueba de conocimiento cero de pertenencia está marcada como pendiente. | Acuerdo + código + pruebas | 10 / 11 |
| — | **TEMIS** | Una capa de validación legal para acuerdos bilaterales por hitos: firmados, contrafirmados y anclados para que un tercero reconstruya lo ocurrido. La primera operación real de Lore Plugin y Vespi trabajando como una unidad. | Whitepaper + MVP en construcción: forma canónica y firmas hechas; cadena, anclaje y pagos pendientes | 56 / 56 (lo que existe) |

**Cómo leer la última columna.** Nueve de los diez se construyeron el 2026-09-29 contra el corte `54c20c7` del kernel, y sus propios registros los dan en verde en ese corte; aquí no se volvió a correr. Cada uno fija por digest el kernel que consume y falla a propósito cuando el kernel se mueve, así que contra el candidato `0.1.3` parte de cada suite falla hasta que se re-ancle. Ese re-anclaje está pendiente, y también cualquier afirmación de que los diez estén listos: hoy muestran un recorrido que funciona, no un producto terminado. Todo es sintético: sin personas reales, sin dinero real, sin red y sin blockchain en los diez proyectos, y ninguno afirma cumplir ley alguna. TEMIS no es uno de los diez: es la operación que prueba la unidad.

## Cómo se construyó

Toda afirmación en un repositorio así necesita un recibo, y la que no lo tiene no entra. Estas son las revisiones que formaron a Vespi, cada una con qué dio:

- **Raven y el ecosistema Stellar.** Raven, el MCP sobre el directorio de proyectos del ecosistema, estuvo activo durante toda la construcción: sin él no se habrían podido hacer x402 y Stellar, y el estudio que habilitó mostró que lo que faltaba no era otro proyecto de pagos sino un kernel que coordine los que ya existen. La ausencia de una herramienta no se compensa suponiendo lo que habría respondido.
- **El informe de OpenAI.** [OpenAI — Hugging Face Incident, Technical Report](https://cdn.openai.com/pdf/67869394-cb91-4c12-888c-5cbd85c7814c/OpenAI-Hugging-Face%20Incident-Technical-Report.pdf) dio la dirección de que una operación se autoriza antes de actuar y no se improvisa mientras actúa: los agentes sí se organizan, lo que salió mal fue el canal no autorizado y la credencial compartida, una tarea sin salida legítima empuja al agente fuera del borde, y la verificación tiene que vivir fuera del agente.
- **Ultrareview.** [La documentación de Ultrareview](https://code.claude.com/docs/en/ultrareview) dio a la puerta humana sus cuatro gestos: mostrar el costo primero y que lo confirme la persona, nunca dejar que el agente dé el consentimiento que le toca a la persona, mantener lo que sale a lo público opcional y apagado, y nombrar la salida en todo rechazo.
- **La mosca.** El [conectoma de Eon Systems del cerebro de la mosca adulta](https://github.com/eonsystemspbc/fly-brain) muestra conducta que sale de la estructura, sin entrenamiento y sin recompensa, que es la razón por la que el kernel gobierna con estructura —acuerdo, autoridad otorgada, verificación separada— y no depende del modelo. Entra como relato y nada más: Vespi no es un cerebro y no aprende.
- **Las skills.** La disciplina `writing-skills` de [Superpowers](https://github.com/obra/superpowers) (MIT, con crédito) le dio al kernel su rojo primero: un test que falla antes de la característica, y un badge que dice lo que pasó de verdad en vez de lo que estaría bien que hubiera pasado. El estudio aparte del ecosistema de skills dio la regla de que una skill es una capability como cualquier otra y entra solo con procedencia escrita: un trabajo que ya está en la cola del `0.1.4`.

Las revisiones que lanza la persona y no el agente —una corrida de ultrareview sobre este kernel, una revisión de seguridad— entran a este repositorio con su corrida, su reporte, su commit o su registro de sesión adjunto, o no entran.

## La búsqueda en el ecosistema

Hicimos esta búsqueda para ofrecer algo nuevo y no repetir lo que otros proyectos ya hacen. Cada proyecto de abajo se leyó en su propio repositorio y se confirmó el **2026-09-28**; su estado cambia, así que la fecha es parte de la afirmación. Crédito, nunca comparación despectiva: son buenos proyectos y en su propia pieza la mayoría nos va por delante.

- [REAPP](https://github.com/mks044/reapp-poc) — mandatos firmados para pagos de agentes, validados en siete puertas y ejecutados en un registro de Soroban. Llegó por su lado a la misma forma que este kernel, y es lo más cerca que hay en el ecosistema de lo que construye el `0.1.3`: autoridad antes del efecto. No muestra licencia en el repositorio, así que se llama como servicio y no se injerta.
- [Stellar AI Agent Kit](https://github.com/JoseCToscano/stellar-mcp) — convierte cualquier contrato de Soroban en un servidor MCP, y su CLI de contratos de política es autoridad en cadena. Es lo que vuelve «Vespi por MCP» algo más que un deseo.
- Trustless Work, Soroban Governor, Teken, Trustful y Chaincerts — el escrow por hitos, la gobernanza colectiva auditada, la multifirma, la reputación verificable y las credenciales verificables ya existen en Stellar. Vespi no los reconstruye: son sus capabilities.
- Eascrow se apagó en 2026-07 después de 147.950 USD en fondos. Un bloque solo no sostiene un producto; lo que lo sostiene es que alguien lo use en una operación real.

Lo que sale de ahí, dicho como lo que vimos y con su fecha: el ecosistema es rico en piezas y ninguna pieza coordina una operación entre varias personas y organizaciones de principio a fin. Ese hueco es donde se sienta Vespi, y es una afirmación sobre un paisaje que se mueve, no una ley.

## Lo que todavía no hace

- **El `0.1.4` ya está acotado y no está construido:** acceso de emergencia otorgado por adelantado y ejercido con recibo inmediato, un verificador de pruebas de conocimiento cero, procedencia de skills y x402 en vivo dentro del propio kernel (el adaptador de la demo ya paga en vivo en testnet). No están en el `0.1.3` porque el `0.1.3` construye solo lo que comparten todos los proyectos.
- **El recibo no es durable por sí solo.** El kernel devuelve un recibo; quien lo llama decide dónde vive. El anclaje externo es lo que lo hace encontrable después en un explorador público, y solo una vez que la verificación lo confirma.
- **No hay runtime cross-host, scheduler, migration engine ni quota manager.** La semántica de continuación está aquí; la maquinaria que despierta el proceso es del host, y aquí no existe.
- **Las seis funciones del autonomy gap no están construidas**, y tampoco hay un protocolo estable, producción lista ni cumplimiento regulatorio.
- **El cómo de un recibo retomable no está decidido todavía:** dónde vive y qué necesita un agente de otro host para continuar sin traspaso.

## Términos de este repositorio

Una **capability** es una acción disponible. Un **grant** es la autoridad para un efecto. Una **puerta humana** es la superficie de decisión que el kernel consulta cuando la authority no basta: no es un workflow completo de aprobación autenticada, ni un sistema de firmas. La **provenance** registra de dónde viene un resultado o una decisión. Un **recibo** es el objeto estructurado que devuelve la operación, no persistencia durable automática. Un **criterion** es el estándar que gobierna la operación.

## LA APUESTA

> **DIRECCIÓN, NO IMPLEMENTACIÓN ACTUAL.**

La apuesta es una operación que conserve significado más allá de la vida de un solo modelo, host o sesión, con suficiente estado para continuar honestamente después de una interrupción.

### Continuidad

Una operación que sobrevive cambios de modelo, cambios de host, agotamiento de cuota o capacidad, interrupciones, capability failures y reconstrucción desde estado durable, conservando el goal, la authority, la evidencia, la provenance, el verification state y las condiciones de intervención humana. Un modelo, host o proveedor puede desaparecer sin que eso implique que la operación dejó de existir. **Dirección, no implementación actual:** Vespi posee la semántica de continuación; el host puede encargarse de despertar el proceso. `resumeFromReceipts` es la primera pieza de esa semántica, no toda ella.

### Una interrupción mecánica no es una interrupción humana

> **Un límite de recursos debería interrumpir el cómputo antes de interrumpir al humano.**

### La atención es un recurso finito

> **La autonomía no es cuánto tiempo puede operar Vespi sin un humano. Es cuánto trabajo legítimo puede completar sin consumir atención humana innecesaria.**

Esperar, preguntar o detenerse puede ser el resultado correcto de una operación.

### Economía de modelos y capabilities

> **Usa la inteligencia suficiente más barata. La escalación debe ganarse.**

Una capability puede ser local, host-native, external o paid. Su forma económica no define Vespi.

### Honestidad sobre la incertidumbre

> **Todavía no sabemos cuánto de esto requiere algo específicamente llamado Vespi. Parte puede reducirse a buen estado, policy, routing, capabilities del host y verificación. Descubrir ese residuo es parte del experimento.**

La apuesta puede ser fuerte y seguir siendo falsable. No inventamos «ese Vespi» para justificar la marca.

## Relación con [Lore Plugin](https://github.com/andresanemic/lore-plugin)

> **Lore Plugin prepara el terreno. Vespi opera sobre él.**

Vespi es un repositorio técnico separado. [LUS](https://github.com/andresanemic/lore-plugin/blob/main/docs/LUS_es.md) y [Lore Plugin](https://github.com/andresanemic/lore-plugin) son parte de su genealogía y de su criterio. En la división de trabajo prevista, Lore Plugin aporta el suelo durable que una operación necesita —goal y estado, el criterion y owner relevantes, la frontera de authority y evidence/provenance— y Vespi opera dentro de esos límites. No reemplaza a Lore Plugin ni crea un segundo camino de aprendizaje o escritura.

## Origen, catalizador, presión y horizonte

- **ORIGEN: [LUS](https://github.com/andresanemic/lore-plugin/blob/main/docs/LUS_es.md) + [Lore Plugin](https://github.com/andresanemic/lore-plugin).** Vespi crece del trabajo sobre criterio, continuidad y authority operacional, no de un protocolo de pagos.
- **CATALIZADOR / PRESIÓN PÚBLICA ACTUAL: Find Your Way + Tellus.** Son contexto y presión de evaluación. No se reclama ownership, sponsorship, endorsement, partnership, funding ni afiliación oficial.
- **PRIMERA PRESIÓN ECONÓMICA EJERCITADA: x402 + Stellar testnet.** El pago es una presión que expuso preguntas reales de authority; no es el origen del proyecto.
- **HORIZONTE: Meridian / HackMeridian 2026.** El [evento HackMeridian](https://meridian.stellar.org/event-details) es contexto y horizonte público, no una reclamación de ownership, sponsorship, endorsement, partnership, funding ni afiliación oficial.

## NO VERIFICADO

- x402 en mainnet, con más de un proveedor, o un pago live corrido por otra persona;
- persistencia durable automática de recibos o memoria persistente;
- un runtime general de orchestration, scheduler universal, daemon, migration engine o quota manager;
- production readiness, cumplimiento regulatorio o un protocolo estable;
- una afirmación de que Vespi es un agente de pagos crypto, un producto de Tellus, un proyecto creado por una hackatón, o una app respaldada por la Stellar Development Foundation o por una universidad.

## Quickstart / ruta de evaluación

**Nivel 1 — kernel, nada externo.** Clona y ejecuta:

```bash
node --test test/*.test.js
```

La suite cubre la operación, la authority acotada con reloj, presupuesto y destino, la aprobación de varias personas, la tarea imposible, la pausa, los cuatro gestos de la puerta humana, los recibos con huella SHA-256 y cobertura real, los tres estados del anclaje y la continuidad por recibos. `node --test` a secas también corre la suite de la demo x402. No requiere wallet, fondos ni red.

**Nivel 2 — demo acotada de x402 en testnet.** Consulta [`demo/x402/README.md`](./demo/x402/README.md). La ruta pagada requiere una cuenta testnet fondeada, trustline USDC, receptor, variables de entorno y acceso a red. La ruta de rechazo se detiene antes de contactar el endpoint. Hay un pago live en testnet verificado (ver arriba); eso es todo lo que certifica.

## ¿Por qué publicarlo tan temprano?

Porque la historia también es evidencia. Vespi no debería aparecer después con un relato de origen perfecto. Lo que sobrevive, lo que falla, lo que cambia y lo que se rechaza debería quedar inspeccionable mientras el proyecto todavía se está convirtiendo en sí mismo.

## Autor

**Andrés Peña Mellado**

Digital Art Director & Creative Developer trabajando entre agentes de IA, Web3, diseño e investigación.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/) &nbsp;&nbsp; <img src="./assets/icons/v2/discord.svg" width="28" alt="Discord">

---

[Génesis](./docs/GENESIS.md) · [Changelog](./CHANGELOG.md) · [Nota del candidato 0.1.3](./docs/RELEASE_0.1.3_KERNEL.md) · [Método del coordinador](./docs/METHOD.md) · [Experimentos](./experiments/) · [Última etiqueta v0.1.2-kernel](https://github.com/andresanemic/vespi/releases/tag/v0.1.2-kernel) · [Licencia Apache 2.0](./LICENSE) · [NOTICE](./NOTICE)

</details>
