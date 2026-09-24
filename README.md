[![Vespiqueen: surrounding hive and continuity direction; Vespi: current operation kernel](./assets/vespiqueen-genesis.png)](./assets/vespiqueen-genesis.png)

# Vespi

<p align="center">
  <a href="https://github.com/andresanemic/vespi/releases/tag/v0.1.1-kernel"><img src="https://img.shields.io/badge/latest--release-v0.1.1--kernel-D7B698?style=for-the-badge&labelColor=07111A" alt="Latest release: v0.1.1-kernel"></a>
  <a href="./docs/GENESIS.md"><img src="https://img.shields.io/badge/status-experimental-E0C170?style=for-the-badge&labelColor=07111A" alt="Status: experimental"></a>
  <a href="./experiments/005/RUN.md"><img src="https://img.shields.io/badge/run-05--closed-E0C170?style=for-the-badge&labelColor=07111A" alt="RUN 05: closed"></a>
  <a href="#what-exists-today"><img src="https://img.shields.io/badge/authority-bounded-D7B698?style=for-the-badge&labelColor=07111A" alt="Bounded authority"></a>
</p>

<details open>
<summary><strong>English</strong></summary>

<a id="english"></a>

**Vespi is an experiment in operational continuity under bounded authority.**

> **The unit is not the agent. The unit is the operation.**

The current local kernel runs one declared operation through spend authority, an optional human decision, one capability call, separate verification and a local receipt.

## Quickstart / evaluation path

The local commands below are tested with Node 24+.

| Path | Run | What it exercises |
|---|---|---|
| Kernel | `node --test test/operation.test.js` | Operations, bounded authority, human-gate decision records, timeouts, verification and receipts. No wallet or funds required. |
| x402 demo | `cd demo/x402 && npm ci && npm test` | The complete local adapter suite, including adversarial x402/Stellar cases. No wallet or funds required; dependency installation may use the network. |
| Testnet walkthrough | [`demo/x402/README.md`](./demo/x402/README.md) | A bounded Stellar testnet capability. The paid route needs a funded testnet account, USDC trustline, receiver, environment variables and network access. |

> **Verify the local boundary (no wallet or funds):** run the two commands above. The current working tree is **Unreleased**; its results are **47/47 kernel tests** and **53/53 demo tests**. These verify the local demo boundary and its current code contract.

The testnet walkthrough uses Node 24+.

## Why it exists?

When working with AI agents, there is a moment when one session ends and the next has to begin.

Keeping the data is relatively easy. What matters is preserving the criterion that made a decision valid. What survives when the model, host or session changes?

Context helps, but it is not enough. The reason an answer was acceptable, its limits and who could approve it also need to survive.

Vespiqueen is the surrounding hive and continuity direction; Vespi is the current operation kernel. The visual identity does not represent a second runtime.

### The operational triangle

```text
                              LUS
        research · hypotheses · contradictions
                              │
                              ▼
                    LEGITIMATE CONTINUITY
                 Lore ─────────────── Vespi
        criterion that still governs    work in time
                 ▲                       │
                 └──── Lore Plugin ──────┘
                       validity · owners
                       thresholds · epochs
```

This is a conceptual map, not an implemented integration. LUS frames the research question; Lore Plugin governs Lore; Vespi is currently a separate local kernel. Any future interface remains unbuilt.

