<p align="center">
  <a href="./assets/vespiqueen-genesis.png"><img src="./assets/vespiqueen-genesis.png" alt="Vespiqueen genesis" width="100%"></a>
</p>

<h1 align="center">Vespi</h1>

<p align="center">
  <a href="./docs/RELEASE_0.1.8_KERNEL.md"><img src="https://img.shields.io/badge/version-v0.1.8-D7B698?style=for-the-badge&labelColor=07111A" alt="Version: v0.1.8"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-D7B698?style=for-the-badge&labelColor=07111A" alt="License: Apache 2.0"></a>
</p>

<a id="english"></a>

**Vespi does not establish the truth or quality of work, or supply an autonomous runtime.** It is open infrastructure for operations with bounded authority and verifiable receipts: keep the permission, checked result and next agreed action together when work changes hands. You decide what matters; the host carries out and stores the operation.

[Website](https://vespi.xyz) · [Kernel / docs](#kernel--docs) · [History](#history)

## Contributions

A useful community contribution can disappear in a chat. Someone requests feedback, another person delivers it, and an organizer accepts it; later, a reviewer cannot easily recover who asked for what or who acknowledged the result. **Vespi Contributions proposes a portable record of those acknowledgments.**

### Proposed workflow

1. **REQUEST.** The organizer describes the expected contribution and links public context, signing the step through their own Stellar account.
2. **CONTRIBUTE.** The contributor records what they delivered and its supporting evidence, signing through their own account.
3. **ACCEPT.** The organizer reviews the contribution and signs acceptance through their own account. A sequence missing this final step remains incomplete.

The proposed result is a shareable page with the full receipts, participating accounts, public evidence references and transactions. Each canonical JSON receipt would include the previous receipt's hash; its SHA-256 digest would go in Stellar's MEMO_HASH. Transaction identifiers and signing evidence would be indexed separately, outside the already-hashed payload. This lets another person inspect the record without depending solely on Vespi's server.

**Actor and sponsor are separate.** The participant's account must authorize their step. An account sponsoring reserves or paying transaction fees cannot replace that signature. The proposal includes participant-controlled keys, wallet connection and sponsored onboarding without requiring newcomers to buy XLM; Vespi would not retain participant secret keys. Only contributions and supporting evidence consented for public disclosure would enter the pilot.

The planned verifier would check transaction success, receipt integrity, ordered hash links, account authorization, expected roles and the complete workflow. It would verify what accounts acknowledged, not judge whether the underlying work was true, useful or good. Native Stellar transactions are proposed; no new Soroban contract, reputation score or badge system is part of this sprint.

### Existing proof and its limits

The [sandbox](./demo/sandbox/) is a different, existing proof: **one payer, simulated roles, Stellar testnet only, no monetary value**. The authority-granting person is a configuration file, not an authenticated signature. It does not demonstrate the participant-signed contribution workflow above.

A clean-checkout reproduction at evidence commit `9624922`, using Node v24.22.2, passed all **9 tests** and the offline verifier returned **VERIFIED**: `Ledger: 7 payments from the payer, 7 paid receipts, total 29000000 stroops`. The committed run also records 7 blocked attempts. See the [run index](./demo/sandbox/evidence/run.json), [receipts](./demo/sandbox/evidence/receipts/) and [saved Horizon snapshot](./demo/sandbox/evidence/horizon-snapshot.json).

That result rechecks the saved responses; it is **not a fresh ledger query**. The receipt records authorization; settlement is checked by the verifier against the snapshot or Horizon, depending on mode. The runner tracks the budget across destinations; kernel ceilings are per operation. An unkeyed digest is not proof of authorship: someone controlling the files and key could construct a consistent set. The [sandbox limits](./demo/sandbox/README.md#limits-read-these) own the detailed boundary.

### Reproduce the saved proof

Use **Node 24**. The commands below clone and pin evidence commit `9624922` (the original kernel release tag predates this sandbox). If you already have this checkout, start at the install command. The Spanish section links here so each command has one home. Installation downloads the sandbox dependencies; the tests and verification below run offline.

```sh
git clone https://github.com/andresanemic/vespi.git
cd vespi
git checkout 962492230d3540ca4ce5a38990a5525838ef6535
npm --prefix demo/sandbox ci
node --test demo/sandbox/sandbox.test.cjs
node demo/sandbox/verify.cjs --offline
```

The expected output is the result described above. For an **optional live query**, run `node demo/sandbox/verify.cjs`: it reads Horizon testnet now and saves its responses locally. A testnet reset can make that historical run unavailable. This is distinct from reproducing the committed snapshot. Creating a new funded testnet run is documented in the [sandbox guide](./demo/sandbox/README.md#reproduce-from-a-clean-clone), including its overwrite warning.

### Proposed sprint · application submitted, result pending

The Instawards application has been submitted. **Funding has not been awarded and the pilot is not under way.** It proposes a 30-day sprint, with a suggested start of 30 November 2026, to build the workflow above, receipt pages, independent verifier, sponsored onboarding and an open Stellar community pilot.

The proposed acceptance criteria include three completed organizer–contributor pairs beyond the team's separate reference run, at least ten rejected manipulation cases, an outside organizer's assessment, independent reproduction by someone outside the team and Tellus, cross-platform CI, and a public release with bilingual guides. These are targets, not usage or completion evidence. The pilot would recruit openly and allow remote participation; it does not depend on a partner application or event. A payment is not the contribution use case.

## Kernel / docs

[Source](./src/) · [Releases](https://github.com/andresanemic/vespi/releases) · [Tests](./test/) · [Walkthrough](./docs/WALKTHROUGH.md) · [Capabilities](./docs/CAPABILITIES.md) · [CI](https://github.com/andresanemic/vespi/actions)

The current kernel release remains **[v0.1.8-kernel](https://github.com/andresanemic/vespi/releases/tag/v0.1.8-kernel)** (Latest). It is a dependency-free JavaScript source library, not a root-level npm package. The host supplies execution, trusted identities, clock and storage. Its [frozen root-suite result](./docs/SUITE_RESULT_0.1.8.txt) records 1,319 passes; this historical release result is separate from the sandbox evidence above. The CI change adds the sandbox's install, tests and offline verifier to the existing Node 24 Linux/macOS/Windows matrix, without changing the kernel suite.

<a id="clone-and-run"></a>
<a id="kernel-commands"></a>

### Start with an operation

The [offline walkthrough](./docs/WALKTHROUGH.md) runs without installing dependencies for the kernel. From this checkout with Node 24, run its command below, enter `Ada: approve` at the prompt, and inspect `status`, `coverage` and `notCovered`. The [refusal example](./examples/refusal.js) shows an over-limit operation refused before an effect, followed by an authorized one. To run the complete suite, install the x402 demo’s dependencies, then run the tests and offline evidence check:

```sh
node examples/walkthrough.js
npm --prefix demo/x402 ci
node --test "test/*.test.js"
node scripts/verify-testnet-evidence.mjs --offline
```

The walkthrough's [test](./test/walkthrough.test.js) checks an observed local effect and a next action selected in another process, but the receipt is passed to that process explicitly: this does not demonstrate automatic transfer, durable storage or authenticated human identity. The current source includes [the 0.1.7 maintenance release](./docs/TODO_RESOLUTION.md). The saved suite result linked above records the command, exact counts, Node version and Git baseline for this release. Dated judge guides are collected in [History](#history).

### Authority, a human gate and receipts

The kernel is JavaScript without runtime dependencies. A capability declares its requirements; the operation checks authority before `perform`, asks the human gate when required and obtains a separate verification result. [Authority tests](./test/k2.test.js) cover asset, ceiling, destination, expiry and distinct named approvals, but ordinary approval names are labels rather than authenticated signatures and money budgets are not accumulated across operations. The host controls its tools, identities, clock and storage.

[Receipt tests](./test/k3.test.js) cover the SHA-256 digest, named successful checks and omissions, but the digest proves integrity rather than authenticity and can be recomputed by anyone who rewrites the receipt. An external anchor requires a separate confirmation of digest and network. `buildReceipt({ anchorNetwork })` accepts `stellar:testnet` (the default) or `stellar:pubnet`; unsupported networks throw. The test fixtures use fictional data and testnet. See [History](#history) for separate mainnet payment demonstrations.

A pending anchor proves no network interaction, and its network is outside the receipt digest.

[The capability catalog](./docs/CAPABILITIES.md) explains the API and host responsibilities.

Kernel 0.1.8 binds an approved context to its approval and receipt, and rechecks it before an effect. Checkpoints preserve bounded authority when a host resumes an operation; the host supplies authentic storage and a minimum accepted generation. This version also changes the receiver contract of host callbacks. Read the [callback contract and migration note](./docs/HOST_CALLBACKS.md) before adapting an existing 0.1.7 host; see the [0.1.8 release evidence and adoption limits](./docs/RELEASE_0.1.8_KERNEL.md).

### Evidence you can open

[The evidence file](./docs/testnet-evidence.json) records 50 successful testnet transactions read back from Horizon, with 5 cases semantically verified and 45 partially verified, and 0 discrepancies. Expectations come from local execution records rather than Horizon; partial checks do not fill in missing facts. [The evidence guide](./docs/TESTNET_EVIDENCE.md) owns the transaction links, field coverage and historical payment details, including the 0.1.3 adapter's saved x402 receipt. That history is historical evidence for the earlier adapter only. The offline command above checks file shape; the guide owns the comparison against saved responses and the optional network refresh.


<a id="the-functional-projects"></a>

## The projects

One person built these eleven projects with Vespi in about a week (29 September – 3 October 2026); ten run the Vespi kernel (TEMIS is the one that does not). Each explores what you can build this way, with its problem, its evidence and its limits. Their code is public in each repository since 10 October 2026, under a review-only license.

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


## History

These dated guides preserve their original evidence and scope. They are not the Contributions quickstart:

- **Find Your Way · October 2026:** [For judges](./docs/FOR_JUDGES.md), with version-pinned reproduction instructions; [earlier judge findings](./docs/JUDGES_FINDINGS_0.1.4.md).
- **HackMeridian · 26 October 2026:** [Judge in 3 minutes](./docs/JUDGE_IN_3_MINUTES.md), pinned to `meridian-2026-10-26`; [payment demo](./demo/testnet/) and [Pollar demo](./demo/pollar), outside the kernel library. The event guide distinguishes its combined suite from the frozen kernel suite.
- [Historical demo video](https://www.youtube.com/watch?v=bmTqxHv0VGU), [Pollar evidence page](https://vespi.xyz/pollar); pitch deck [EN](https://drive.google.com/file/d/17QqE47pEcvkdMGAdxhLGhuN3DsQLwdoU/view?usp=sharing) / [ES](https://drive.google.com/file/d/1FQKIuHDerpsy7hDXTIwlC-LdiEcMba1Y/view?usp=sharing), one pager [EN](https://drive.google.com/file/d/1JAQ6Yi8dPNQYTpOJssJo5hNJhCcDDcuA/view?usp=drive_link) / [ES](https://drive.google.com/file/d/1_yfvaRmnWssK3v0c8NH3w5_UK1B3Fb3b/view?usp=sharing), and [letters of intent](https://drive.google.com/drive/folders/1X_en3D33AC_BSeEBXRyepdfZWDGckRqm?usp=sharing). These assets do not establish the proposed pilot's completion.

**Historical mainnet anchor:** [transaction `2ff744c6…09d7`](https://stellar.expert/explorer/public/tx/2ff744c69fc01c0de2016e45c5f157b0434382572f2dfc997e8e1d4e34af09d7) anchors one receipt digest. It is not a Contributions chain or pilot. The [payment evidence](./demo/testnet/) separately documents the Pollar payment and the payment signed after hash approval; those demonstrations do not establish community acceptance of a contribution. No new ledger query was made for this README revision.

For the historical payment example, the event guide owns installation, testnet execution and read-only mainnet verification. Its signing capability signs only the transaction hash approved at the kernel gate. Pollar's browser SDK and Horizon readback belong to the separate [Pollar integration](./demo/pollar/); they are not required for the proposed Contributions workflow. The [x402 demo](./demo/x402/) likewise remains outside the kernel: it demonstrates a paid-service adapter on testnet, while its real-SDK bridge inside the kernel is deferred. The capability catalog distinguishes reference zero-knowledge verification from future applications; the Meridian batch-registration idea remains a plan until its transaction exists.

[GitHub traffic records](./data/traffic/clones.json) are distribution signals: clone events are not unique people, active installations or receipt adoption. They do not establish users of Contributions.

### Author and license

Andrés Peña Mellado, Digital Art Director & Creative Developer.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/)

Kernel license: [Apache-2.0](./LICENSE), with attribution in [NOTICE](./NOTICE). The kernel is and will stay open source under Apache 2.0; future releases will not move to a restrictive license.


---

<details>
<summary><b>Leer en español</b></summary>

<a id="espanol"></a>

**Vespi no establece la verdad ni la calidad de un trabajo ni proporciona un runtime autónomo.** Es infraestructura abierta para operaciones con autoridad acotada y recibos verificables: conserva juntos el permiso, el resultado comprobado y la siguiente acción acordada cuando el trabajo cambia de manos. Tú decides lo importante; el host ejecuta y guarda la operación.

[Sitio](https://vespi.xyz) · [Kernel / docs](#kernel-docs-es) · [Historial](#historial)

## Contributions · español

Un aporte útil a la comunidad puede perderse en el chat. Alguien pide feedback, otra persona lo entrega y una organizadora lo acepta; después, a quien revisa le cuesta recuperar quién pidió qué o quién reconoció el resultado. **Vespi Contributions propone un registro portable de esos reconocimientos.**

### Flujo propuesto

1. **REQUEST · solicitar.** La organizadora describe el aporte esperado y enlaza contexto público; firma el paso con su propia cuenta de Stellar.
2. **CONTRIBUTE · aportar.** La persona registra lo que entregó y su evidencia; firma con su propia cuenta.
3. **ACCEPT · aceptar.** La organizadora revisa el aporte y firma su aceptación con su propia cuenta. Una secuencia sin este último paso queda incompleta.

El resultado propuesto es una página compartible con los recibos completos, las cuentas participantes, las referencias públicas de evidencia y las transacciones. Cada recibo JSON canónico incluiría el hash del recibo anterior; su digest SHA-256 iría en MEMO_HASH de Stellar. Los identificadores de transacción y la evidencia de firma se indexarían por separado, fuera del contenido ya hasheado. Así, otra persona podría revisar el registro sin depender solo del servidor de Vespi.

**Actor y patrocinador son distintos.** La cuenta participante debe autorizar su paso. Una cuenta que patrocina reservas o paga comisiones no reemplaza esa firma. La propuesta incluye claves controladas por cada participante, conexión de wallets y entrada patrocinada sin exigir que quien llega compre XLM; Vespi no guardaría claves secretas de participantes. Solo entrarían al piloto aportes y evidencias cuya publicación se haya consentido.

El verificador propuesto comprobaría éxito de las transacciones, integridad de recibos, enlaces de hashes en orden, autorización de cuentas, roles esperados y flujo completo. Verificaría qué reconocieron las cuentas, sin juzgar si el trabajo original fue verdadero, útil o bueno. Se proponen transacciones nativas de Stellar; un contrato Soroban nuevo, puntajes de reputación y un sistema de insignias quedan fuera del sprint.

### Prueba existente y límites

El [sandbox](./demo/sandbox/) es otra prueba, ya existente: **un pagador, roles simulados, solo testnet de Stellar, sin valor monetario**. La persona que concede autoridad es un archivo de configuración, no una firma autenticada. No demuestra el flujo de aportes firmado por participantes descrito arriba.

En una reproducción desde checkout limpio del commit de evidencia `9624922`, con Node v24.22.2, pasaron las **9 pruebas** y el verificador offline devolvió **VERIFIED**: `Ledger: 7 payments from the payer, 7 paid receipts, total 29000000 stroops`. La ejecución guardada también registra 7 intentos bloqueados. Consulta el [índice](./demo/sandbox/evidence/run.json), los [recibos](./demo/sandbox/evidence/receipts/) y el [snapshot guardado de Horizon](./demo/sandbox/evidence/horizon-snapshot.json).

Ese resultado vuelve a comprobar respuestas guardadas; **no es una consulta nueva al ledger**. El recibo registra autorización; el verificador comprueba la liquidación contra el snapshot o Horizon según el modo. El runner lleva el presupuesto entre destinos; los techos del kernel son por operación. Un digest sin clave no prueba autoría: quien controla archivos y clave podría construir un conjunto consistente. Los [límites del sandbox](./demo/sandbox/README.md#limits-read-these) detallan esa frontera.

### Reproducir la prueba guardada

Desde un checkout que contenga el commit de evidencia `9624922` (el tag original del kernel es anterior al sandbox), usa **Node 24**. Ejecuta el [bloque único de comandos del sandbox](#reproduce-the-saved-proof). La instalación descarga sus dependencias; las pruebas y la verificación indicada corren offline. La salida esperada es el resultado descrito arriba.

La **consulta opcional en vivo** está en ese mismo bloque: lee Horizon testnet en ese momento y guarda las respuestas localmente. Un reinicio de testnet puede hacer que la ejecución histórica ya no esté disponible. Eso se distingue de reproducir el snapshot del repo. La [guía del sandbox](./demo/sandbox/README.md#reproduce-from-a-clean-clone) explica cómo crear una nueva ejecución financiada en testnet e incluye la advertencia de sobrescritura.

### Sprint propuesto · postulación enviada, resultado pendiente

La postulación a Instawards fue enviada. **No hay fondos adjudicados ni piloto en marcha.** Propone un sprint de 30 días, con inicio sugerido el 30 de noviembre de 2026, para construir el flujo anterior, las páginas de recibos, el verificador independiente, la entrada patrocinada y un piloto abierto en la comunidad Stellar.

Los criterios de aceptación propuestos incluyen tres parejas organizadora–contribuyente completas, además de la ejecución de referencia separada del equipo; al menos diez casos de manipulación rechazados; la evaluación de una organizadora externa; reproducción independiente por alguien ajeno al equipo y a Tellus; CI en tres sistemas; y un release público con guías bilingües. Son metas, no evidencia de uso ni de cumplimiento. El piloto reclutaría mediante convocatoria abierta y admitiría participación remota; no depende de una app asociada ni de un evento. El caso de aporte no es un pago.

<a id="kernel-docs-es"></a>

## Kernel / documentación

[Código](./src/) · [Versiones](https://github.com/andresanemic/vespi/releases) · [Pruebas](./test/) · [Walkthrough](./docs/WALKTHROUGH.md) · [Capacidades](./docs/CAPABILITIES.md) · [CI](https://github.com/andresanemic/vespi/actions)

El release vigente del kernel sigue siendo **[v0.1.8-kernel](https://github.com/andresanemic/vespi/releases/tag/v0.1.8-kernel)** (Latest). Es una biblioteca fuente JavaScript sin dependencias, no un paquete npm en la raíz. El host aporta ejecución, identidades confiables, reloj y almacenamiento. Su [resultado congelado de la suite raíz](./docs/SUITE_RESULT_0.1.8.txt) registra 1.319 pruebas aprobadas; ese resultado histórico está separado de la evidencia del sandbox. El cambio de CI añade instalación, pruebas y verificador offline del sandbox a la matriz existente de Node 24 en Linux/macOS/Windows, sin cambiar la suite del kernel.

## Empieza con una operación

Desde este checkout, con Node 24, corre el [recorrido local](./docs/WALKTHROUGH.md), responde a la terminal con `Ada: approve` y revisa `status`, `coverage` y `notCovered` del recibo. El [ejemplo de rechazo](./examples/refusal.js) muestra una operación fuera del techo rechazada antes de un efecto y luego otra autorizada.

Los [comandos del kernel](#kernel-commands) se mantienen en un solo lugar: el walkthrough no necesita instalación; la suite completa requiere las dependencias de x402. No necesitas clonar el corte del evento para reproducir el sandbox.

[La prueba del recorrido](./test/walkthrough.test.js) comprueba un efecto local observado y la selección de la siguiente acción en otro proceso, pero el recibo se pasa explícitamente a ese proceso: no demuestra transporte automático, almacenamiento durable ni identidad humana autenticada. El código actual incluye [el mantenimiento del corte 0.1.7](./docs/TODO_RESOLUTION.md). El resultado guardado de la suite enlazado arriba registra el comando, los conteos exactos, la versión de Node y la base Git de esta versión. Las guías fechadas para jueces están en [Historial](#historial).

## Autoridad, puerta humana y recibos

El kernel es JavaScript sin dependencias de runtime. Una capacidad declara sus requisitos; la operación comprueba autoridad antes de `perform`, consulta la puerta humana cuando corresponde y recibe una verificación separada. [Las pruebas de autoridad](./test/k2.test.js) cubren activo, techo, destino, vencimiento y aprobaciones con nombres distintos, pero los nombres de aprobación ordinaria son etiquetas y no firmas autenticadas, y los presupuestos de dinero no se acumulan entre operaciones. El host controla herramientas, identidades, reloj y almacenamiento.

[Las pruebas de recibos](./test/k3.test.js) cubren el digest SHA-256, comprobaciones exitosas con nombre y omisiones, pero el digest demuestra integridad y no autenticidad, y cualquiera que reescriba el recibo puede recalcularlo. Un ancla externa exige confirmar por separado digest y red. `buildReceipt({ anchorNetwork })` acepta `stellar:testnet` (el valor por defecto, sin cambio) o `stellar:pubnet`; una red no admitida produce un error. El ancla pendiente no prueba interacción con una red y su network no entra al digest del recibo. Los fixtures usan datos ficticios y testnet. Consulta [Historial](#historial) para las demos de pago en mainnet, separadas de Contributions.

[El catálogo de capacidades](./docs/CAPABILITIES.md) explica la API y las responsabilidades del host.

El kernel 0.1.8 conserva el contexto aprobado en la aprobación y el recibo, y lo vuelve a comprobar antes de un efecto. Los checkpoints conservan autoridad acotada al retomar; el host aporta almacenamiento auténtico y una generación mínima aceptada. Esta versión cambia el contrato del receptor de los callbacks del host. Consulta el [contrato y la migración de callbacks](./docs/HOST_CALLBACKS.md) antes de adaptar un host 0.1.7 que use `this`, y la [evidencia y los límites de adopción de 0.1.8](./docs/RELEASE_0.1.8_KERNEL.md).

## Evidencia que puedes abrir

[El archivo de evidencia](./docs/testnet-evidence.json) registra 50 transacciones exitosas en testnet leídas de Horizon, con 5 casos verificados semánticamente, 45 parcialmente verificados y 0 discrepancias. Las expectativas vienen de registros locales de ejecución y no de Horizon; las comprobaciones parciales no completan hechos ausentes. [La guía de evidencia](./docs/TESTNET_EVIDENCE.md) contiene los enlaces de transacciones, la cobertura por campos y los detalles de pagos históricos, incluido el recibo x402 del adaptador de 0.1.3. Esa historia es evidencia histórica de aquel adaptador. El comando offline del kernel comprueba la forma del archivo; la guía contiene la comparación de respuestas guardadas y la consulta opcional a la red.


<a id="los-proyectos-funcionales"></a>

## Los proyectos

Una persona construyó estos once proyectos con Vespi en una semana (29 de septiembre – 3 de octubre de 2026); diez corren el kernel de Vespi (TEMIS es el que no lo corre). Once proyectos exploran qué puedes construir así, cada uno con su problema, su evidencia y sus límites. Su código es público en cada repositorio desde el 10 de octubre de 2026, con licencia de solo revisión.

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


## Historial

Estas guías fechadas conservan su evidencia y alcance originales. No son la entrada para reproducir Contributions:

- **Find Your Way · octubre de 2026:** [Para jueces](./docs/FOR_JUDGES.md), con instrucciones fijadas a una versión; [hallazgos anteriores](./docs/JUDGES_FINDINGS_0.1.4.md).
- **HackMeridian · 26 de octubre de 2026:** [Judge in 3 minutes](./docs/JUDGE_IN_3_MINUTES.md), fijada a `meridian-2026-10-26`; [demo de pago](./demo/testnet/) y [demo de Pollar](./demo/pollar), fuera de la biblioteca del kernel. La guía del evento distingue su suite combinada de la suite congelada del kernel.
- [Video histórico de la demo](https://www.youtube.com/watch?v=bmTqxHv0VGU), [página de evidencia de Pollar](https://vespi.xyz/pollar); pitch deck [EN](https://drive.google.com/file/d/17QqE47pEcvkdMGAdxhLGhuN3DsQLwdoU/view?usp=sharing) / [ES](https://drive.google.com/file/d/1FQKIuHDerpsy7hDXTIwlC-LdiEcMba1Y/view?usp=sharing), one pager [EN](https://drive.google.com/file/d/1JAQ6Yi8dPNQYTpOJssJo5hNJhCcDDcuA/view?usp=drive_link) / [ES](https://drive.google.com/file/d/1_yfvaRmnWssK3v0c8NH3w5_UK1B3Fb3b/view?usp=sharing), y [cartas de intención](https://drive.google.com/drive/folders/1X_en3D33AC_BSeEBXRyepdfZWDGckRqm?usp=sharing). Esos archivos no acreditan cumplimiento del piloto propuesto.

**Anclaje histórico en mainnet:** la [transacción `2ff744c6…09d7`](https://stellar.expert/explorer/public/tx/2ff744c69fc01c0de2016e45c5f157b0434382572f2dfc997e8e1d4e34af09d7) ancla el digest de un recibo. No es una cadena de Contributions ni el piloto. La [evidencia de pagos](./demo/testnet/) documenta por separado el pago con Pollar y el pago firmado tras aprobar su hash; esas demos no acreditan aceptación comunitaria de un aporte. No se hizo una consulta nueva al ledger para esta revisión del README.

Para el ejemplo histórico de pago, la guía del evento contiene instalación, ejecución en testnet y verificación de mainnet de solo lectura. Su capacidad de firma firma solo el hash de transacción aprobado en la puerta del kernel. El SDK de Pollar en el navegador y la relectura de Horizon pertenecen a la [integración separada de Pollar](./demo/pollar/); no son necesarios para Contributions. La [demo x402](./demo/x402/) también sigue fuera del kernel: demuestra un adaptador de servicio pagado en testnet, mientras el puente SDK real dentro del kernel está diferido. El catálogo distingue la verificación de referencia de conocimiento cero de las apps futuras; el registro por lotes de Meridian sigue como plan hasta que exista su transacción.

Los [registros de tráfico de GitHub](./data/traffic/clones.json) son señales de distribución: los eventos de clonación no son personas únicas, instalaciones activas ni adopción de recibos. No acreditan usuarios de Contributions.

## Autor y licencia

Andrés Peña Mellado, Digital Art Director & Creative Developer.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/)

Licencia del kernel: [Apache-2.0](./LICENSE), con atribución en [NOTICE](./NOTICE). El kernel es y seguirá siendo de código abierto bajo Apache 2.0; las versiones futuras no pasarán a una licencia restrictiva.


</details>
