# Vespi

Vespi keeps the authority you granted, the checked result and the next agreed action together when work changes hands. You resume what still holds; an uncertain exercised effect returns to you for reconciliation. Kernel `0.1.4`: [fecha de publicación]. This is tested operation semantics, with host-managed storage and execution, not demonstrated autonomous work across hosts.

Vespi conserva juntas la autoridad que otorgaste, el resultado comprobado y la siguiente acción acordada cuando el trabajo cambia de manos. Retomas lo que sigue valiendo; un efecto ejercido incierto vuelve a ti para reconciliarlo. Kernel `0.1.4`: [fecha de publicación]. Es semántica de operación probada, con almacenamiento y ejecución a cargo del host, no trabajo autónomo demostrado entre hosts.

[![Vespiqueen genesis](./assets/vespiqueen-genesis.png)](./assets/vespiqueen-genesis.png)

## English

<a id="english"></a>

### Start with an operation

From a source checkout of this repository, with Node.js 24 available, run the [offline walkthrough](./docs/WALKTHROUGH.md), answer its terminal prompt with `Ada: approve`, and inspect the returned `status`, `coverage` and `notCovered`:

```sh
node examples/walkthrough.js
node --test "test/*.test.js"
```

The walkthrough's [test](./test/walkthrough.test.js) checks an observed local effect and a next action selected in another process, but the receipt is passed to that process explicitly: this does not demonstrate automatic transfer, durable storage or authenticated human identity. The kernel suite reports 1173 tests, 1149 passed, 0 failed and 24 `todo`; those pending or boundary cases are not passing tests. The [judge guide](./docs/FOR_JUDGES.md) explains how to reproduce the evidence and its limits.

### What this looks like for a person

The point is to retain what you already decided when the session, tool or person doing the work changes. A summary can help someone understand the project, but it is not a grant and does not establish whether an external effect happened. The kernel makes those questions explicit. It can be used around work with AI or without it, and with a chain anchor or without one; the operation decides which capabilities it needs. This is a source library for a host to configure, not an installed service that takes over your work.

**Fictional example.** Maya wants a booking app for her neighborhood hair salon, La Esquina. The person, business, schedule and prices are invented; this is an illustration of the coordinator's method with host tools, not a run of an app generator inside the kernel.

```text
[COORDINATOR]
We will draft the agreement before building: what the app must do, who grants
its authority, what spending is allowed and what counts as done. We will then
write specifications and acceptance checks, build the local app, ask a reader
who did not build it to try the flow, and verify the result separately.

I need your decisions about authority, the money ceiling and publication.

[MAYA]
I grant authority for a local prototype, with no paid services. Do not publish
until I approve the final preview.
```

That decision remains part of the agreement. A host with the necessary tools may build the booking flow, draft posts or generate images; those tools do the work. The kernel can check declared authority and record their results, while the coordinator's method organizes specifications, bounded tasks and verification. A booking prototype and its publicity are different effects: permission to build locally does not become permission to publish just because the app now works.

```text
[COORDINATOR]
The booking flow and its checks are ready. Here are the preview and the proposed
posts. Do you approve this exact publication?

[MAYA]
Not yet. Change Tuesday's hours, then show me the preview again.
```

Maya does not have to repeat the project's entire purpose to make that change. The next action changes, so the coordinator records it and returns with the revised result. If a tool reports an uncertain publication after a network timeout, the operation must not treat the lack of a response as proof that nothing went out. It returns the uncertainty for reconciliation, using the continuation behavior documented below. That is a decision preserved for the person, rather than a promise that every retry is harmless.

```text
[NEXT SESSION]
The host loads the agreement and receipts. The coordinator checks what still
holds, what was verified and what changed before choosing the next action.
An uncertain exercised effect stays pending reconciliation.
```

What you can run today is the local walkthrough above and the kernel around an effect of your own. The combined coordinator workflow lives in Lore Plugin and the host's tools. Installing the kit and consuming this source cut are separate choices: its pinned kernel does not change merely because a new source snapshot exists. This illustration describes the intended experience; no novice-user trial, institutional pilot or autonomous transfer is established by it.

### Why keep the operation separate from the app?

An app's useful result and its permission to produce that result are different questions. You may want the booking screen built, while still reserving the choice to expose customer data or pay for a service. You may also want tomorrow's worker to know that Tuesday's hours changed without inventing a new permission. The kernel offers reusable authority, gate, receipt and continuation semantics so those questions have a place in the code and the record. [The catalog](./docs/CAPABILITIES.md) shows the actual API and the limits beside it; the host remains responsible for storage, identities and effects.

