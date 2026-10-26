<p align="center">
  <a href="./assets/vespiqueen-genesis.png"><img src="./assets/vespiqueen-genesis.png" alt="Vespiqueen genesis" width="100%"></a>
</p>

<h1 align="center">Vespi</h1>

<p align="center">
  <a href="./docs/RELEASE_0.1.8_KERNEL.md"><img src="https://img.shields.io/badge/version-v0.1.8-D7B698?style=for-the-badge&labelColor=07111A" alt="Version: v0.1.8"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-D7B698?style=for-the-badge&labelColor=07111A" alt="License: Apache 2.0"></a>
  <a href="./docs/SUITE_RESULT_0.1.8.txt"><img src="https://img.shields.io/badge/suite-1319_pass-E0C170?style=for-the-badge&labelColor=07111A" alt="Release suite: 1,319 passed, 0 failed"></a>
  <a href="#the-projects"><img src="https://img.shields.io/badge/projects-11_public_repos-D7B698?style=for-the-badge&labelColor=07111A" alt="11 functional project repositories"></a>
  <a href="./docs/TESTNET_EVIDENCE.md"><img src="https://img.shields.io/badge/testnet-50_readbacks_%C2%B7_5_semantic-E0C170?style=for-the-badge&labelColor=07111A" alt="50 testnet readbacks; 5 cases semantically verified"></a>
  <a href="./demo/x402/"><img src="https://img.shields.io/badge/demo-x402_%C2%B7_Stellar_SDK-E0C170?style=for-the-badge&labelColor=07111A" alt="Opt-in x402 demo using the Stellar SDK"></a>
  <a href="./data/traffic/clones.json"><img src="https://img.shields.io/badge/Vespi-1478_clones_in_29_days-E0C170?style=for-the-badge&labelColor=07111A" alt="1,478 clones of this repository, Sep 27 to Oct 25, 2026 (UTC) (GitHub traffic, recorded daily; clones, not unique people)"></a>
</p>

<p align="center"><b>The engine for building apps with AI on Stellar. You drive.</b><br>You talk to the AI, it builds, and you decide what matters. What you learn stays for next time.<br>And it lets you verify what AI agents do on Stellar: a payment approved by a person before it happens and checked against the public ledger after, proven on mainnet with a real Pollar payment ([evidence](./demo/pollar)).<br>We want Vespi to be the kernel for building apps on Stellar.</p>

<p align="center"><a href="https://vespi.xyz"><b>Website</b></a> · <a href="https://www.youtube.com/watch?v=g2iw29M6WI0"><b>Watch the demo</b></a> · <a href="./docs/JUDGE_IN_3_MINUTES.md"><b>Judge in 3 minutes</b></a> · <a href="#clone-and-run">Clone and run</a> · <a href="./docs/FOR_JUDGES.md">For judges</a> · <a href="./docs/TESTNET_EVIDENCE.md">Testnet evidence</a> · <a href="https://vespi.xyz/pollar"><b>Pollar evidence</b></a> · <a href="./demo/testnet/"><b>Pay on testnet yourself</b></a></p>
<p align="center">Pitch deck: <a href="https://drive.google.com/file/d/17QqE47pEcvkdMGAdxhLGhuN3DsQLwdoU/view?usp=sharing">EN</a> · <a href="https://drive.google.com/file/d/1FQKIuHDerpsy7hDXTIwlC-LdiEcMba1Y/view?usp=sharing">ES</a> &nbsp;|&nbsp; One pager: <a href="https://drive.google.com/file/d/1JAQ6Yi8dPNQYTpOJssJo5hNJhCcDDcuA/view?usp=drive_link">EN</a> · <a href="https://drive.google.com/file/d/1_yfvaRmnWssK3v0c8NH3w5_UK1B3Fb3b/view?usp=sharing">ES</a> &nbsp;|&nbsp; <a href="https://drive.google.com/drive/folders/1X_en3D33AC_BSeEBXRyepdfZWDGckRqm?usp=sharing">Letters of intent</a></p>


---

