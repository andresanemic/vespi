# Vespi

Vespi keeps the authority you granted, the checked result and the next agreed action together when work changes hands. You resume what still holds; an uncertain exercised effect returns to you for reconciliation. Kernel `0.1.4`: [fecha de publicación]. This is tested operation semantics, with host-managed storage and execution, not demonstrated autonomous work across hosts.

Vespi conserva juntas la autoridad que otorgaste, el resultado comprobado y la siguiente acción acordada cuando el trabajo cambia de manos. Retomas lo que sigue valiendo; un efecto ejercido incierto vuelve a ti para reconciliarlo. Kernel `0.1.4`: [fecha de publicación]. Es semántica de operación probada, con almacenamiento y ejecución a cargo del host, no trabajo autónomo demostrado entre hosts.

[![Vespiqueen genesis](./assets/vespiqueen-genesis.png)](./assets/vespiqueen-genesis.png)

## English

<a id="english"></a>

### Start with an operation

Run the [offline walkthrough](./docs/WALKTHROUGH.md), answer its terminal prompt with `Ada: approve`, and inspect the returned `status`, `coverage` and `notCovered`:

```sh
node examples/walkthrough.js
node --test "test/*.test.js"
```

The walkthrough's [test](./test/walkthrough.test.js) checks an observed local effect and a next action selected in another process, but the receipt is passed to that process explicitly: this does not demonstrate automatic transfer, durable storage or authenticated human identity. The kernel suite reports 1173 tests, 1149 passed, 0 failed and 24 `todo`; those pending or boundary cases are not passing tests. The [judge guide](./docs/FOR_JUDGES.md) explains how to reproduce the evidence and its limits.

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

### The functional projects