This is why the goal is to return time and agency rather than fill every recovered minute with more output. That goal appears in [GENESIS](./docs/GENESIS.md) as a working thesis, not a measured productivity result. A capability belongs in an operation when it buys a material difference for that work. A mature local workflow can remain sufficient without activating Vespi.

### Authority, a human gate and receipts

The kernel is JavaScript without runtime dependencies. A capability declares its requirements; the operation checks authority before `perform`, asks the human gate when required and obtains a separate verification result. [Authority tests](./test/k2.test.js) cover asset, ceiling, destination, expiry and distinct named approvals, but ordinary approval names are labels rather than authenticated signatures and money budgets are not accumulated across operations. The host controls its tools, identities, clock and storage.

[Receipt tests](./test/k3.test.js) cover the SHA-256 digest, named successful checks and omissions, but the digest proves integrity rather than authenticity and can be recomputed by anyone who rewrites the receipt. An external anchor requires a separate confirmation of digest and network. D3: newly built receipts stamp `stellar:testnet` in their pending anchor even for local work; [receipt.js](./src/receipt.js) excludes that anchor from the digest, and the default becomes configurable in 0.1.5. All chain evidence here is testnet, on fictional data and with no real money.

The [capability catalog](./docs/CAPABILITIES.md) explains the API and host responsibilities. [Respaldo](./capabilities/respaldo/LEEME.md), a capability outside the kernel, copies a working tree into a folder that a sync service can watch, as [its tests](./test/respaldo.test.js) demonstrate, but does not encrypt, upload through service APIs or keep backup versions.

### What 0.1.4 brings

The [continuation tests](./test/v014.test.js) cover reconciliation before repeating an uncertain exercised action, a stable key passed to `perform`, attempt limits and an injected synchronous clock, but destination deduplication, trustworthy time and waking the process belong to the host. Delegation deadlines remain consultative.

The [0.1.3 note](./docs/RELEASE_0.1.3_KERNEL.md) announced emergency access, zero knowledge, skill provenance and x402 inside the kernel. All enter 0.1.4 under the limits in the [bilingual release note](./docs/RELEASE_0.1.4_KERNEL.md). [Emergency tests](./test/k1-emergencia-r6-advisor.test.js) cover prior authority and reviews using host-issued opaque principals, but the kernel does not authenticate real people, persist the ledger, execute or verify the effect, or provide trusted time; D4 counts uses, with the money ceiling left to the project. [Provenance tests](./test/k2-procedencia-r5-advisor.test.js) cover a resolver's own evidence and hostile data, including polluted prototype data, but not built-in function replacement by same-process code; `provenanceSource` distinguishes verified from declared evidence and the skill name stays declared.

[x402 tests](./test/k4-x402-r3-advisor.test.js) exercise the paid-effect contract through injected ports with mandatory synchronous `claims` and operation identity in the effect key, but the memory store is not durable, reservations are not released and the validator's body digest is not recomputed by the kernel. The [SDK bridge tests](./demo/x402/bridge.test.mjs) exercise real SDK objects over loopback according to the builder's report, but the bridge has no final independent review, no verified live payment and no tested real Soroban RPC payload path. [The minimal example](./examples/x402-app.js) uses simulated ports.

[ZK tests](./test/k3b-zk-port.test.js) cover a pinned key and agreed public inputs, but trust the injected backend. The internal [BN254 Groth16 reference](./src/zk-bn254-reference.js) has [fixture and arithmetic evidence](./test/fixtures/zk/independent-report.md), but proofs are malleable, a degenerate key accepts forgeries, synchronous verification cannot be interrupted by a Promise timeout, and there is no external audit or production readiness. These modules do not demonstrate integration with Casa Firme or Vela. D5: Vela's sealed content remains plaintext in the demonstration according to the owner's declaration; a real deployment requires encryption at rest and third-party key custody.

### Evidence you can open

[The evidence file](./docs/testnet-evidence.json) records 50 successful testnet transactions read back from Horizon, with 5 cases semantically verified and 45 partially verified, and 0 discrepancies. Expectations come from local execution records rather than Horizon; partial checks do not fill in missing facts. [The evidence guide](./docs/TESTNET_EVIDENCE.md) owns the transaction links, field coverage and historical payment details, including the older adapter's saved x402 receipt. That history does not validate the new bridge. Check file shape offline with `node scripts/verify-testnet-evidence.mjs --offline`; the guide also provides a comparison against saved responses and an optional network refresh.