**Where this is going.** Today you run Vespi from a terminal. **Hive**, a creation studio for building apps with agents, is planned; it is not installable yet. An interactive proof of concept, with fictional data, is on [vespi.xyz](https://vespi.xyz). A Linux distribution remains a distant possibility.

## Clone and run

The kernel runs on Node.js 24 or later and has no runtime dependencies. This repository is a source checkout, not a root-level npm package. The commands below pin `meridian-2026-10-26`, including the event payment demo. The original library release remains at `v0.1.8-kernel`.

```sh
git clone --branch meridian-2026-10-26 --depth 1 https://github.com/andresanemic/vespi.git
cd vespi
node examples/walkthrough.js
```

At the prompt, enter `Ada: approve`. Inspect the receipt’s `status`, `coverage` and `notCovered` fields.

See what an agent is not allowed to do: `node examples/refusal.js` refuses an over-limit operation with no effect, then runs one inside the grant and leaves a receipt.

**Make a real Stellar payment yourself, behind the human gate.** The default flow creates fresh testnet accounts. Added during HackMeridian (26 October 2026), it is included in the checkout above. From the repository root:

```sh
npm --prefix demo/testnet ci
node demo/testnet/pay.cjs
```

The demo shows you the hash of the one transaction its signing capability may sign after the kernel gate receives your yes. The kernel then reads the ledger and checks that the transaction on chain is the one you approved. The same flow ran on Stellar mainnet on 26 October 2026: the demo signing capability signed a 0.0001 XLM payment only after the kernel gate received a person’s approval for its hash, and the ledger shows that approved transaction (tx [`b402c623…d98f`](https://stellar.expert/explorer/public/tx/b402c62307e0c50fb859969a21a8e1277ed1c29899b19f79ee6f557f9a93d98f)). To re-verify the three real mainnet transactions, read-only and with no install: `node demo/testnet/pay.cjs --verify-mainnet`. Details in [demo/testnet](./demo/testnet/).

> Run it before you believe it.

**What "experimental" means here.** The kernel is a 0.1 source library. The walkthrough runs offline; the payment demos use Stellar testnet and mainnet. Three real mainnet transactions from 25–26 October 2026 show a Pollar payment, the anchor of a separate receipt, and a payment signed by the demo only after a person approved its transaction hash. [Read the payment evidence](./demo/testnet/). The host supplies trusted ports and stores receipts; approval names are labels rather than identity signatures, and budgets apply per operation. [Judge it in 3 minutes](./docs/JUDGE_IN_3_MINUTES.md).

<details>
<summary><b>Read in English</b></summary>

<a id="english"></a>

## What you can do fast with Vespi

Start with one operation and keep the proof. Every line says how far it has been checked today.

- **Leave a verifiable record of what an agent did.** The receipt carries a SHA-256 digest, the authority that was granted and used, what was checked and what was not. *Proven.*
- **Timestamp that record on Stellar.** Put the receipt's digest in a transaction memo so the ledger shows when it existed. *Testnet:* the saved evidence compares the declared digest, ledger and source account with Horizon, using fictional data. *Mainnet:* on 25 October 2026 one receipt digest (`71f58fc2…`) was anchored in a real transaction, as both a hash memo and a `manage_data` entry: tx `2ff744c69fc01c0de2016e45c5f157b0434382572f2dfc997e8e1d4e34af09d7`, ledger 65133489.
- **Pay for a service within a ceiling and with a person's approval (x402).** *Demo* on testnet, outside the kernel.
- **Check a zero-knowledge proof inside an operation** and keep its receipt. *Reference* verification; apps built on zero-knowledge proofs are a direction, not something this release ships.
- **Register a batch of things in one transaction,** for example the 100 diskettes of the Meridian fanzine. *Planned:* described as a plan until the transaction exists.
- **Use the kit for a project of your own with AI** — for example an app, a website, writing or research. [Lore Plugin](https://github.com/andresanemic/lore-plugin) keeps your criteria, workflows and preferences as files on your computer, so what you start with one agent can continue in the next session.

## What you can do today

- [Install Lore Plugin](https://github.com/andresanemic/lore-plugin) — the kit you work with

## What the kernel can do

| Capability | Status |
|---|---|
| Permission before acting — the agent does only what you allowed and asks when permission is missing | Proven |
| Spending with a ceiling: asset, amount, destination and expiry | Proven |
| A second review: another checks the result. The agent does not grade itself | Proven |
| Continuity: the next session picks up from what was already checked, and the uncertain returns to you | Proven |
| x402 paid-effect contract, tested with synthetic ports; a demo adapter outside the kernel uses the Stellar SDK on testnet (the SDK bridge inside the kernel is deferred) | Demo |
| A 0.01 USDC payment and 50 transactions saved on Stellar testnet | Testnet |
| Zero-knowledge proof verification | Reference |
| Delegation, emergency permissions and skill provenance | Proven |

## Stellar architecture at a glance

- **Networks.** Stellar mainnet for three operations on 25–26 October 2026; testnet for the earlier evidence ([50 readbacks from Horizon](./docs/TESTNET_EVIDENCE.md)) and the [x402 demo](./demo/x402/).
- **Asset.** Native XLM. **Contracts:** none; the kernel deploys no Soroban contract.
- **Wallets.** A Pollar-managed wallet (`GALQPWE7…`) paid 0.0001 XLM to a LOBSTR wallet (`GDS6AO6U…CO36`); the fee was sponsored. Tx `52759df5db949d6bd9b506de0081f7bddb5254bb374de8f682b5a1e507e37bb2`, ledger 65134379.
- **Integrations and APIs.** The Pollar SDK (`@pollar/core` 0.12.0, in the browser) executes the payment after the kernel's human gate opens; the kernel then reads the transaction from the Horizon API and compares destination, amount and asset ([demo/pollar](./demo/pollar)). x402 runs on testnet.
- **Anchor.** A receipt digest (`71f58fc2…`) written as a hash memo and a `manage_data` entry: tx `2ff744c69fc01c0de2016e45c5f157b0434382572f2dfc997e8e1d4e34af09d7`, ledger 65133489.
- **Environment variables.** None for `examples/walkthrough.js`; the Pollar flow needs a Pollar account and a local kernel process.

## The projects

One person built these eleven projects with Vespi in about a week (29 September – 3 October 2026); ten run the Vespi kernel. Each explores what you can build this way, with its problem, its evidence and its limits. Their code is public in each repository since 10 October 2026, under a review-only license.

- [Queen](https://github.com/andresanemic/queen) — a budget proposal is often unclear: who asked, who could answer, what the price covers
- [Permamuseum](https://github.com/andresanemic/permamuseum) — in a museum, "verified" mixes claim, evidence and permission
- [Casa Firme](https://github.com/andresanemic/casa-firme) — a family should not hand over its identity to prove what happened
- [Ficha Contigo](https://github.com/andresanemic/ficha-contigo) — a patient cannot see who opened their clinical record
- [Cátedra](https://github.com/andresanemic/catedra) — academic records are scattered and nobody sees who authorised what
- [Escribano](https://github.com/andresanemic/escribano) — a public contract shows today's rule, not who changed it
- [Llavero](https://github.com/andresanemic/llavero) — consent to use your data gets lost inside organisations
- [Farolero](https://github.com/andresanemic/farolero) — give an AI agent a vague instruction and nobody knows what it was allowed
- [Marea](https://github.com/andresanemic/marea) — two countries can report the same climate reduction twice
- [Vela](https://github.com/andresanemic/vela) — a source hands over evidence and risks being exposed
- [TEMIS](https://github.com/andresanemic/temis) — two people sign an agreement and later cannot tell who did what

All with fictional data and no real money: most run as local walkthroughs, and Stellar testnet evidence belongs only to the projects that declare it (TEMIS and Permamuseum), not to all eleven. Rerun from fresh clones on 25 October 2026: 399 tests pass across the eleven repositories ([record](./docs/PROJECT_SUITES_2026-10-25.md)).

---

## How it works

You arrive with an idea. You talk to the AI and it builds together. The AI does not approve everything on reflex: it tells you what it thinks works and what does not, and does not take away your important decisions. What you learn is written down for the next session, so you do not start from zero, and you do not hand over what the system can carry for you.

**Lore Plugin, the kit**

- Start your project with it: its agreement and its files, in your own folder.
- Save what you learn: when you correct the AI, the reason becomes a criterion you review before anything is written.
- It brings what matters: each task loads the criterion it needs, in Claude Code, Codex or OpenCode.
- It keeps it alive: review, prune and retire what is no longer useful.
- Carry Vespi inside, for the work that needs permissions and continuity.
- It does not train the model. Everything stays as legible text you can take to another tool.

**Vespi, the kernel**

- Permission before acting: the agent does only what you allowed and asks when permission is missing.
- Spending with a ceiling: limits per asset, amount, destination and expiry.
- A second review: another checks the result. The agent does not grade itself.
- Continuity: the next session picks up from what was already checked, and the uncertain returns to you.
- Payments with x402: a contract for an agent to pay a service under the conditions you set, tested with synthetic ports. A demo adapter outside the kernel runs it on Stellar testnet with the Stellar SDK; the SDK bridge inside the kernel is deferred.
- Also: zero-knowledge proof verification, anchors on Stellar, delegation, emergency permissions and skill provenance.

---

## What the kernel is

Vespi keeps authority, checked result and next agreed action together when work changes hands. You resume what still holds; an uncertain exercised effect returns to you for reconciliation.

Kernel 0.1.8 is a dependency-free JavaScript source library. It is an engine for Stellar apps across 11 functional explorations. Chain evidence in those projects is Stellar testnet with fictional data, no real money; the projects that declare no network (such as Queen and Vela) are local walkthroughs. The integrated demos have three real mainnet transactions from 25–26 October 2026: a payment of 0.0001 XLM with Pollar under the human gate, verified on the ledger with a receipt (tx `52759df5db949d6bd9b506de0081f7bddb5254bb374de8f682b5a1e507e37bb2`, ledger 65134379), the receipt anchor above, and the payment signed after approval of its hash on 26 October (tx `b402c62307e0c50fb859969a21a8e1277ed1c29899b19f79ee6f557f9a93d98f`, ledger 65139109). The Pollar flow is a demo in [`demo/pollar`](./demo/pollar), outside the kernel library, with its tests and the receipt.

### Start with an operation

The [offline walkthrough](./docs/WALKTHROUGH.md) runs without installing dependencies for the kernel. To run the complete suite, install the x402 demo’s dependencies from its folder, then run the tests and offline evidence check:

```sh
(cd demo/x402 && npm ci)   # required by the complete suite
node --test "test/*.test.js"
node scripts/verify-testnet-evidence.mjs --offline
```

The walkthrough's [test](./test/walkthrough.test.js) checks an observed local effect and a next action selected in another process, but the receipt is passed to that process explicitly: this does not demonstrate automatic transfer, durable storage or authenticated human identity. The current source includes [the 0.1.7 maintenance release](./docs/TODO_RESOLUTION.md). The [saved suite result](./docs/SUITE_RESULT_0.1.8.txt) records the command, exact counts, Node version and Git baseline for this release. The [judge guide](./docs/FOR_JUDGES.md) explains how to reproduce the evidence and its limits.

### Authority, a human gate and receipts

The kernel is JavaScript without runtime dependencies. A capability declares its requirements; the operation checks authority before `perform`, asks the human gate when required and obtains a separate verification result. [Authority tests](./test/k2.test.js) cover asset, ceiling, destination, expiry and distinct named approvals, but ordinary approval names are labels rather than authenticated signatures and money budgets are not accumulated across operations. The host controls its tools, identities, clock and storage.

[Receipt tests](./test/k3.test.js) cover the SHA-256 digest, named successful checks and omissions, but the digest proves integrity rather than authenticity and can be recomputed by anyone who rewrites the receipt. An external anchor requires a separate confirmation of digest and network. `buildReceipt({ anchorNetwork })` accepts `stellar:testnet` (the default) or `stellar:pubnet`; unsupported networks throw. The test fixtures use fictional data and testnet. The three real mainnet transactions of 25–26 October can be re-verified using the [payment demos](./demo/testnet/).

[The capability catalog](./docs/CAPABILITIES.md) explains the API and host responsibilities.

Kernel 0.1.8 binds an approved context to its approval and receipt, and rechecks it before an effect. Checkpoints preserve bounded authority when a host resumes an operation; the host supplies authentic storage and a minimum accepted generation. This version also changes the receiver contract of host callbacks. Read the [callback contract and migration note](./docs/HOST_CALLBACKS.md) before adapting an existing 0.1.7 host; see the [0.1.8 release evidence and adoption limits](./docs/RELEASE_0.1.8_KERNEL.md).

### Evidence you can open

[The evidence file](./docs/testnet-evidence.json) records 50 successful testnet transactions read back from Horizon, with 5 cases semantically verified and 45 partially verified, and 0 discrepancies. Expectations come from local execution records rather than Horizon; partial checks do not fill in missing facts. [The evidence guide](./docs/TESTNET_EVIDENCE.md) owns the transaction links, field coverage and historical payment details, including the 0.1.3 adapter's saved x402 receipt. That history is historical evidence for the earlier adapter only. Check file shape offline with `node scripts/verify-testnet-evidence.mjs --offline`; the guide also provides a comparison against saved responses and an optional network refresh.

### Lore Plugin and the build method

[Lore Plugin](https://github.com/andresanemic/lore-plugin) supplies criterion and the coordinator workflow; Vespi supplies the authority and receipt semantics around an operation. The [method](./docs/METHOD.md) describes loops, test-first work, specifications, bounded delegation, blind reading and separate verification; it is a workflow for host tools, not a kernel that generates apps or images itself. Lore Plugin carries a pinned kernel, so this source snapshot does not update an installed kit automatically.

The agreement keeps its order. Its purpose is to preserve your agency and avoid repeated decisions; its method coordinates bounded authority, a human gate and receipts; each operation's concrete result must be checked. The [verification record](./docs/VERIFICATION.md), [judge findings from the earlier cut](./docs/JUDGES_FINDINGS_0.1.4.md), [prior-art notes](./docs/PRIOR_ART.md) and [experiments](./experiments/) retain construction history. Model reviews independent of the builders are not an external security audit. The method credits [The Fable Method](https://github.com/Sahir619/fable-method); Raven MCP, Stellar and the Lore/LUS work belong to the construction narrative, not proof that the whole product operates autonomously.

### Where the pieces fit

| Project | Its focus | Lore Plugin + Vespi today |
|---|---|---|
| [TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) | Shared, governed agent memory, skills, wiki and code graphs | Human-approved project criteria plus bounded operations and receipts |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | An agent runtime with persistent memory and skills | Criteria carried across supported hosts; operation authority outside any one agent runtime |
| [Obsidian](https://obsidian.md/help/data-storage) | Local Markdown notes and linked knowledge | A workflow for promoting experience into agent-readable criteria with approval |
| [Graphify](https://github.com/Graphify-Labs/graphify) / [CodeGraph](https://github.com/colbymchenry/codegraph/blob/main/site/src/content/docs/getting-started/introduction.md) | Queryable code structure; Graphify also maps documents | Maintained project criteria and authority for concrete operations |

This compares current scope, not head-to-head results. The complete end-to-end path remains to be demonstrated.

### Author and license

Andrés Peña Mellado, Digital Art Director & Creative Developer.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/)

Kernel license: [Apache-2.0](./LICENSE), with attribution in [NOTICE](./NOTICE). The kernel is and will stay open source under Apache 2.0; future releases will not move to a restrictive license.

</details>

---

<details>
<summary><b>Leer en español</b></summary>

<a id="espanol"></a>

## Lo que puedes hacer rápido con Vespi

Empieza con una operación y guarda la prueba. Cada línea dice hasta dónde está comprobado hoy.

- **Deja un registro verificable de lo que hizo un agente.** El recibo lleva una huella SHA-256, la autoridad que se concedió y se usó, lo que se comprobó y lo que no. *Probado.*
- **Ponle fecha a ese registro en Stellar.** Pon la huella del recibo en el memo de una transacción para que el libro muestre cuándo existía. *Testnet:* la evidencia guardada compara la huella declarada, el ledger y la cuenta de origen con Horizon, con datos ficticios. *Mainnet:* el 25 de octubre de 2026 se ancló la huella de un recibo (`71f58fc2…`) en una transacción real, como memo hash y como entrada `manage_data`: tx `2ff744c69fc01c0de2016e45c5f157b0434382572f2dfc997e8e1d4e34af09d7`, ledger 65133489.
- **Paga un servicio dentro de un techo y con la aprobación de una persona (x402).** *Demo* en testnet, fuera del kernel.
- **Comprueba una prueba de conocimiento cero dentro de una operación** y guarda su recibo. Verificación de *Referencia*; las apps construidas sobre pruebas de conocimiento cero son una dirección, no algo que esta versión entregue.
- **Registra un conjunto de cosas en una sola transacción,** por ejemplo los 100 diskettes del fanzine de Meridian. *Planeado:* se describe como un plan hasta que exista la transacción.
- **Usa el kit para un proyecto propio con IA:** por ejemplo una app, un sitio, escritura o investigación. [Lore Plugin](https://github.com/andresanemic/lore-plugin) guarda tu criterio, tus workflows y tus preferencias como archivos en tu computador, así que lo que empiezas con un agente puede continuar en la siguiente sesión.

## Lo que puedes hacer hoy

- [Instala Lore Plugin](https://github.com/andresanemic/lore-plugin) — el kit con el que trabajas

## Lo que puede hacer el kernel

| Capacidad | Estado |
|---|---|
| Permiso antes de actuar: el agente hace solo lo que permitiste y te pregunta cuando falta permiso | Probado |
| Gasto con techo: límites por activo, monto, destino y vencimiento | Probado |
| Una segunda revisión: otro comprueba el resultado. El agente no se califica a sí mismo | Probado |
| Continuidad: la siguiente sesión sigue desde lo ya comprobado, y lo incierto vuelve a ti | Probado |
| Contrato de pago x402 probado con puertos sintéticos; un adaptador de demo fuera del kernel usa el SDK de Stellar en testnet (el puente con el SDK dentro del kernel está diferido) | Demo |
| Un pago de 0,01 USDC y 50 transacciones guardadas en la testnet de Stellar | Testnet |
| Verificación de pruebas de conocimiento cero | Referencia |
| Delegación, permisos de emergencia y procedencia de skills | Probado |

## Arquitectura Stellar de un vistazo

- **Redes.** Stellar mainnet para tres operaciones del 25–26 de octubre de 2026; testnet para la evidencia anterior ([50 relecturas desde Horizon](./docs/TESTNET_EVIDENCE.md)) y la [demo x402](./demo/x402/).
- **Activo.** XLM nativo. **Contratos:** ninguno; el kernel no despliega contratos Soroban.
- **Wallets.** Una wallet gestionada por Pollar (`GALQPWE7…`) pagó 0,0001 XLM a una wallet LOBSTR (`GDS6AO6U…CO36`), con comisión patrocinada. Tx `52759df5db949d6bd9b506de0081f7bddb5254bb374de8f682b5a1e507e37bb2`, ledger 65134379.
- **Integraciones y APIs.** El SDK de Pollar (`@pollar/core` 0.12.0, en el navegador) ejecuta el pago cuando se abre la puerta humana del kernel; después el kernel lee la transacción desde la API de Horizon y compara destino, monto y activo ([demo/pollar](./demo/pollar)). x402 corre en testnet.
- **Ancla.** El digest de un recibo (`71f58fc2…`) escrito como memo hash y como entrada `manage_data`: tx `2ff744c69fc01c0de2016e45c5f157b0434382572f2dfc997e8e1d4e34af09d7`, ledger 65133489.
- **Variables de entorno.** Ninguna para `examples/walkthrough.js`; el flujo con Pollar necesita una cuenta de Pollar y un proceso local del kernel.

## Los proyectos

Una persona construyó estos once proyectos con Vespi en una semana (29 de septiembre – 3 de octubre de 2026); diez corren el kernel de Vespi. Once proyectos exploran qué puedes construir así, cada uno con su problema, su evidencia y sus límites. Su código es público en cada repositorio desde el 10 de octubre de 2026, con licencia de solo revisión.

- [Queen](https://github.com/andresanemic/queen) — una propuesta de presupuesto suele ser confusa: quién pidió, quién podía responder, qué cubre el precio
- [Permamuseum](https://github.com/andresanemic/permamuseum) — en un museo, «verificado» mezcla afirmación, evidencia y permiso
- [Casa Firme](https://github.com/andresanemic/casa-firme) — una familia no debería entregar su identidad para probar qué pasó
- [Ficha Contigo](https://github.com/andresanemic/ficha-contigo) — una paciente no ve quién abrió su ficha clínica
- [Cátedra](https://github.com/andresanemic/catedra) — los registros académicos están dispersos y nadie ve quién autorizó qué
- [Escribano](https://github.com/andresanemic/escribano) — un contrato público muestra la regla de hoy, no quién la cambió
- [Llavero](https://github.com/andresanemic/llavero) — el permiso para usar tus datos se pierde dentro de las organizaciones
- [Farolero](https://github.com/andresanemic/farolero) — le das una instrucción vaga a un agente y nadie sabe qué podía hacer
- [Marea](https://github.com/andresanemic/marea) — dos países pueden reportar dos veces la misma reducción climática
- [Vela](https://github.com/andresanemic/vela) — una fuente entrega evidencia y corre el riesgo de quedar expuesta
- [TEMIS](https://github.com/andresanemic/temis) — dos personas firman un acuerdo y después no saben quién cumplió qué

Todos con datos ficticios y sin dinero real: la mayoría corre como recorrido local, y la evidencia en la testnet de Stellar pertenece solo a los proyectos que la declaran (TEMIS y Permamuseum), no a los once. Reejecutadas desde clones frescos el 25 de octubre de 2026: 399 pruebas pasan en los once repositorios ([registro](./docs/PROJECT_SUITES_2026-10-25.md)).

## Cómo se trabaja

Llegas con una idea. Conversas con la IA y la construyen juntos. La IA no aprueba todo de reflejo: te dice qué cree que funciona y qué no, y no te quita las decisiones importantes. Lo que aprendes queda escrito para la próxima sesión, así no empiezas de cero, y no entregas a mano lo que el sistema puede llevar por ti.

**Lore Plugin, el kit**

- Empieza tu proyecto con él: su acuerdo y sus archivos, en tu propia carpeta.
- Guarda lo que aprendes: cuando corriges a la IA, la razón se vuelve un criterio que revisas antes de que se escriba.
- Lo trae cuando importa: cada tarea carga el criterio que necesita, en Claude Code, Codex u OpenCode.
- Lo mantiene vivo: revisa, poda y retira lo que ya no sirve.
- Lleva Vespi adentro, para el trabajo que necesita permisos y continuidad.
- No entrena el modelo. Todo queda como texto legible que puedes llevar a otra herramienta.

**Vespi, el kernel**

- Permiso antes de actuar: el agente hace solo lo que permitiste y te pregunta cuando falta permiso.
- Gasto con techo: límites por activo, monto, destino y vencimiento.
- Una segunda revisión: otro comprueba el resultado. El agente no se califica a sí mismo.
- Continuidad: la siguiente sesión sigue desde lo ya comprobado, y lo incierto vuelve a ti.
- Pagos con x402: un contrato para que un agente pague un servicio con las condiciones que fijaste, probado con puertos sintéticos. Un adaptador de demo fuera del kernel lo corre en la testnet de Stellar con el SDK de Stellar; el puente con el SDK dentro del kernel está diferido.
- Además: verificación de pruebas de conocimiento cero, anclajes en Stellar, delegación, permisos de emergencia y procedencia de skills.

## Qué es el kernel

Vespi conserva juntas la autoridad, el resultado comprobado y la siguiente acción acordada cuando el trabajo cambia de manos. Retomas lo que sigue valiendo; un efecto ejercido incierto vuelve a ti para reconciliarlo.

El kernel 0.1.8 es una biblioteca fuente JavaScript sin dependencias. La aprobación conserva su contexto en la operación y el recibo, y el kernel lo comprueba antes de un efecto. Un checkpoint conserva autoridad acotada al retomar; el host aporta almacenamiento auténtico y una generación mínima aceptada. Los callbacks se invocan sin receptor: si un host depende de `this`, debe pasar una flecha, clausura o función ligada. Consulta el [contrato de migración](./docs/HOST_CALLBACKS.md) y la [evidencia de 0.1.8](./docs/RELEASE_0.1.8_KERNEL.md). Es un motor de apps Stellar en 11 exploraciones funcionales. La evidencia de cadena de esos proyectos es testnet con datos ficticios, sin dinero real; los proyectos que no declaran red (como Queen y Vela) son recorridos locales. Las demos integradas tienen tres transacciones reales en mainnet del 25–26 de octubre de 2026: un pago de 0,0001 XLM con Pollar bajo la puerta humana, verificado en el ledger y con recibo (tx `52759df5db949d6bd9b506de0081f7bddb5254bb374de8f682b5a1e507e37bb2`, ledger 65134379), el ancla del recibo de arriba y el pago firmado tras aprobar su hash el 26 de octubre (tx `b402c62307e0c50fb859969a21a8e1277ed1c29899b19f79ee6f557f9a93d98f`, ledger 65139109). El flujo de Pollar es una demo en [`demo/pollar`](./demo/pollar), fuera de la biblioteca del kernel, con sus pruebas y el recibo.

## Empieza con una operación

Los comandos siguientes fijan `meridian-2026-10-26`, con la demo de pago del evento. El release original de la biblioteca conserva `v0.1.8-kernel`.

Desde una copia de código de este repositorio, con Node.js 24 disponible, corre el [recorrido local](./docs/WALKTHROUGH.md), responde a la terminal con tu nombre seguido de `: approve` y revisa `status`, `coverage` y `notCovered` del recibo:

```sh
git clone --branch meridian-2026-10-26 --depth 1 https://github.com/andresanemic/vespi.git
cd vespi
node examples/walkthrough.js
```

El demo x402 tiene dependencias propias. Instálalas solo si vas a correr la suite completa:

```sh
(cd demo/x402 && npm ci)
node --test "test/*.test.js"
node scripts/verify-testnet-evidence.mjs --offline
```

[La prueba del recorrido](./test/walkthrough.test.js) comprueba un efecto local observado y la selección de la siguiente acción en otro proceso, pero el recibo se pasa explícitamente a ese proceso: no demuestra transporte automático, almacenamiento durable ni identidad humana autenticada. El código actual incluye [el mantenimiento del corte 0.1.7](./docs/TODO_RESOLUTION.md). [El resultado guardado de la suite](./docs/SUITE_RESULT_0.1.8.txt) registra el comando, los conteos exactos, la versión de Node y la base Git de esta versión. [La guía para jueces](./docs/FOR_JUDGES.md) explica cómo reproducir la evidencia y sus límites.

## Autoridad, puerta humana y recibos

El kernel es JavaScript sin dependencias de runtime. Una capacidad declara sus requisitos; la operación comprueba autoridad antes de `perform`, consulta la puerta humana cuando corresponde y recibe una verificación separada. [Las pruebas de autoridad](./test/k2.test.js) cubren activo, techo, destino, vencimiento y aprobaciones con nombres distintos, pero los nombres de aprobación ordinaria son etiquetas y no firmas autenticadas, y los presupuestos de dinero no se acumulan entre operaciones. El host controla herramientas, identidades, reloj y almacenamiento.

[Las pruebas de recibos](./test/k3.test.js) cubren el digest SHA-256, comprobaciones exitosas con nombre y omisiones, pero el digest demuestra integridad y no autenticidad, y cualquiera que reescriba el recibo puede recalcularlo. Un ancla externa exige confirmar por separado digest y red. `buildReceipt({ anchorNetwork })` acepta `stellar:testnet` (el valor por defecto, sin cambio) o `stellar:pubnet`; una red no admitida produce un error. El ancla pendiente no prueba interacción con una red y su network no entra al digest del recibo. Los fixtures usan datos ficticios y testnet. Las tres transacciones reales mainnet del 25–26 de octubre pueden releerse con las [demos de pago](./demo/testnet/).

[El catálogo de capacidades](./docs/CAPABILITIES.md) explica la API y las responsabilidades del host.

## Evidencia que puedes abrir

[El archivo de evidencia](./docs/testnet-evidence.json) registra 50 transacciones exitosas en testnet leídas de Horizon, con 5 casos verificados semánticamente, 45 parcialmente verificados y 0 discrepancias. Las expectativas vienen de registros locales de ejecución y no de Horizon; las comprobaciones parciales no completan hechos ausentes. [La guía de evidencia](./docs/TESTNET_EVIDENCE.md) contiene los enlaces de transacciones, la cobertura por campos y los detalles de pagos históricos, incluido el recibo x402 del adaptador de 0.1.3. Esa historia es evidencia histórica de aquel adaptador. Comprueba la forma del archivo sin red con `node scripts/verify-testnet-evidence.mjs --offline`; la guía también permite comparar respuestas guardadas y volver a consultar la red de forma opcional.

## Lore Plugin y el método de construcción

[Lore Plugin](https://github.com/andresanemic/lore-plugin) aporta el criterio y el flujo del coordinador; Vespi aporta la semántica de autoridad y recibos alrededor de una operación. [El método](./docs/METHOD.md) describe ciclos, pruebas primero, especificaciones, delegación acotada, lectura ciega y verificación separada; es un flujo de trabajo para herramientas del host, no un kernel que genere apps o imágenes por sí solo. Lore Plugin lleva una copia fija del kernel, por lo que este corte de código no actualiza automáticamente un kit instalado.

El acuerdo conserva su orden. La finalidad es cuidar tu agencia y evitar decisiones repetidas; el método coordina autoridad acotada, puerta humana y recibos; el resultado concreto debe comprobarse en cada operación. [El registro de verificación](./docs/VERIFICATION.md), [los hallazgos de jueces del corte anterior](./docs/JUDGES_FINDINGS_0.1.4.md), [las notas de arte previo](./docs/PRIOR_ART.md) y [los experimentos](./experiments/) conservan la historia de construcción. Las revisiones por modelos independientes de sus constructores no son una auditoría de seguridad externa. El método acredita [The Fable Method](https://github.com/Sahir619/fable-method); Raven MCP, Stellar y el trabajo de Lore/LUS pertenecen al relato de construcción, no prueban que el producto completo opere de forma autónoma.

### Cómo encajan las piezas

| Proyecto | Su foco | Lore Plugin + Vespi hoy |
|---|---|---|
| [TencentDB Agent Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory) | Memoria, skills, wiki y grafos de código compartidos y gobernados | Criterio de proyecto aprobado por la persona, más operaciones acotadas y recibos |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Un agente con memoria persistente y skills | Criterio portable entre hosts compatibles; autoridad de operación fuera de un agente concreto |
| [Obsidian](https://obsidian.md/help/data-storage) | Notas Markdown locales y conocimiento enlazado | Un flujo que convierte experiencia en criterio legible por agentes, con aprobación |
| [Graphify](https://github.com/Graphify-Labs/graphify) / [CodeGraph](https://github.com/colbymchenry/codegraph/blob/main/site/src/content/docs/getting-started/introduction.md) | Estructura de código consultable; Graphify también mapea documentos | Criterio de proyecto mantenido y autoridad para operaciones concretas |

La tabla compara alcances actuales, no resultados de una prueba cara a cara. Falta demostrar el recorrido completo de punta a punta.

## Autor y licencia

Andrés Peña Mellado, Digital Art Director & Creative Developer.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/)

Licencia del kernel: [Apache-2.0](./LICENSE), con atribución en [NOTICE](./NOTICE). El kernel es y seguirá siendo de código abierto bajo Apache 2.0; las versiones futuras no pasarán a una licencia restrictiva.

</details>
