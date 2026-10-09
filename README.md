# Vespi

**The engine for building apps with AI on Stellar. You drive.**

You talk to the AI, it builds, and you decide what matters. What you learn stays for next time.

We want Vespi to be the official kernel for building apps on Stellar.

---

## What you can do today

- [Install Lore Plugin](https://github.com/andresanemic/lore-plugin) — the kit you work with
- Run a kernel operation: `node examples/walkthrough.js`

## What the kernel can do

| Capability | Status |
|---|---|
| Permission before acting — the agent does only what you allowed and asks when permission is missing | Proven |
| Spending with a ceiling: asset, amount, destination and expiry | Proven |
| A second review: another checks the result. The agent does not grade itself | Proven |
| Continuity: the next session picks up from what was already checked, and the uncertain returns to you | Proven |
| x402 payments on Stellar, on the real Stellar SDK | Demo |
| A 0.01 USDC payment and 50 transactions saved on Stellar testnet | Testnet |
| Zero-knowledge proof verification | Reference |
| Delegation, emergency permissions and skill provenance | Proven |

## The projects

Eleven projects explore what you can build this way, each with its problem, its evidence and its limits. The eleven projects are documented today; their code opens between 12 and 16 October 2026.

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

All with fictional data on Stellar testnet, no real money.

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
- Payments with x402 on Stellar: an agent can pay a service with the conditions you set. Demo running on the real Stellar SDK.
- Also: zero-knowledge proof verification, anchors on Stellar, delegation, emergency permissions and skill provenance.

---

## What the kernel is

Vespi keeps authority, checked result and next agreed action together when work changes hands. You resume what still holds; an uncertain exercised effect returns to you for reconciliation.

Kernel 0.1.5 is a dependency-free JavaScript source library. It is an engine for Stellar apps across 11 functional explorations. All chain evidence is Stellar testnet with fictional data, no real money.

### Start with an operation

From a source checkout of this repository, with Node.js 24 available, run the [offline walkthrough](./docs/WALKTHROUGH.md), answer its terminal prompt with your name followed by `: approve`, and inspect the returned `status`, `coverage` and `notCovered`:

```sh
(cd demo/x402 && npm ci)   # the suite also covers the x402 bridge, which needs its dependencies
node examples/walkthrough.js
node --test "test/*.test.js"
```

The walkthrough's [test](./test/walkthrough.test.js) checks an observed local effect and a next action selected in another process, but the receipt is passed to that process explicitly: this does not demonstrate automatic transfer, durable storage or authenticated human identity. The [saved suite result](./docs/SUITE_RESULT_0.1.5.txt) records the command, exact counts, Node version and Git baseline for the published cut. The [judge guide](./docs/FOR_JUDGES.md) explains how to reproduce the evidence and its limits.

### Authority, a human gate and receipts

The kernel is JavaScript without runtime dependencies. A capability declares its requirements; the operation checks authority before `perform`, asks the human gate when required and obtains a separate verification result. [Authority tests](./test/k2.test.js) cover asset, ceiling, destination, expiry and distinct named approvals, but ordinary approval names are labels rather than authenticated signatures and money budgets are not accumulated across operations. The host controls its tools, identities, clock and storage.

[Receipt tests](./test/k3.test.js) cover the SHA-256 digest, named successful checks and omissions, but the digest proves integrity rather than authenticity and can be recomputed by anyone who rewrites the receipt. An external anchor requires a separate confirmation of digest and network. `buildReceipt({ anchorNetwork })` accepts `stellar:testnet` (the default) or `stellar:pubnet`; unsupported networks throw. All chain evidence here is testnet, on fictional data and with no real money.

[The capability catalog](./docs/CAPABILITIES.md) explains the API and host responsibilities.

### What 0.1.5 changes

`buildReceipt({ anchorNetwork })` keeps `stellar:testnet` as its default and accepts `stellar:pubnet` when a pending anchor should name that network. Unsupported values throw. The network remains outside the body digest; selecting it does not submit an anchor.

The reference x402 bridge is an opt-in example under [`demo/x402/`](./demo/x402/), available only through `--bridge=1`. It admits one payer authorization for its declared transfer and verifies settlement through the Stellar SDK against the declared network, recipient and amount. Its tests use real SDK objects and local fixtures; they do not make a live testnet payment. The bridge does not change the kernel API under `src/`.

### What 0.1.4 added (historical)

The [continuation tests](./test/v014.test.js) cover reconciliation before repeating an uncertain exercised action, a stable key passed to `perform`, attempt limits and an injected synchronous clock, but destination deduplication, trustworthy time and waking the process belong to the host. Delegation deadlines remain consultative.

The [0.1.3 note](./docs/RELEASE_0.1.3_KERNEL.md) announced emergency access, zero knowledge, skill provenance and x402 inside the kernel. All enter 0.1.4 under the limits in the [bilingual release note](./docs/RELEASE_0.1.4_KERNEL.md). [Emergency tests](./test/k1-emergencia-r6-advisor.test.js) cover prior authority and reviews using host-issued opaque principals, but the kernel does not authenticate real people, persist the ledger, execute or verify the effect, or provide trusted time; D4 counts uses, with the money ceiling left to the project. [Provenance tests](./test/k2-procedencia-r5-advisor.test.js) cover a resolver's own evidence and hostile data, including polluted prototype data, but not built-in function replacement by same-process code; `provenanceSource` distinguishes verified from declared evidence and the skill name stays declared.

[x402 tests](./test/k4-x402-r3-advisor.test.js) exercise the 0.1.4 paid-effect contract through injected ports, with mandatory synchronous `claims` and operation identity in the effect key. The memory store is not durable, reservations are not released and the validator's body digest is not recomputed by the kernel. Anyone can build on this contract by supplying their own ports. The reference bridge using the real Stellar SDK is not included in this cut because two independent reviews rejected it: the first found that 15 of 20 attacks were not blocked and the second found that 13 out of 26 were not blocked, including authorization replay, overwritten inspection windows and reads that continue after cancellation. Neither review demonstrated improper settlement or key disclosure. The bridge remains for 0.1.5.

[ZK tests](./test/k3b-zk-port.test.js) cover a pinned key and agreed public inputs, but trust the injected backend. The internal [BN254 Groth16 reference](./src/zk-bn254-reference.js) has [fixture and arithmetic evidence](./test/fixtures/zk/independent-report.md), but proofs are malleable, a degenerate key accepts forgeries, synchronous verification cannot be interrupted by a Promise timeout, and there is no external audit or production readiness. These modules do not demonstrate integration with Casa Firme or Vela. D5: Vela's sealed content remains plaintext in the demonstration according to the owner's declaration; a real deployment requires encryption at rest and third-party key custody.

### Evidence you can open

[The evidence file](./docs/testnet-evidence.json) records 50 successful testnet transactions read back from Horizon, with 5 cases semantically verified and 45 partially verified, and 0 discrepancies. Expectations come from local execution records rather than Horizon; partial checks do not fill in missing facts. [The evidence guide](./docs/TESTNET_EVIDENCE.md) owns the transaction links, field coverage and historical payment details, including the 0.1.3 adapter's saved x402 receipt. That history is historical evidence for the earlier adapter only. Check file shape offline with `node scripts/verify-testnet-evidence.mjs --offline`; the guide also provides a comparison against saved responses and an optional network refresh.

### The TEMIS record, read at its actual boundary

TEMIS is a bilateral-agreement record used to pressure authority and receipts with fictional data on testnet. Its saved [execution account](./docs/evidence-records/temis-tramos/3/recibo.md) describes registration, signatures, anchors, milestones, corrections, challenges and a reconstruction by a model that did not build it. You can open the [comparison record](./docs/evidence-records/temis-tramos/3/cruce-con-tercero-exp-murckqaa.json) and see both the lifecycle labels it reports as matching and the differences it found when comparing the local copy. Those are declared run results; the transaction-field verifier does not reproduce the lifecycle logic or that third-party reconstruction.

The distinction matters for review. A digest memo and a successful ledger record can support an anchor claim without proving that an agreement is legally valid, that a human signed it or that a disputed milestone was fulfilled. The public transaction is one piece of the evidence; the agreement, the local record and the observer's scope remain necessary. [The evidence guide](./docs/TESTNET_EVIDENCE.md) owns the transaction comparison and its omissions, so a reader can weigh this case without treating every label in a run report as a chain fact.

### Lore Plugin and the build method

[Lore Plugin](https://github.com/andresanemic/lore-plugin) supplies criterion and the coordinator workflow; Vespi supplies the authority and receipt semantics around an operation. The [method](./docs/METHOD.md) describes loops, test-first work, specifications, bounded delegation, blind reading and separate verification; it is a workflow for host tools, not a kernel that generates apps or images itself. Lore Plugin carries a pinned kernel, so this source snapshot does not update an installed kit automatically.

The agreement keeps its order. Its purpose is to preserve your agency and avoid repeated decisions; its method coordinates bounded authority, a human gate and receipts; each operation's concrete result must be checked. The [verification record](./docs/VERIFICATION.md), [judge findings from the earlier cut](./docs/JUDGES_FINDINGS_0.1.4.md), [prior-art notes](./docs/PRIOR_ART.md) and [experiments](./experiments/) retain construction history. Model reviews independent of the builders are not an external security audit. The method credits [The Fable Method](https://github.com/Sahir619/fable-method); Raven MCP, Stellar and the Lore/LUS work belong to the construction narrative, not proof that the whole product operates autonomously.

### Institutions, direction and construction history

An institution can inspect and adapt the source under the kernel's Apache license in its own environment, but this repository is not a hosted service, an institutional adoption record or a compliance certificate. Permission, observation and record retention still need a consuming project's agreement. The clinical and protected-source examples do not turn into real confidential deployments by adding an emergency grant or a ZK verifier. Their data custody and legal decisions remain outside this experimental kernel.

The direction is to coordinate work using whichever capabilities the operation actually needs, including the Stellar ecosystem's services where they help. Becoming an operating system for that ecosystem remains an ambition. Find Your Way and Meridian are the submission context, not evidence of endorsement, partnership, funding or an official relationship. Lore, Lore Plugin and LUS are the criterion and research lineage described in [GENESIS](./docs/GENESIS.md); LUS is not a runtime component.

The construction narrative retains its sources without turning them into endorsements. [The method](./docs/METHOD.md) records the Fable attribution and distinguishes the coordinator's loop from kernel behavior. [The verification history](./docs/VERIFICATION.md) records earlier practices and model reviews; its older counts belong to their own cuts and do not replace this version's suite. Raven-assisted source discovery is recorded in [TEMIS's source notes](./docs/evidence-records/temis-tramos/0/fuentes.md), but discovery is not implementation or proof of an entire ecosystem's coverage. The earlier OpenAI incident, ultrareview, Superpowers and fly-connectome references belong to the origin narrative; no current security guarantee follows from naming them. The fly was an analogy for behavior arising from structure, not a claim that Vespi is a brain or learns.

[The prior-art study](./docs/PRIOR_ART.md) compares authority, durable execution, supervision and receipts and explains why a stable effect key does not supply exactly-once execution on its own. It is a dated comparison with its source-reading limits, not a current claim that no neighboring project coordinates operations. Historical experiments and rejected candidates remain in [experiments](./experiments/). Keeping them visible lets you see how the contract changed without presenting an old run as validation of a new module.

### What 0.1.4 does NOT bring and moves to 0.1.5

Spend-authority narrowing stays out because the base `grantSpend` constructor has an inherited-setter defect. The [release note](./docs/RELEASE_0.1.4_KERNEL.md#what-014-does-not-bring-and-moves-to-015) gives each reason for deferring x402 HX-09, HX-11, HX-12, HX-13, R2-05 and H11; provenance N07, N08, H12d and H13d; emergency H21; and the real-SDK reference bridge. The remaining `todo` cases document declared contract boundaries, including same-process function replacement and validator output limits, rather than all promising future fixes.

There is no durable emergency or payment store, autonomous cross-host runtime, scheduler, mainnet evidence, second payment provider, external security audit, regulatory certification or production readiness. In the working architecture, operation semantics remain `SUPPORTED`, autonomous operation `UNTESTED`, and the Final Vespi Gate `READY_FOR_MUSE_DISCOVERY` and `NOT_READY_FOR_IMPLEMENTATION`. Those labels describe candidates and limits, not runtime capabilities delivered to users.

### Author and license

Andrés Peña Mellado, Digital Art Director & Creative Developer. [Telegram](https://t.me/andresanemic), [X](https://x.com/andresanemic), [LinkedIn](https://www.linkedin.com/in/andresanemic/). Kernel license: [Apache-2.0](./LICENSE), with attribution in [NOTICE](./NOTICE).

---

## Español

<a id="español"></a>

**El motor para crear apps con IA en Stellar. Tú manejas.**

Conversas con la IA, ella construye y tú decides lo importante. Lo que aprendes queda para la próxima vez.

Queremos que Vespi sea el kernel oficial para crear apps en Stellar.

### Lo que puedes hacer hoy

- [Instalar Lore Plugin](https://github.com/andresanemic/lore-plugin) — el kit con el que trabajas
- Correr una operación del kernel: `node examples/walkthrough.js`

### Lo que puede hacer el kernel

| Capacidad | Estado |
|---|---|
| Permiso antes de actuar: el agente hace solo lo que permitiste y te pregunta cuando falta permiso | Probado |
| Gasto con techo: límites por activo, monto, destino y vencimiento | Probado |
| Una segunda revisión: otro comprueba el resultado. El agente no se califica a sí mismo | Probado |
| Continuidad: la siguiente sesión sigue desde lo ya comprobado, y lo incierto vuelve a ti | Probado |
| Pagos x402 en Stellar, sobre el SDK real de Stellar | Demo |
| Un pago de 0,01 USDC y 50 transacciones guardadas en la testnet de Stellar | Testnet |
| Verificación de pruebas de conocimiento cero | Referencia |
| Delegación, permisos de emergencia y procedencia de skills | Probado |

### Los proyectos

Once proyectos exploran qué puedes construir así, cada uno con su problema, su evidencia y sus límites. Los once proyectos están documentados hoy; su código se abre entre el 12 y el 16 de octubre de 2026.

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

Todos con datos ficticios en la testnet de Stellar, sin dinero real.

### Cómo se trabaja

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
- Pagos con x402 en Stellar: un agente puede pagar un servicio con las condiciones que fijaste. Demo funcionando sobre el SDK real de Stellar.
- Además: verificación de pruebas de conocimiento cero, anclajes en Stellar, delegación, permisos de emergencia y procedencia de skills.

### Qué es el kernel

Vespi conserva juntas la autoridad, el resultado comprobado y la siguiente acción acordada cuando el trabajo cambia de manos. Retomas lo que sigue valiendo; un efecto ejercido incierto vuelve a ti para reconciliarlo.

El kernel 0.1.5 es una biblioteca fuente JavaScript sin dependencias. Es un motor de apps Stellar en 11 exploraciones funcionales. Toda evidencia de cadena es testnet con datos ficticios, sin dinero real.

### Empieza con una operación

Desde una copia de código de este repositorio, con Node.js 24 disponible, corre el [recorrido local](./docs/WALKTHROUGH.md), responde a la terminal con tu nombre seguido de `: approve` y revisa `status`, `coverage` y `notCovered` del recibo:

```sh
(cd demo/x402 && npm ci)   # la suite también cubre el puente x402, que necesita sus dependencias
node examples/walkthrough.js
node --test "test/*.test.js"
```

[La prueba del recorrido](./test/walkthrough.test.js) comprueba un efecto local observado y la selección de la siguiente acción en otro proceso, pero el recibo se pasa explícitamente a ese proceso: no demuestra transporte automático, almacenamiento durable ni identidad humana autenticada. [El resultado guardado de la suite](./docs/SUITE_RESULT_0.1.5.txt) registra el comando, los conteos exactos, la versión de Node y la base Git del corte publicado. [La guía para jueces](./docs/FOR_JUDGES.md) explica cómo reproducir la evidencia y sus límites.

### Autoridad, puerta humana y recibos

El kernel es JavaScript sin dependencias de runtime. Una capacidad declara sus requisitos; la operación comprueba autoridad antes de `perform`, consulta la puerta humana cuando corresponde y recibe una verificación separada. [Las pruebas de autoridad](./test/k2.test.js) cubren activo, techo, destino, vencimiento y aprobaciones con nombres distintos, pero los nombres de aprobación ordinaria son etiquetas y no firmas autenticadas, y los presupuestos de dinero no se acumulan entre operaciones. El host controla herramientas, identidades, reloj y almacenamiento.

[Las pruebas de recibos](./test/k3.test.js) cubren el digest SHA-256, comprobaciones exitosas con nombre y omisiones, pero el digest demuestra integridad y no autenticidad, y cualquiera que reescriba el recibo puede recalcularlo. Un ancla externa exige confirmar por separado digest y red. `buildReceipt({ anchorNetwork })` acepta `stellar:testnet` (el valor por defecto, sin cambio) o `stellar:pubnet`; una red no admitida produce un error. El ancla pendiente no prueba interacción con una red y su network no entra al digest del recibo. Toda evidencia de cadena aquí es testnet, con datos ficticios y sin dinero real.

[El catálogo de capacidades](./docs/CAPABILITIES.md) explica la API y las responsabilidades del host.

### Qué cambia el 0.1.5

`buildReceipt({ anchorNetwork })` mantiene `stellar:testnet` como valor por defecto y acepta `stellar:pubnet` cuando se quiere nombrar esa red en un ancla pendiente. Una red no admitida produce un error. La red sigue fuera del digest del cuerpo; elegirla no envía un ancla.

El puente de referencia x402 es un ejemplo opt-in en [`demo/x402/`](./demo/x402/), disponible solo con `--bridge=1`. Admite una autorización de pagador para la transferencia declarada y verifica la liquidación con el SDK de Stellar contra la red, destinatario y monto declarados. Sus pruebas usan objetos reales del SDK y fixtures locales; no hacen un pago vivo en testnet. El puente no cambia la API del kernel en `src/`.

### Qué aportó el 0.1.4 (histórico)

[Las pruebas de continuidad](./test/v014.test.js) cubren reconciliación antes de repetir una acción ejercida incierta, una clave estable que recibe `perform`, topes de intentos y un reloj síncrono inyectado, pero la deduplicación en el destino, el tiempo confiable y despertar el proceso corresponden al host. Los plazos de delegación siguen siendo consultivos.

[La nota del 0.1.3](./docs/RELEASE_0.1.3_KERNEL.md) anunció emergencia, conocimiento cero, procedencia de skills y x402 dentro del kernel. Todo entra al 0.1.4 con los límites de [la nota bilingüe](./docs/RELEASE_0.1.4_KERNEL.md). [Las pruebas de emergencia](./test/k1-emergencia-r6-advisor.test.js) cubren autoridad anticipada y revisión con principales opacos del host, pero el kernel no autentica personas reales, no persiste el registro, no ejecuta ni verifica el efecto y no aporta tiempo confiable; D4 cuenta usos y deja el techo en dinero al proyecto. [Las pruebas de procedencia](./test/k2-procedencia-r5-advisor.test.js) cubren evidencia propia del resolver y datos hostiles, incluidos datos en prototipos contaminados, pero no sustitución de funciones integradas por código del mismo proceso; `provenanceSource` distingue evidencia verificada de declarada y el nombre de la skill sigue declarado.

[Las pruebas x402](./test/k4-x402-r3-advisor.test.js) ejercitan el contrato de efecto pagado del 0.1.4 por puertos inyectados, con `claims` obligatorio y síncrono e identidad de operación en la clave del efecto. El almacén en memoria no es durable, las reservas no se liberan y el kernel no recalcula el digest del cuerpo que declara el validador. Cualquiera puede construir sobre este contrato si aporta sus propios puertos. El puente de referencia con el SDK real de Stellar no se incluye en este corte porque dos revisiones independientes lo rechazaron: la primera revisión encontró que no se bloquearon 15 de 20 ataques y la segunda encontró que no se bloquearon 13 de 26, incluidos el reenvío de una autorización, la sobrescritura de su ventana de inspección y lecturas que continúan tras cancelar. Ninguna demostró liquidación indebida ni filtración de claves. El puente queda para 0.1.5.

[Las pruebas ZK](./test/k3b-zk-port.test.js) cubren clave fijada y entradas públicas acordadas, pero confían en el backend inyectado. La [referencia interna BN254 con Groth16](./src/zk-bn254-reference.js) tiene [evidencia de fixtures y aritmética](./test/fixtures/zk/independent-report.md), pero las pruebas son maleables, una clave degenerada acepta falsificaciones, un timeout con Promise no puede interrumpir la verificación síncrona y no hay auditoría externa ni preparación para producción. Estos módulos no demuestran integración con Casa Firme o Vela. D5: el contenido sellado de Vela queda en claro en la demostración según la declaración del dueño; un despliegue real exige cifrado en reposo y custodia de claves de un tercero.

### Evidencia que puedes abrir

[El archivo de evidencia](./docs/testnet-evidence.json) registra 50 transacciones exitosas en testnet leídas de Horizon, con 5 casos verificados semánticamente, 45 parcialmente verificados y 0 discrepancias. Las expectativas vienen de registros locales de ejecución y no de Horizon; las comprobaciones parciales no completan hechos ausentes. [La guía de evidencia](./docs/TESTNET_EVIDENCE.md) contiene los enlaces de transacciones, la cobertura por campos y los detalles de pagos históricos, incluido el recibo x402 del adaptador de 0.1.3. Esa historia es evidencia histórica de aquel adaptador. Comprueba la forma del archivo sin red con `node scripts/verify-testnet-evidence.mjs --offline`; la guía también permite comparar respuestas guardadas y volver a consultar la red de forma opcional.

### El registro de TEMIS y su frontera real

TEMIS es un registro de acuerdos bilaterales que presiona autoridad y recibos con datos ficticios en testnet. [Su relato de ejecución guardado](./docs/evidence-records/temis-tramos/3/recibo.md) describe alta, firmas, anclas, hitos, correcciones, impugnaciones y una reconstrucción por un modelo que no lo construyó. Puedes abrir [el registro del cotejo](./docs/evidence-records/temis-tramos/3/cruce-con-tercero-exp-murckqaa.json) y ver tanto los estatus que declara coincidentes como las diferencias que encontró al comparar la copia local. Son resultados declarados de una corrida; el verificador de hechos de transacciones no reproduce las reglas del ciclo de vida ni la reconstrucción del tercero.

La distinción importa al revisar. Un memo de digest y un registro exitoso de ledger pueden sostener un ancla sin probar que un acuerdo sea legalmente válido, que una persona lo firmó o que se cumplió un hito impugnado. La transacción pública es una parte de la evidencia; el acuerdo, el registro local y el alcance del observador siguen siendo necesarios. [La guía de evidencia](./docs/TESTNET_EVIDENCE.md) contiene la comparación y sus omisiones para que valores el caso sin tomar cada estatus del informe como un hecho de cadena.

### Lore Plugin y el método de construcción

[Lore Plugin](https://github.com/andresanemic/lore-plugin) aporta el criterio y el flujo del coordinador; Vespi aporta la semántica de autoridad y recibos alrededor de una operación. [El método](./docs/METHOD.md) describe ciclos, pruebas primero, especificaciones, delegación acotada, lectura ciega y verificación separada; es un flujo de trabajo para herramientas del host, no un kernel que genere apps o imágenes por sí solo. Lore Plugin lleva una copia fija del kernel, por lo que este corte de código no actualiza automáticamente un kit instalado.

El acuerdo conserva su orden. La finalidad es cuidar tu agencia y evitar decisiones repetidas; el método coordina autoridad acotada, puerta humana y recibos; el resultado concreto debe comprobarse en cada operación. [El registro de verificación](./docs/VERIFICATION.md), [los hallazgos de jueces del corte anterior](./docs/JUDGES_FINDINGS_0.1.4.md), [las notas de arte previo](./docs/PRIOR_ART.md) y [los experimentos](./experiments/) conservan la historia de construcción. Las revisiones por modelos independientes de sus constructores no son una auditoría de seguridad externa. El método acredita [The Fable Method](https://github.com/Sahir619/fable-method); Raven MCP, Stellar y el trabajo de Lore/LUS pertenecen al relato de construcción, no prueban que el producto completo opere de forma autónoma.

### Instituciones, rumbo e historia de construcción

Una institución puede revisar y adaptar el código bajo la licencia Apache del kernel en su propio entorno, pero este repositorio no es un servicio alojado, un registro de adopción institucional ni un certificado de cumplimiento. Permisos, observación y conservación de registros necesitan el acuerdo del proyecto consumidor. Los ejemplos clínicos y de fuentes protegidas no se vuelven despliegues confidenciales reales por añadir un permiso de emergencia o un verificador ZK. La custodia de datos y las decisiones legales quedan fuera de este kernel experimental.

El rumbo es coordinar trabajo con las capacidades que la operación necesite, incluidos servicios del ecosistema Stellar cuando aporten. Ser un sistema operativo para ese ecosistema sigue siendo una ambición. Find Your Way y Meridian son el contexto de postulación, no evidencia de respaldo, alianza, financiamiento ni relación oficial. Lore, Lore Plugin y LUS son el linaje de criterio e investigación descrito en [GENESIS](./docs/GENESIS.md); LUS no es un componente del runtime.

El relato de construcción conserva sus fuentes sin convertirlas en respaldos. [El método](./docs/METHOD.md) registra la atribución a Fable y separa el ciclo del coordinador del comportamiento del kernel. [La historia de verificación](./docs/VERIFICATION.md) registra prácticas y revisiones por modelos anteriores; sus cifras pertenecen a sus cortes y no reemplazan la suite de esta versión. El descubrimiento de fuentes con Raven figura en [las notas de fuentes de TEMIS](./docs/evidence-records/temis-tramos/0/fuentes.md), pero descubrir no equivale a implementar ni probar cobertura de un ecosistema entero. Las referencias previas al incidente de OpenAI, ultrareview, Superpowers y el conectoma de la mosca pertenecen al relato de origen; nombrarlas no sostiene una garantía actual de seguridad. La mosca fue una analogía de comportamiento surgido de estructura, no una afirmación de que Vespi sea un cerebro o aprenda.

[El estudio de arte previo](./docs/PRIOR_ART.md) compara autoridad, ejecución durable, supervisión y recibos, y explica por qué una clave estable no aporta por sí sola ejecución exactamente una vez. Es una comparación fechada con sus límites de lectura de fuentes, no una afirmación actual de que ningún proyecto vecino coordine operaciones. Los experimentos históricos y candidatos rechazados siguen en [experiments](./experiments/). Conservarlos permite ver cómo cambió el contrato sin presentar una corrida antigua como validación de un módulo nuevo.

### Qué NO trae el 0.1.4 y pasa al 0.1.5

El comparador de reducción de autoridad de gasto queda fuera por un defecto de setters heredados en el constructor base `grantSpend`. [La nota de versión](./docs/RELEASE_0.1.4_KERNEL.md#qué-no-trae-el-014-y-pasa-al-015) da el motivo de cada punto diferido: x402 HX-09, HX-11, HX-12, HX-13 y R2-05; procedencia N07, N08, H12d y H13d; emergencia H21; y el puente de referencia con el SDK real, rechazado en dos revisiones independientes. Los demás `todo` documentan fronteras declaradas del contrato, como sustitución de funciones dentro del proceso y límites de la salida del validador, sin prometer un arreglo futuro para todas ellas.

No hay almacén durable de emergencia ni de pagos, runtime autónomo entre hosts, planificador, evidencia de mainnet, segundo proveedor de pagos, auditoría de seguridad externa, certificación regulatoria ni preparación para producción. En la arquitectura de trabajo, la semántica de operación sigue `SUPPORTED`, la operación autónoma `UNTESTED` y el Final Vespi Gate `READY_FOR_MUSE_DISCOVERY` y `NOT_READY_FOR_IMPLEMENTATION`. Esas etiquetas describen candidatas y límites, no capacidades de runtime entregadas a usuarios.

### Autor y licencia

Andrés Peña Mellado, Digital Art Director & Creative Developer. [Telegram](https://t.me/andresanemic), [X](https://x.com/andresanemic), [LinkedIn](https://www.linkedin.com/in/andresanemic/). Licencia del kernel: [Apache-2.0](./LICENSE), con atribución en [NOTICE](./NOTICE).