### The TEMIS record, read at its actual boundary

TEMIS is a bilateral-agreement record used to pressure authority and receipts with fictional data on testnet. Its saved [execution account](./docs/evidence-records/temis-tramos/3/recibo.md) describes registration, signatures, anchors, milestones, corrections, challenges and a reconstruction by a model that did not build it. You can open the [comparison record](./docs/evidence-records/temis-tramos/3/cruce-con-tercero-exp-murckqaa.json) and see both the lifecycle labels it reports as matching and the differences it found when comparing the local copy. Those are declared run results; the transaction-field verifier does not reproduce the lifecycle logic or that third-party reconstruction.

The distinction matters for review. A digest memo and a successful ledger record can support an anchor claim without proving that an agreement is legally valid, that a human signed it or that a disputed milestone was fulfilled. The public transaction is one piece of the evidence; the agreement, the local record and the observer's scope remain necessary. [The evidence guide](./docs/TESTNET_EVIDENCE.md) owns the transaction comparison and its omissions, so a reader can weigh this case without treating every label in a run report as a chain fact.

### The functional projects

The projects explore uses of bounded authority and receipts with fictional data. [Queen](https://github.com/andresanemic/queen) explores marketing budgets and paid services; [Permamuseum](https://github.com/andresanemic/permamuseum) cultural heritage and provenance; [Casa Firme](https://github.com/andresanemic/casa-firme) housing committees and donation records; [Ficha Contigo](https://github.com/andresanemic/ficha-contigo) patient-granted clinical access; [Cátedra](https://github.com/andresanemic/catedra) declared AI use and academic credentials; [Escribano](https://github.com/andresanemic/escribano) governance records; [Llavero](https://github.com/andresanemic/llavero) data permissions; [Farolero](https://github.com/andresanemic/farolero) delegated authority; [Marea](https://github.com/andresanemic/marea) climate commitments; and [Vela](https://github.com/andresanemic/vela) protected sources. [TEMIS](https://github.com/andresanemic/temis) supplies the bilateral-agreement run records used in the testnet evidence. These are evidence candidates for Vespi, not separate claims of institutional adoption, production readiness or integration with this new kernel.

The repositories remain public and currently contain README files only, according to the owner's access schedule. Code is scheduled to enter the main branch by a push on 12 October 2026 at 20:29 Chile time and to be removed from that branch by another push on 16 October at 19:31. The margin is 30 minutes around deliberation, from 12 October at 20:59 to 16 October at 19:01. Removing code with a new commit does not erase it from Git history, and an obtained copy cannot be withdrawn. Project suites cannot be reproduced from README-only repositories today; this kernel suite does not replace them.

### Lore Plugin and the build method

[Lore Plugin](https://github.com/andresanemic/lore-plugin) supplies criterion and the coordinator workflow; Vespi supplies the authority and receipt semantics around an operation. The [method](./docs/METHOD.md) describes loops, test-first work, specifications, bounded delegation, blind reading and separate verification; it is a workflow for host tools, not a kernel that generates apps or images itself. Lore Plugin carries a pinned kernel, so this source snapshot does not update an installed kit automatically.

The prior agreement's why, what and how remain distinct: preserve your agency and avoid repeated decisions; keep bounded authority, a human gate and receipts; choose an implementation only where evidence supports it. The [verification record](./docs/VERIFICATION.md), [judge findings from the earlier cut](./docs/JUDGES_FINDINGS_0.1.4.md), [prior-art notes](./docs/PRIOR_ART.md) and [experiments](./experiments/) retain construction history. Model reviews independent of the builders are not an external security audit. The method credits [The Fable Method](https://github.com/Sahir619/fable-method); Raven MCP, Stellar and the Lore/LUS work belong to the construction narrative, not proof that the whole product operates autonomously.

### Institutions, direction and construction history

An institution can inspect and adapt the source under the kernel's Apache license in its own environment, but this repository is not a hosted service, an institutional adoption record or a compliance certificate. Permission, observation and record retention still need a consuming project's agreement. The clinical and protected-source examples do not turn into real confidential deployments by adding an emergency grant or a ZK verifier. Their data custody and legal decisions remain outside this experimental kernel.

The direction is to coordinate work using whichever capabilities the operation actually needs, including the Stellar ecosystem's services where they help. Becoming an operating system for that ecosystem remains an ambition. Find Your Way and Meridian are the submission context, not evidence of endorsement, partnership, funding or an official relationship. Lore, Lore Plugin and LUS are the criterion and research lineage described in [GENESIS](./docs/GENESIS.md); LUS is not a runtime component.

The construction narrative retains its sources without turning them into endorsements. [The method](./docs/METHOD.md) records the Fable attribution and distinguishes the coordinator's loop from kernel behavior. [The verification history](./docs/VERIFICATION.md) records earlier practices and model reviews; its older counts belong to their own cuts and do not replace this version's suite. Raven-assisted source discovery is recorded in [TEMIS's source notes](./docs/evidence-records/temis-tramos/0/fuentes.md), but discovery is not implementation or proof of an entire ecosystem's coverage. The earlier OpenAI incident, ultrareview, Superpowers and fly-connectome references belong to the origin narrative; no current security guarantee follows from naming them. The fly was an analogy for behavior arising from structure, not a claim that Vespi is a brain or learns.

[The prior-art study](./docs/PRIOR_ART.md) compares authority, durable execution, supervision and receipts and explains why a stable effect key does not supply exactly-once execution on its own. It is a dated comparison with its source-reading limits, not a current claim that no neighboring project coordinates operations. Historical experiments and rejected candidates remain in [experiments](./experiments/). Keeping them visible lets you see how the contract changed without presenting an old run as validation of a new module.

### What 0.1.4 does NOT bring and moves to 0.1.5

Spend-authority narrowing stays out because the base `grantSpend` constructor has an inherited-setter defect. The [release note](./docs/RELEASE_0.1.4_KERNEL.md#what-014-does-not-bring-and-moves-to-015) gives each reason for deferring x402 HX-09, HX-11, HX-12, HX-13, R2-05 and H11; provenance N07, N08, H12d and H13d; emergency H21; and bridge R2-11 and R2-12. The remaining `todo` cases document declared contract boundaries, including same-process function replacement and validator output limits, rather than all promising future fixes.

There is no durable emergency or payment store, autonomous cross-host runtime, scheduler, mainnet evidence, second payment provider, external security audit, regulatory certification or production readiness. In the working architecture, operation semantics remain `SUPPORTED`, autonomous operation `UNTESTED`, and the Final Vespi Gate `READY_FOR_MUSE_DISCOVERY` and `NOT_READY_FOR_IMPLEMENTATION`. Those labels describe candidates and limits, not runtime capabilities delivered to users.

### Author and license

Andrés Peña Mellado, Digital Art Director & Creative Developer. [Telegram](https://t.me/andresanemic), [X](https://x.com/andresanemic), [LinkedIn](https://www.linkedin.com/in/andresanemic/). Kernel license: [Apache-2.0](./LICENSE), with attribution in [NOTICE](./NOTICE).

---

## Español

<a id="español"></a>

### Empieza con una operación

Desde una copia de código de este repositorio, con Node.js 24 disponible, corre el [recorrido local](./docs/WALKTHROUGH.md), responde al terminal con `Ada: approve` y revisa `status`, `coverage` y `notCovered` del recibo:

```sh
node examples/walkthrough.js
node --test "test/*.test.js"
```

[La prueba del recorrido](./test/walkthrough.test.js) comprueba un efecto local observado y la selección de la siguiente acción en otro proceso, pero el recibo se pasa explícitamente a ese proceso: no demuestra transporte automático, almacenamiento durable ni identidad humana autenticada. La suite del kernel informa 1173 pruebas, 1149 aprobadas, 0 fallidas y 24 `todo`; esos casos pendientes o de frontera no son pruebas aprobadas. [La guía para jueces](./docs/FOR_JUDGES.md) explica cómo reproducir la evidencia y sus límites.

### Cómo se ve para una persona

El propósito es conservar lo que ya decidiste cuando cambia la sesión, la herramienta o quien hace el trabajo. Un resumen ayuda a entender el proyecto, pero no es un permiso ni demuestra que un efecto externo haya ocurrido. El kernel vuelve explícitas esas preguntas. Puedes usarlo alrededor de trabajo con IA o sin ella, con ancla de cadena o sin ella; la operación decide qué capacidades necesita. Es una biblioteca que configura un host, no un servicio instalado que se hace cargo de tu trabajo.

**Ejemplo ficticio.** Maya quiere una app de reservas para su peluquería de barrio, La Esquina. La persona, el negocio, los horarios y los precios son inventados; ilustra el método del coordinador con herramientas del host, no una corrida de un generador de apps dentro del kernel.

```text
[COORDINADOR]
Antes de construir redactaremos el acuerdo: qué debe hacer la app, quién otorga
la autoridad, qué gasto permite y qué significa terminar. Después escribiremos
especificaciones y comprobaciones de aceptación, construiremos la app local,
pediremos a un lector que no la hizo que pruebe el flujo y verificaremos aparte.

Necesito tus decisiones sobre autoridad, techo de dinero y publicación.

[MAYA]
Otorgo autoridad para un prototipo local, sin servicios pagados. No publiques
hasta que apruebe la vista previa final.
```

Esa decisión queda en el acuerdo. Un host con las herramientas necesarias puede construir las reservas, redactar publicaciones o generar imágenes; las herramientas realizan el trabajo. El kernel puede comprobar la autoridad declarada y registrar resultados, mientras el método del coordinador organiza especificaciones, tareas acotadas y verificación. El prototipo y su difusión son efectos distintos: el permiso para construir localmente no se vuelve permiso para difundir solo porque la app ya funcione.

```text
[COORDINADOR]
El flujo de reservas y sus comprobaciones están listos. Aquí tienes la vista
previa y las publicaciones propuestas. ¿Apruebas esta publicación exacta?

[MAYA]
Todavía no. Cambia el horario del martes y vuelve a mostrarme la vista previa.
```

Maya no necesita repetir todo el propósito del proyecto para cambiar ese horario. La siguiente acción cambia, el coordinador lo registra y vuelve con el resultado corregido. Si una herramienta informa una publicación incierta tras un timeout de red, la operación no puede tomar la falta de respuesta como prueba de que nada salió. Devuelve la incertidumbre para reconciliarla mediante la continuidad descrita abajo. Conserva una decisión para la persona, en vez de prometer que cualquier reintento es inofensivo.

```text
[SIGUIENTE SESIÓN]
El host carga el acuerdo y los recibos. El coordinador comprueba qué sigue
valiendo, qué se verificó y qué cambió antes de elegir la siguiente acción.
Un efecto ejercido incierto sigue pendiente de reconciliación.
```

Hoy puedes correr el recorrido local de arriba y usar el kernel alrededor de un efecto propio. El flujo combinado del coordinador vive en Lore Plugin y las herramientas del host. Instalar el kit y consumir este corte de código son decisiones separadas: su kernel fijo no cambia porque exista un nuevo corte de fuente. El ejemplo describe la experiencia buscada; no establece prueba con personas sin experiencia, piloto institucional ni transporte autónomo.

### ¿Por qué separar la operación de la app?

El resultado útil de una app y su permiso para producirlo son preguntas distintas. Puedes querer construir la pantalla de reservas y reservarte la decisión de exponer datos de clientes o pagar por un servicio. También puedes querer que quien trabaje mañana sepa que cambió el horario del martes sin inventar un permiso nuevo. El kernel ofrece semántica reutilizable de autoridad, puerta, recibos y continuidad para que esas preguntas tengan lugar en el código y en el registro. [El catálogo](./docs/CAPABILITIES.md) muestra la API real con sus límites; el host sigue a cargo de almacenamiento, identidades y efectos.

Por eso la meta es devolverte tiempo y agencia, en vez de llenar cada minuto recuperado con más producción. [GENESIS](./docs/GENESIS.md) la conserva como tesis de trabajo, no como resultado medido de productividad. Una capacidad entra si compra una diferencia material para la operación. Un flujo local maduro puede seguir siendo suficiente sin activar Vespi.

### Autoridad, puerta humana y recibos

El kernel es JavaScript sin dependencias de runtime. Una capacidad declara sus requisitos; la operación comprueba autoridad antes de `perform`, consulta la puerta humana cuando corresponde y recibe una verificación separada. [Las pruebas de autoridad](./test/k2.test.js) cubren activo, techo, destino, vencimiento y aprobaciones con nombres distintos, pero los nombres de aprobación ordinaria son etiquetas y no firmas autenticadas, y los presupuestos de dinero no se acumulan entre operaciones. El host controla herramientas, identidades, reloj y almacenamiento.

[Las pruebas de recibos](./test/k3.test.js) cubren el digest SHA-256, comprobaciones exitosas con nombre y omisiones, pero el digest demuestra integridad y no autenticidad, y cualquiera que reescriba el recibo puede recalcularlo. Un ancla externa exige confirmar por separado digest y red. D3: todo recibo nuevo estampa `stellar:testnet` en su ancla pendiente incluso para trabajo local; [receipt.js](./src/receipt.js) excluye el ancla del digest, y el valor predeterminado se parametriza en 0.1.5. Toda evidencia de cadena aquí es testnet, con datos ficticios y sin dinero real.

[El catálogo de capacidades](./docs/CAPABILITIES.md) explica la API y las responsabilidades del host. [Respaldo](./capabilities/respaldo/LEEME.md), una capacidad fuera del kernel, copia el árbol de trabajo a una carpeta que puede observar un servicio de sincronización, como demuestran [sus pruebas](./test/respaldo.test.js), pero no cifra, no sube por API de servicios ni conserva versiones del respaldo.

### Qué trae el 0.1.4

[Las pruebas de continuidad](./test/v014.test.js) cubren reconciliación antes de repetir una acción ejercida incierta, una clave estable que recibe `perform`, topes de intentos y un reloj síncrono inyectado, pero la deduplicación en el destino, el tiempo confiable y despertar el proceso corresponden al host. Los plazos de delegación siguen siendo consultivos.

[La nota del 0.1.3](./docs/RELEASE_0.1.3_KERNEL.md) anunció emergencia, conocimiento cero, procedencia de skills y x402 dentro del kernel. Todo entra al 0.1.4 con los límites de [la nota bilingüe](./docs/RELEASE_0.1.4_KERNEL.md). [Las pruebas de emergencia](./test/k1-emergencia-r6-advisor.test.js) cubren autoridad anticipada y revisión con principales opacos del host, pero el kernel no autentica personas reales, no persiste el registro, no ejecuta ni verifica el efecto y no aporta tiempo confiable; D4 cuenta usos y deja el techo en dinero al proyecto. [Las pruebas de procedencia](./test/k2-procedencia-r5-advisor.test.js) cubren evidencia propia del resolver y datos hostiles, incluidos datos en prototipos contaminados, pero no sustitución de funciones integradas por código del mismo proceso; `provenanceSource` distingue evidencia verificada de declarada y el nombre de la skill sigue declarado.

[Las pruebas x402](./test/k4-x402-r3-advisor.test.js) ejercitan el contrato de efecto pagado por puertos inyectados con `claims` obligatorio y síncrono e identidad de operación en la clave del efecto, pero el almacén en memoria no es durable, las reservas no se liberan y el kernel no recalcula el digest del cuerpo que declara el validador. [Las pruebas del puente con SDK](./demo/x402/bridge.test.mjs) ejercitan objetos reales del SDK en loopback según el informe del constructor, pero el puente no tiene revisión final independiente, pago en vivo verificado ni prueba del camino real Soroban RPC para el payload. [El ejemplo mínimo](./examples/x402-app.js) usa puertos simulados.

[Las pruebas ZK](./test/k3b-zk-port.test.js) cubren clave fijada y entradas públicas acordadas, pero confían en el backend inyectado. La [referencia interna BN254 con Groth16](./src/zk-bn254-reference.js) tiene [evidencia de fixtures y aritmética](./test/fixtures/zk/independent-report.md), pero las pruebas son maleables, una clave degenerada acepta falsificaciones, un timeout con Promise no puede interrumpir la verificación síncrona y no hay auditoría externa ni preparación para producción. Estos módulos no demuestran integración con Casa Firme o Vela. D5: el contenido sellado de Vela queda en claro en la demostración según la declaración del dueño; un despliegue real exige cifrado en reposo y custodia de claves de un tercero.

### Evidencia que puedes abrir

[El archivo de evidencia](./docs/testnet-evidence.json) registra 50 transacciones exitosas en testnet leídas de Horizon, con 5 casos verificados semánticamente, 45 parcialmente verificados y 0 discrepancias. Las expectativas vienen de registros locales de ejecución y no de Horizon; las comprobaciones parciales no completan hechos ausentes. [La guía de evidencia](./docs/TESTNET_EVIDENCE.md) contiene los enlaces de transacciones, la cobertura por campos y los detalles de pagos históricos, incluido el recibo x402 del adaptador anterior. Esa historia no valida el puente nuevo. Comprueba la forma del archivo sin red con `node scripts/verify-testnet-evidence.mjs --offline`; la guía también permite comparar respuestas guardadas y volver a consultar la red de forma opcional.

### El registro de TEMIS y su frontera real

TEMIS es un registro de acuerdos bilaterales que presiona autoridad y recibos con datos ficticios en testnet. [Su relato de ejecución guardado](./docs/evidence-records/temis-tramos/3/recibo.md) describe alta, firmas, anclas, hitos, correcciones, impugnaciones y una reconstrucción por un modelo que no lo construyó. Puedes abrir [el registro del cotejo](./docs/evidence-records/temis-tramos/3/cruce-con-tercero-exp-murckqaa.json) y ver tanto los estatus que declara coincidentes como las diferencias que encontró al comparar la copia local. Son resultados declarados de una corrida; el verificador de hechos de transacciones no reproduce las reglas del ciclo de vida ni la reconstrucción del tercero.

La distinción importa al revisar. Un memo de digest y un registro exitoso de ledger pueden sostener un ancla sin probar que un acuerdo sea legalmente válido, que una persona lo firmó o que se cumplió un hito impugnado. La transacción pública es una parte de la evidencia; el acuerdo, el registro local y el alcance del observador siguen siendo necesarios. [La guía de evidencia](./docs/TESTNET_EVIDENCE.md) contiene la comparación y sus omisiones para que valores el caso sin tomar cada estatus del informe como un hecho de cadena.

### Los proyectos funcionales

Los proyectos exploran usos de autoridad acotada y recibos con datos ficticios. [Queen](https://github.com/andresanemic/queen) explora presupuestos de marketing y servicios pagados; [Permamuseum](https://github.com/andresanemic/permamuseum), patrimonio cultural y procedencia; [Casa Firme](https://github.com/andresanemic/casa-firme), comités de vivienda y registros de donaciones; [Ficha Contigo](https://github.com/andresanemic/ficha-contigo), acceso clínico otorgado por pacientes; [Cátedra](https://github.com/andresanemic/catedra), uso declarado de IA y credenciales académicas; [Escribano](https://github.com/andresanemic/escribano), registros de gobernanza; [Llavero](https://github.com/andresanemic/llavero), permisos de datos; [Farolero](https://github.com/andresanemic/farolero), autoridad delegada; [Marea](https://github.com/andresanemic/marea), compromisos climáticos; y [Vela](https://github.com/andresanemic/vela), fuentes protegidas. [TEMIS](https://github.com/andresanemic/temis) aporta los registros de acuerdos bilaterales usados en la evidencia de testnet. Son candidatas de evidencia para Vespi, no afirmaciones separadas de adopción institucional, preparación para producción ni integración con este kernel nuevo.

Los repositorios son siempre públicos y hoy contienen solo README, según el calendario de acceso del dueño. El código entra por un push a la rama principal el 12 de octubre de 2026 a las 20:29, hora de Chile, y se retira de esa rama por otro push el 16 de octubre a las 19:31. El margen es de 30 minutos alrededor de la deliberación, del 12 de octubre a las 20:59 al 16 de octubre a las 19:01. Retirar el código con un commit nuevo no lo borra del historial de Git, y una copia que ya obtuviste no se puede retirar. Hoy no puedes reproducir las suites de los proyectos desde repositorios que solo contienen README; la suite de este kernel no las reemplaza.

### Lore Plugin y el método de construcción

[Lore Plugin](https://github.com/andresanemic/lore-plugin) aporta el criterio y el flujo del coordinador; Vespi aporta la semántica de autoridad y recibos alrededor de una operación. [El método](./docs/METHOD.md) describe ciclos, pruebas primero, especificaciones, delegación acotada, lectura ciega y verificación separada; es un flujo de trabajo para herramientas del host, no un kernel que genere apps o imágenes por sí solo. Lore Plugin lleva una copia fija del kernel, por lo que este corte de código no actualiza automáticamente un kit instalado.

El eje porqué/qué/cómo del acuerdo previo conserva sus partes: cuidar tu agencia y evitar decisiones repetidas; mantener autoridad acotada, puerta humana y recibos; elegir una implementación solo donde la evidencia la sostenga. [El registro de verificación](./docs/VERIFICATION.md), [los hallazgos de jueces del corte anterior](./docs/JUDGES_FINDINGS_0.1.4.md), [las notas de arte previo](./docs/PRIOR_ART.md) y [los experimentos](./experiments/) conservan la historia de construcción. Las revisiones por modelos independientes de sus constructores no son una auditoría de seguridad externa. El método acredita [The Fable Method](https://github.com/Sahir619/fable-method); Raven MCP, Stellar y el trabajo de Lore/LUS pertenecen al relato de construcción, no prueban que el producto completo opere de forma autónoma.

### Instituciones, rumbo e historia de construcción

Una institución puede revisar y adaptar el código bajo la licencia Apache del kernel en su propio entorno, pero este repositorio no es un servicio alojado, un registro de adopción institucional ni un certificado de cumplimiento. Permisos, observación y conservación de registros necesitan el acuerdo del proyecto consumidor. Los ejemplos clínicos y de fuentes protegidas no se vuelven despliegues confidenciales reales por añadir un permiso de emergencia o un verificador ZK. La custodia de datos y las decisiones legales quedan fuera de este kernel experimental.

El rumbo es coordinar trabajo con las capacidades que la operación necesite, incluidos servicios del ecosistema Stellar cuando aporten. Ser un sistema operativo para ese ecosistema sigue siendo una ambición. Find Your Way y Meridian son el contexto de postulación, no evidencia de respaldo, alianza, financiamiento ni relación oficial. Lore, Lore Plugin y LUS son el linaje de criterio e investigación descrito en [GENESIS](./docs/GENESIS.md); LUS no es un componente del runtime.

El relato de construcción conserva sus fuentes sin convertirlas en respaldos. [El método](./docs/METHOD.md) registra la atribución a Fable y separa el ciclo del coordinador del comportamiento del kernel. [La historia de verificación](./docs/VERIFICATION.md) registra prácticas y revisiones por modelos anteriores; sus cifras pertenecen a sus cortes y no reemplazan la suite de esta versión. El descubrimiento de fuentes con Raven figura en [las notas de fuentes de TEMIS](./docs/evidence-records/temis-tramos/0/fuentes.md), pero descubrir no equivale a implementar ni probar cobertura de un ecosistema entero. Las referencias previas al incidente de OpenAI, ultrareview, Superpowers y el conectoma de la mosca pertenecen al relato de origen; nombrarlas no sostiene una garantía actual de seguridad. La mosca fue una analogía de comportamiento surgido de estructura, no una afirmación de que Vespi sea un cerebro o aprenda.

[El estudio de arte previo](./docs/PRIOR_ART.md) compara autoridad, ejecución durable, supervisión y recibos, y explica por qué una clave estable no aporta por sí sola ejecución exactamente una vez. Es una comparación fechada con sus límites de lectura de fuentes, no una afirmación actual de que ningún proyecto vecino coordine operaciones. Los experimentos históricos y candidatos rechazados siguen en [experiments](./experiments/). Conservarlos permite ver cómo cambió el contrato sin presentar una corrida antigua como validación de un módulo nuevo.

### Qué NO trae el 0.1.4 y pasa al 0.1.5

El comparador de reducción de autoridad de gasto queda fuera por un defecto de setters heredados en el constructor base `grantSpend`. [La nota de versión](./docs/RELEASE_0.1.4_KERNEL.md#qué-no-trae-el-014-y-pasa-al-015) da el motivo de cada punto diferido: x402 HX-09, HX-11, HX-12, HX-13, R2-05 y H11; procedencia N07, N08, H12d y H13d; emergencia H21; puente R2-11 y R2-12. Los demás `todo` documentan fronteras declaradas del contrato, como sustitución de funciones dentro del proceso y límites de la salida del validador, sin prometer un arreglo futuro para todas ellas.

No hay almacén durable de emergencia ni de pagos, runtime autónomo entre hosts, planificador, evidencia de mainnet, segundo proveedor de pagos, auditoría de seguridad externa, certificación regulatoria ni preparación para producción. En la arquitectura de trabajo, la semántica de operación sigue `SUPPORTED`, la operación autónoma `UNTESTED` y el Final Vespi Gate `READY_FOR_MUSE_DISCOVERY` y `NOT_READY_FOR_IMPLEMENTATION`. Esas etiquetas describen candidatas y límites, no capacidades de runtime entregadas a usuarios.

### Autor y licencia

Andrés Peña Mellado, Digital Art Director & Creative Developer. [Telegram](https://t.me/andresanemic), [X](https://x.com/andresanemic), [LinkedIn](https://www.linkedin.com/in/andresanemic/). Licencia del kernel: [Apache-2.0](./LICENSE), con atribución en [NOTICE](./NOTICE).