The projects explore uses of bounded authority and receipts with fictional data. [Queen](https://github.com/andresanemic/queen) explores marketing budgets and paid services; [Permamuseum](https://github.com/andresanemic/permamuseum) cultural heritage and provenance; [Casa Firme](https://github.com/andresanemic/casa-firme) housing committees and donation records; [Ficha Contigo](https://github.com/andresanemic/ficha-contigo) patient-granted clinical access; [Cátedra](https://github.com/andresanemic/catedra) declared AI use and academic credentials; [Escribano](https://github.com/andresanemic/escribano) governance records; [Llavero](https://github.com/andresanemic/llavero) data permissions; [Farolero](https://github.com/andresanemic/farolero) delegated authority; [Marea](https://github.com/andresanemic/marea) climate commitments; and [Vela](https://github.com/andresanemic/vela) protected sources. [TEMIS](https://github.com/andresanemic/temis) supplies the bilateral-agreement run records used in the testnet evidence. These are evidence candidates for Vespi, not separate claims of institutional adoption, production readiness or integration with this new kernel.

The repositories remain public and currently contain README files only, according to the owner's access schedule. Code is scheduled to enter the main branch by a push on 12 October 2026 at 20:29 Chile time and to be removed from that branch by another push on 16 October at 19:31. The margin is 30 minutes around deliberation, from 12 October at 20:59 to 16 October at 19:01. Removing code with a new commit does not erase it from Git history, and an obtained copy cannot be withdrawn. Project suites cannot be reproduced from README-only repositories today; this kernel suite does not replace them.

### Lore Plugin and the build method

[Lore Plugin](https://github.com/andresanemic/lore-plugin) supplies criterion and the coordinator workflow; Vespi supplies the authority and receipt semantics around an operation. The [method](./docs/METHOD.md) describes loops, test-first work, specifications, bounded delegation, blind reading and separate verification; it is a workflow for host tools, not a kernel that generates apps or images itself. Lore Plugin carries a pinned kernel, so this source snapshot does not update an installed kit automatically.

The prior agreement's why, what and how remain distinct: preserve your agency and avoid repeated decisions; keep bounded authority, a human gate and receipts; choose an implementation only where evidence supports it. The [verification record](./docs/VERIFICATION.md), [judge findings from the earlier cut](./docs/JUDGES_FINDINGS_0.1.4.md), [prior-art notes](./docs/PRIOR_ART.md) and [experiments](./experiments/) retain construction history. Model reviews independent of the builders are not an external security audit. The method credits [The Fable Method](https://github.com/Sahir619/fable-method); Raven MCP, Stellar and the Lore/LUS work belong to the construction narrative, not proof that the whole product operates autonomously.

### What 0.1.4 does NOT bring and moves to 0.1.5

Spend-authority narrowing stays out because the base `grantSpend` constructor has an inherited-setter defect. The [release note](./docs/RELEASE_0.1.4_KERNEL.md#what-014-does-not-bring-and-moves-to-015) gives each reason for deferring x402 HX-09, HX-11, HX-12, HX-13, R2-05 and H11; provenance N07, N08, H12d and H13d; emergency H21; and bridge R2-11 and R2-12. The remaining `todo` cases document declared contract boundaries, including same-process function replacement and validator output limits, rather than all promising future fixes.

There is no durable emergency or payment store, autonomous cross-host runtime, scheduler, mainnet evidence, second payment provider, external security audit, regulatory certification or production readiness. In the working architecture, operation semantics remain `SUPPORTED`, autonomous operation `UNTESTED`, and the Final Vespi Gate `READY_FOR_MUSE_DISCOVERY` and `NOT_READY_FOR_IMPLEMENTATION`. Those labels describe candidates and limits, not runtime capabilities delivered to users.

### Author and license

Andrés Peña Mellado, Digital Art Director & Creative Developer. [Telegram](https://t.me/andresanemic), [X](https://x.com/andresanemic), [LinkedIn](https://www.linkedin.com/in/andresanemic/). Kernel license: [Apache-2.0](./LICENSE), with attribution in [NOTICE](./NOTICE).

---

## Español

<a id="español"></a>

### Empieza con una operación

Corre el [recorrido local](./docs/WALKTHROUGH.md), responde al terminal con `Ada: approve` y revisa `status`, `coverage` y `notCovered` del recibo:

```sh
node examples/walkthrough.js
node --test "test/*.test.js"
```

[La prueba del recorrido](./test/walkthrough.test.js) comprueba un efecto local observado y la selección de la siguiente acción en otro proceso, pero el recibo se pasa explícitamente a ese proceso: no demuestra transporte automático, almacenamiento durable ni identidad humana autenticada. La suite del kernel informa 1173 pruebas, 1149 aprobadas, 0 fallidas y 24 `todo`; esos casos pendientes o de frontera no son pruebas aprobadas. [La guía para jueces](./docs/FOR_JUDGES.md) explica cómo reproducir la evidencia y sus límites.

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

### Los proyectos funcionales

Los proyectos exploran usos de autoridad acotada y recibos con datos ficticios. [Queen](https://github.com/andresanemic/queen) explora presupuestos de marketing y servicios pagados; [Permamuseum](https://github.com/andresanemic/permamuseum), patrimonio cultural y procedencia; [Casa Firme](https://github.com/andresanemic/casa-firme), comités de vivienda y registros de donaciones; [Ficha Contigo](https://github.com/andresanemic/ficha-contigo), acceso clínico otorgado por pacientes; [Cátedra](https://github.com/andresanemic/catedra), uso declarado de IA y credenciales académicas; [Escribano](https://github.com/andresanemic/escribano), registros de gobernanza; [Llavero](https://github.com/andresanemic/llavero), permisos de datos; [Farolero](https://github.com/andresanemic/farolero), autoridad delegada; [Marea](https://github.com/andresanemic/marea), compromisos climáticos; y [Vela](https://github.com/andresanemic/vela), fuentes protegidas. [TEMIS](https://github.com/andresanemic/temis) aporta los registros de acuerdos bilaterales usados en la evidencia de testnet. Son candidatas de evidencia para Vespi, no afirmaciones separadas de adopción institucional, preparación para producción ni integración con este kernel nuevo.

Los repositorios son siempre públicos y hoy contienen solo README, según el calendario de acceso del dueño. El código entra por un push a la rama principal el 12 de octubre de 2026 a las 20:29, hora de Chile, y se retira de esa rama por otro push el 16 de octubre a las 19:31. El margen es de 30 minutos alrededor de la deliberación, del 12 de octubre a las 20:59 al 16 de octubre a las 19:01. Retirar el código con un commit nuevo no lo borra del historial de Git, y una copia que ya obtuviste no se puede retirar. Hoy no puedes reproducir las suites de los proyectos desde repositorios que solo contienen README; la suite de este kernel no las reemplaza.

### Lore Plugin y el método de construcción

[Lore Plugin](https://github.com/andresanemic/lore-plugin) aporta el criterio y el flujo del coordinador; Vespi aporta la semántica de autoridad y recibos alrededor de una operación. [El método](./docs/METHOD.md) describe ciclos, pruebas primero, especificaciones, delegación acotada, lectura ciega y verificación separada; es un flujo de trabajo para herramientas del host, no un kernel que genere apps o imágenes por sí solo. Lore Plugin lleva una copia fija del kernel, por lo que este corte de código no actualiza automáticamente un kit instalado.

El eje porqué/qué/cómo del acuerdo previo conserva sus partes: cuidar tu agencia y evitar decisiones repetidas; mantener autoridad acotada, puerta humana y recibos; elegir una implementación solo donde la evidencia la sostenga. [El registro de verificación](./docs/VERIFICATION.md), [los hallazgos de jueces del corte anterior](./docs/JUDGES_FINDINGS_0.1.4.md), [las notas de arte previo](./docs/PRIOR_ART.md) y [los experimentos](./experiments/) conservan la historia de construcción. Las revisiones por modelos independientes de sus constructores no son una auditoría de seguridad externa. El método acredita [The Fable Method](https://github.com/Sahir619/fable-method); Raven MCP, Stellar y el trabajo de Lore/LUS pertenecen al relato de construcción, no prueban que el producto completo opere de forma autónoma.

### Qué NO trae el 0.1.4 y pasa al 0.1.5

El comparador de reducción de autoridad de gasto queda fuera por un defecto de setters heredados en el constructor base `grantSpend`. [La nota de versión](./docs/RELEASE_0.1.4_KERNEL.md#qué-no-trae-el-014-y-pasa-al-015) da el motivo de cada punto diferido: x402 HX-09, HX-11, HX-12, HX-13, R2-05 y H11; procedencia N07, N08, H12d y H13d; emergencia H21; puente R2-11 y R2-12. Los demás `todo` documentan fronteras declaradas del contrato, como sustitución de funciones dentro del proceso y límites de la salida del validador, sin prometer un arreglo futuro para todas ellas.

No hay almacén durable de emergencia ni de pagos, runtime autónomo entre hosts, planificador, evidencia de mainnet, segundo proveedor de pagos, auditoría de seguridad externa, certificación regulatoria ni preparación para producción. En la arquitectura de trabajo, la semántica de operación sigue `SUPPORTED`, la operación autónoma `UNTESTED` y el Final Vespi Gate `READY_FOR_MUSE_DISCOVERY` y `NOT_READY_FOR_IMPLEMENTATION`. Esas etiquetas describen candidatas y límites, no capacidades de runtime entregadas a usuarios.

### Autor y licencia

Andrés Peña Mellado, Digital Art Director & Creative Developer. [Telegram](https://t.me/andresanemic), [X](https://x.com/andresanemic), [LinkedIn](https://www.linkedin.com/in/andresanemic/). Licencia del kernel: [Apache-2.0](./LICENSE), con atribución en [NOTICE](./NOTICE).