[LUS](https://github.com/andresanemic/lore-plugin/blob/main/docs/LUS_en.md) is the research program that poses the question at the top of this triangle. Lore is accumulated criterion with standing. Lore Plugin governs its validity, owners, thresholds and epochs. Vespi is intended to put it to work in time.

The edges matter: Lore gives criterion, not a recipe; Vespi currently returns a local receipt, not an automatic Lore write; Lore Plugin governs what remains valid. A receipt could support a future Lore proposal, but it does not write Lore or trigger revalidation. A criterion can become historical and require revalidation.

> **Lore preserves what was earned. Lore Plugin governs its validity. Vespi is intended to put it to work in time.**

## What exists today

The public surfaces are:

| Surface | Evidence | Status |
|---|---|---|
| [`src/`](./src/) | 47/47 kernel tests in the current working tree (**Unreleased**); historical release `v0.1.1-kernel` reports 16/16. | **Verified / local:** runnable operation kernel, not a universal runtime. |
| [`demo/x402/`](./demo/x402/) | 53/53 offline tests, including authorization, redirect, abort, replay and receipt adversarial cases. | **Verified / bounded:** local x402/Stellar adapter suite; the paid testnet walkthrough is separate. |
| [`experiments/`](./experiments/) | RUN 05 is closed within its local/offline scope. | **Evidence:** not a new tagged release. See [001](./experiments/001-operator-professor-loop/RUN.md), [002](./experiments/002-x402-slice1/RUN.md) and [005](./experiments/005/RUN.md). |
| [`docs/GENESIS.md`](./docs/GENESIS.md) | Current problem statement, working theses and non-claims. | **Active boundary / direction:** not a runtime claim. |

For a quick evaluation, run the kernel command first and then the local x402 suite. Use the testnet walkthrough only when its setup is available. Read RUN 05 after the commands as evidence, not as a claim that the product is ready. These labels describe current support, not a maturity ladder. Start with the command; read the evidence when it gives you a reason to continue.

<details>
<summary><b>Terms and current boundaries</b></summary>

- A **capability** is an available action.
- A **grant** is the authority for an effect.
- A **human gate** is the decision surface the kernel consults when authority is insufficient; it is not a complete authenticated approval workflow.
- **Provenance** here is limited to the capability ID, grants and exercised effects, approval label, allowlisted evidence and verification result; it does not identify or authenticate the human decider.
- A **receipt** is the structured object returned by the operation, not automatic durable persistence.
- A **criterion** is the governing standard used to judge the operation.

The English technical labels are retained when they are code/API identifiers or protocol terms: authority, grant, human gate, capability, receipt, runtime, sandbox, payload, settlement, redirect and auth digest.

The current boundary does not include:

- automatic durable receipt persistence, a shared operation ledger or recovery after a crash;
- a general orchestration runtime, universal scheduler, daemon, migration engine or quota manager;
- production readiness, regulatory compliance or a stable protocol;
- a released first-party `vespi` skill;
- a claim that Vespi is a crypto payment agent, a Tellus product or a hackathon-created project.

</details>

## How the operation stays bounded

The operation stays at the center. It declares its spend requirements, the authority check compares them with the available grants, and a human gate is consulted when the authority is insufficient. The capability performs once, verification remains separate, and the result returns as a receipt.

`required → authority → human gate (when needed) → perform → verify → receipt`

- `required()` declares the spend requirement a capability intends to use.
- `authority` says what the operation may do, including a destination-specific limit.
- The human gate does not replace capability availability.
- `perform()` is not evidence of success.
- A returned receipt is not automatically durable.

The kernel does not sandbox capability code: `required()` and `perform()` are trusted in-process code. It prevents `perform()` from running when declared spend requirements are uncovered; this demo's x402 adapter separately checks its paid-effect terms before payload creation. A receipt must not attribute a human decision that did not occur.

## The x402/Stellar slice

The x402/Stellar slice is a bounded economic capability, not Vespi's identity. Before the paid request, the local adapter checks the selected 402 requirement's paid-effect terms, destination-bound grant, redirect rejection, request and body deadlines, abort propagation and the prepared Soroban transfer, including its authorization digest. After the response, the settlement verifier checks the Soroban authorization shape, transaction hash/network binding and exact USDC amount. The adversarial suite proves that listed offer deviations do not reach `createPaymentPayload` and that unverified output is not exposed.

The idempotency guard is in-process and runs after x402 processing; it is not a durable ledger, a prepayment distributed lock or crash recovery. Read the [demo instructions](./demo/x402/README.md) before using the paid route.

## A workflow in practice

This is the current local demo scenario.

```text
Request: obtain the marketing plan through x402.

required: USDC 0.01 → configured receiver
authority: insufficient grant
→ needs_human_decision
  exercised: []
  no transaction
```

Illustrative authorized path:

```text
› With a sufficient destination-bound grant, authorize the exact 0.01 USDC payment on Stellar testnet.

required → authority → perform → verify
→ verified receipt
  evidence.txHash: ...
```

The first path is the no-decision boundary. The second is the sufficient-authority path; a human gate is not consulted because the grant is already sufficient. The receipt is evidence for a proposal; it does not write Lore automatically. See the [x402 demo instructions](./demo/x402/README.md).

## Evidence and experiments

The public record stays attached to the object: receipts, failures, blind reads, verification and unresolved questions. A method, benchmark or first-party skill does not become a law merely by appearing here.

The open question is how much observed continuity comes from Vespi itself, and how much reduces to good state, policy, routing, host capabilities and verification. The residue remains open.

## The bet

<p align="center">
  <img src="./assets/vespi-A.png" alt="A Vespi field researcher observing a living hive at night" width="100%">
</p>

The bet is whether an operation can remain meaningful beyond the lifetime of one model, host or session while preserving enough goal, authority, evidence, provenance and human intervention to continue honestly after an interruption.

### Continuity

The operation should survive changes of model, host, quota or capacity exhaustion, interruptions, capability failures and reconstruction from durable state, while preserving the conditions for human intervention.

A model, host or provider may disappear without that necessarily meaning the operation has ceased to exist. **This is a direction, not a current implementation:** Vespi would own continuation semantics; the host/runtime may own waking the process.

### Mechanical interruption is not human interruption

> **A resource limit should interrupt computation before it interrupts the human.**

A mechanical boundary is a reason to stop computing, not a reason to consume a person's attention. Waiting, asking or stopping can be the correct result of an operation.

### Attention is finite

> **Autonomy is how much legitimate work can be completed without consuming unnecessary human attention.**

Autonomy is measured by useful work completed, not by time without a human.

### Continuation semantics

Eventually, the operation should be able to checkpoint what matters, determine what remains authorized, select another sufficient capability when appropriate, continue or wait according to policy, verify the result, preserve receipts and provenance, and escalate only when a real human threshold appears.

These are directions to investigate, not current features.

### Model and capability economy

> **Use the least expensive sufficient intelligence. Escalation must be earned.**

A Vespi capability may be local, host-native, external or paid. Its economic form does not define Vespi; x402/Stellar is the first exercised paid capability, not the project's identity.

### Honest uncertainty

> **It is not yet known how much of this requires something specifically called Vespi.**

Part of the observed continuity may reduce to good state, policy, routing, host capabilities and verification. The residue remains open so the bet remains falsable.

<details>
<summary><b>What is not claimed yet</b></summary>

The current repository does not contain a cross-host runtime, scheduler, migration engine, quota manager, shared idempotency store or automatic durable memory. A timeout after a remote settlement may require reconciliation before a new operation is created.

</details>

### The next proof needed

A public case is still needed where a bounded operation continues across a change and the result cannot be reduced to ordinary state, policy, routing, host capability or verification. Until then, the residue remains open.

## Why publish this early?

The history is published as evidence. Vespi should not arrive later with a polished origin story. What survives, what fails, what changes and what gets rejected should remain inspectable while the project is still becoming itself.

## Author

**Andrés Peña Mellado**

Digital Art Director & Creative Developer working across AI agents, Web3, design and research.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/) &nbsp;&nbsp; <img src="./assets/icons/v2/discord.svg" width="28" alt="Discord">

---

[Genesis](./docs/GENESIS.md) · [Changelog](./CHANGELOG.md) · [Experiments](./experiments/) · [Release v0.1.1-kernel](https://github.com/andresanemic/vespi/releases/tag/v0.1.1-kernel) · [MIT License](./LICENSE)

</details>

<details>
<summary><strong>Español</strong></summary>

<a id="español"></a>

**Vespi es un experimento de continuidad operacional bajo autoridad acotada.**

> **La unidad no es el agente. La unidad es la operación.**

El kernel local actual ejecuta una operación declarada mediante autoridad de gasto, una decisión humana opcional, una llamada de capacidad, verificación separada y un recibo local.

## Inicio rápido / ruta de evaluación

Los comandos locales siguientes se probaron con Node 24+.

| Ruta | Ejecutar | Qué ejercita |
|---|---|---|
| Kernel | `node --test test/operation.test.js` | Operaciones, autoridad acotada, registros de decisión del gate humano, tiempos límite, verificación y recibos. No requiere wallet, fondos ni red. |
| Demo x402 | `cd demo/x402 && npm ci && npm test` | La suite local completa del adaptador, incluidos los casos adversariales de x402/Stellar. No requiere wallet, fondos ni pago en vivo; la instalación de dependencias puede usar la red. |
| Recorrido testnet | [`demo/x402/README.md#espanol`](./demo/x402/README.md#espanol) | Una capacidad acotada de Stellar testnet. La ruta pagada requiere una cuenta testnet fondeada, trustline USDC, receptor, variables de entorno y acceso a red. |

> **Verifica la frontera local (sin wallet ni fondos):** ejecuta los dos comandos anteriores. El árbol de trabajo actual está **sin publicar (Unreleased)**; sus resultados son **47/47 tests del kernel** y **53/53 tests de la demo**. Verifican la frontera local del demo y su contrato de código actual.

El recorrido testnet usa Node 24+.

## ¿Por qué existe?

Cuando se trabaja con agentes IA, hay un momento en que una sesión termina y la siguiente tiene que empezar.

Lo que debería pasar con los datos es relativamente fácil. Lo importante es conservar el criterio que hizo que una decisión valiera. ¿Qué se conserva cuando cambian el modelo, el host o la sesión?

El contexto ayuda, pero no alcanza. También necesitan sobrevivir la razón por la que una respuesta era aceptable, sus límites y quién podía aprobarla.

Vespiqueen es la dirección de colmena y continuidad; Vespi es el kernel de operaciones actual. La identidad visual no representa un segundo runtime.

### El triángulo operacional

```text
                              LUS
     investigación · hipótesis · contradicciones
                              │
                              ▼
                   CONTINUIDAD LEGÍTIMA
                 Lore ─────────────── Vespi
       criterio que todavía gobierna   trabajo en el tiempo
                 ▲                       │
                 └──── Lore Plugin ──────┘
                        validez · propietarios
                        umbrales · épocas
```

Este es un mapa conceptual, no una integración implementada. LUS enmarca la pregunta de investigación; Lore Plugin gobierna Lore; Vespi es actualmente un kernel local separado. Cualquier interfaz futura sigue sin construirse.

[LUS](https://github.com/andresanemic/lore-plugin/blob/main/docs/LUS_es.md) es el programa de investigación que plantea la pregunta en la parte superior de este triángulo. Lore es el criterio acumulado que conserva su derecho a gobernar. Lore Plugin gobierna su validez, propietarios, umbrales y épocas. Vespi está llamado a ponerlo a trabajar en el tiempo.

Las relaciones importan: Lore entrega criterio, no una receta; Vespi devuelve actualmente un recibo local, no escribe Lore automáticamente; Lore Plugin gobierna qué sigue válido. Un recibo podría servir como base para una propuesta futura de Lore, pero no escribe Lore ni dispara revalidación. Un criterio puede pasar a ser histórico y necesitar revalidación.

> **Lore conserva lo ganado. Lore Plugin gobierna su validez. Vespi está llamado a ponerlo a trabajar en el tiempo.**

## Qué existe hoy

Las superficies públicas son:

| Superficie | Evidencia | Estado |
|---|---|---|
| [`src/`](./src/) | 47/47 tests del kernel en el árbol de trabajo actual (**Unreleased**); la publicación histórica `v0.1.1-kernel` reporta 16/16. | **Verificado / local:** kernel ejecutable, no un runtime universal. |
| [`demo/x402/`](./demo/x402/) | 53/53 pruebas sin conexión, incluidas autorización, redirecciones, cancelación, repeticiones y recibos adversariales. | **Verificado / acotado:** suite local del adaptador x402/Stellar; el recorrido testnet pagado es separado. |
| [`experiments/`](./experiments/) | RUN 05 está cerrado dentro de su alcance local/offline. | **Evidencia:** no es una nueva publicación etiquetada. Ver [001](./experiments/001-operator-professor-loop/RUN.md), [002](./experiments/002-x402-slice1/RUN.md) y [005](./experiments/005/RUN.md). |
| [`docs/GENESIS.md`](./docs/GENESIS.md) | Problema actual, tesis de trabajo y límites de no alcance. | **Frontera activa / dirección:** no una afirmación de runtime. |

Para una evaluación rápida, ejecuta primero el comando del kernel y después la suite local de x402. Usa el recorrido testnet solo cuando tengas su configuración disponible. Lee RUN 05 después de los comandos como evidencia, no como una afirmación de que el producto esté listo. Estas etiquetas describen el soporte actual, no una escalera de madurez. Empieza por el comando; lee la evidencia cuando te dé una razón para seguir.

<details>
<summary><b>Términos y fronteras actuales</b></summary>

- Una **capacidad** es una acción disponible.
- Un **grant** es la autoridad para un efecto.
- Un **human gate** es la superficie de decisión que el kernel consulta cuando la autoridad no basta; no es un flujo completo de aprobación autenticada.
- **Procedencia** aquí se limita al ID de la capacidad, los permisos y efectos ejercitados, la etiqueta de aprobación, la evidencia permitida y el resultado de verificación; no identifica ni autentica a la persona que decide.
- Un **recibo (receipt)** es el objeto estructurado que devuelve la operación, no persistencia durable automática.
- Un **criterio** es el estándar que gobierna la operación.

En la prosa, `authority` es autoridad, `grant` es permiso, `human gate` es gate humano, `capability` es capacidad y `receipt` es recibo. `offline` es sin conexión, `live` es en vivo, `abort` es cancelación, `replay` es repetición y `scheduler` es planificador. `runtime`, `sandbox`, `payload`, `settlement`, `redirect` y `auth digest` se conservan cuando son nombres de una técnica, una API o un estado del código.

La frontera actual no incluye:

- persistencia durable automática de recibos, un registro de operaciones compartido o recuperación después de un fallo;
- un runtime general de orchestration, un scheduler universal, un daemon, un migration engine o un quota manager;
- preparación para producción, cumplimiento regulatorio o un protocolo estable;
- una skill propia `vespi` publicada;
- una afirmación de que Vespi es un agente de pagos crypto, un producto de Tellus o un proyecto creado por un hackathon.

</details>

## Cómo se mantiene la operación acotada

La operación se mantiene en el centro. Declara sus requisitos de gasto, la comprobación de autoridad los compara con los permisos disponibles y el gate humano aparece cuando la autoridad no basta. La capacidad hace `perform` una vez, la verificación queda separada y el resultado vuelve como recibo.

`required → authority → human gate (cuando haga falta) → perform → verify → receipt`

- `required()` declara el requisito de gasto que la capacidad pretende usar.
- El campo `authority` dice qué puede hacer la operación, incluido el límite específico de un destino.
- El gate humano no reemplaza la disponibilidad de una capacidad.
- `perform()` no es evidencia de éxito.
- Un recibo devuelto no es durable automáticamente.

El kernel no ejecuta el código de las capacidades en un sandbox: `required()` y `perform()` son código confiable dentro del proceso. Impide que `perform()` se ejecute cuando los requisitos de gasto declarados no están cubiertos; el adaptador x402 del demo revisa por separado sus términos de pago efectivos antes de crear el payload. Un recibo no puede atribuir una decisión humana que no ocurrió.

## La capacidad x402/Stellar

La capacidad x402/Stellar es una capacidad económica acotada, no la identidad de Vespi. Antes de la solicitud pagada, el adaptador local verifica los términos efectivos de pago del requisito 402 seleccionado, el permiso ligado al receptor, el rechazo de redirecciones, los límites de tiempo de la solicitud y de la respuesta, la propagación de la cancelación y la transferencia Soroban preparada, incluido su digest de autorización. Después de la respuesta, el verificador de settlement comprueba la forma de la autorización Soroban, el hash y la red de la transacción y el monto USDC exacto. La suite adversarial demuestra que las desviaciones listadas de la oferta no llegan a `createPaymentPayload` y que el resultado no verificado no se expone.

La protección de idempotencia funciona dentro del proceso y después del procesamiento x402; no es un registro durable, un bloqueo distribuido previo al pago ni recuperación después de un fallo. Lee las [instrucciones de la demo](./demo/x402/README.md#espanol) antes de usar la ruta pagada.

## Un flujo de trabajo en la práctica

Este es el escenario local actual del demo.

```text
Solicitud: obtener el marketing-plan mediante x402.

required: USDC 0.01 → receptor configurado
authority: sin grant suficiente
→ needs_human_decision
  exercised: []
  no transaction
```

Ruta autorizada ilustrativa:

```text
› Con un grant suficiente ligado al receptor, el pago exacto de 0.01 USDC en Stellar testnet queda autorizado.

required → authority → perform → verify
→ verified receipt
  evidence.txHash: ...
```

La primera ruta es la frontera sin decisión. La segunda es la ruta con autoridad suficiente; no se consulta el gate humano porque el permiso ya es suficiente. El recibo es evidencia para una propuesta; no escribe Lore automáticamente. Consulta las [instrucciones de la demo x402](./demo/x402/README.md#espanol).

## Experimentos y evidencia

El registro público permanece unido al objeto: recibos, fallos, lecturas ciegas, verificación y preguntas abiertas. Un método de evaluación o una skill propia no se convierte en ley solo por aparecer aquí.

La pregunta abierta es cuánta continuidad observada viene de Vespi y cuánta se reduce a buen estado, política, enrutamiento, capacidades del host y verificación. El residuo queda abierto.

## La apuesta

<p align="center">
  <img src="./assets/vespi-A.png" alt="Una investigadora de Vespi observa una colmena viva de noche" width="100%">
</p>

La apuesta es si una operación puede conservar significado más allá de la vida de un solo modelo, host o sesión, preservando suficiente objetivo, autoridad, evidencia, procedencia e intervención humana para continuar honestamente después de una interrupción.

### Continuidad

Una operación debería sobrevivir cambios de modelo, host, agotamiento de cuota o capacidad, interrupciones, fallos de capacidades y reconstrucción desde estado durable, preservando las condiciones para la intervención humana.

Un modelo, host o proveedor puede desaparecer sin que eso implique necesariamente que la operación dejó de existir. **Es una dirección, no una implementación actual:** Vespi poseería la semántica de continuación; el host o el entorno de ejecución puede encargarse de despertar el proceso.

### Una interrupción mecánica no es una interrupción humana

> **Un límite de recursos debería interrumpir el cómputo antes de interrumpir al humano.**

Un límite mecánico se interpreta como una razón para detener el cómputo, no como una razón para consumir la atención de una persona. Esperar, preguntar o detenerse puede ser el resultado correcto de una operación.

### La atención es un recurso finito

> **La autonomía se mide por el trabajo legítimo que se completa sin consumir atención humana innecesaria.**

La autonomía no se mide por el tiempo sin un humano.
### Semántica de continuación

Eventualmente, la operación debería poder hacer un punto de control de lo que importa, determinar qué sigue autorizado, seleccionar otra capacidad suficiente cuando corresponda, continuar o esperar según la política, verificar, preservar recibos y procedencia, y escalar solo cuando aparezca un umbral humano real.

Son direcciones para investigar, no capacidades actuales.

### Economía de modelos y capacidades

> **Usa la inteligencia suficiente más barata. La escalación debe ganarse.**

Una capacidad de Vespi puede ser local, propia del host, externa o pagada. Su forma económica no define Vespi; x402/Stellar es la primera capacidad pagada ejercitada, no la identidad del proyecto.

### Honestidad sobre la incertidumbre

> **La proporción de continuidad que requiere algo específicamente llamado Vespi todavía no se conoce.**

Parte de la continuidad observada puede reducirse a buen estado, política, enrutamiento, capacidades del host y verificación. El residuo queda abierto para que la apuesta siga siendo falsable.

<details>
<summary><b>Lo que todavía no reclamo</b></summary>

El repositorio actual no contiene un runtime entre hosts, un scheduler, un migration engine, un quota manager, un almacén de idempotencia compartido ni memoria durable automática. Un timeout después de un settlement remoto puede requerir reconciliación antes de crear una operación nueva.

</details>

### La próxima prueba necesaria

Aún se necesita un caso público donde una operación acotada continúe atravesando un cambio y el resultado no pueda reducirse a estado, política, enrutamiento, capacidad del host o verificación ordinarios. Hasta entonces, el residuo permanece abierto.

## ¿Por qué publicarlo tan temprano?

La historia se publica como evidencia. Vespi no debería aparecer después con un relato de origen perfecto. Lo que sobrevive, lo que falla, lo que cambia y lo que se rechaza debería quedar inspeccionable mientras el proyecto todavía se está convirtiendo en sí mismo.

## Autor

**Andrés Peña Mellado**

Digital Art Director & Creative Developer trabajando entre agentes de IA, Web3, diseño e investigación.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/) &nbsp;&nbsp; <img src="./assets/icons/v2/discord.svg" width="28" alt="Discord">

---

[Génesis](./docs/GENESIS.md) · [Changelog](./CHANGELOG.md) · [Experimentos](./experiments/) · [Release v0.1.1-kernel](https://github.com/andresanemic/vespi/releases/tag/v0.1.1-kernel) · [Licencia MIT](./LICENSE)

</details>
