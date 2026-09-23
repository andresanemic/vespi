[![Vespiqueen genesis](./assets/vespiqueen-genesis.png)](./assets/vespiqueen-genesis.png)

# Vespi

<p align="center">
  <a href="https://github.com/andresanemic/vespi/releases/tag/v0.1.1-kernel"><img src="https://img.shields.io/badge/version-v0.1.1--kernel-D7B698?style=for-the-badge&labelColor=07111A" alt="Version: v0.1.1-kernel"></a>
  <a href="./docs/GENESIS.md"><img src="https://img.shields.io/badge/status-experimental-E0C170?style=for-the-badge&labelColor=07111A" alt="Status: experimental"></a>
  <a href="./experiments/005/RUN.md"><img src="https://img.shields.io/badge/run-05--closed-E0C170?style=for-the-badge&labelColor=07111A" alt="RUN 05: closed"></a>
  <a href="#what-exists-today"><img src="https://img.shields.io/badge/authority-bounded-D7B698?style=for-the-badge&labelColor=07111A" alt="Bounded authority"></a>
</p>

<p align="center"><a href="#english"><strong>English</strong></a> · <a href="#español"><strong>Español</strong></a></p>

<details open>
<summary><strong>English</strong></summary>

<a id="english"></a>

**Vespi is an experiment in operational continuity under bounded authority.**

> **The unit is not the agent. The unit is the operation.**

Vespi is a small public experiment in how people, models and services can work together without automatically sharing the same context, permissions or history. It is being built in public by **Andrés Peña Mellado**. This repository is experimental: it records what exists, what fails, what changes and what remains deliberately unclaimed.

## Why it exists

Capability, context and authority are different things. A capability can be available without being authorized. A receipt can record a result without proving that the result was persisted. A model can be powerful without knowing which decision it is allowed to make.

Vespi starts from the operation rather than from the agent: what must happen, what evidence would count, who may authorize it, how it is verified and what remains when one participant disappears.

<a id="what-exists-today"></a>
## What exists today / Qué existe hoy

> **TODAY / HOY — current repository boundary.** The entries below are current public records or locally exercised behavior. The continuity runtime described later is not present today.

These are the current claims supported by the repository and RUN 05:

- **Historical release record:** [`v0.1.1-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.1-kernel) reports 16/16 kernel tests at release.
- **RUN 05 result (post-v0.1.1; not a tagged release):** the current tree includes the human-decision provenance fix and passes 19/19 kernel tests plus 1/1 x402 adversarial test locally. It is not a new tagged release.
- [`src/`](./src/) is the **operation kernel today**: a small local execution primitive for one bounded operation. It checks authority, optionally surfaces a decision, performs once, verifies separately and returns a structured receipt. It is not a universal runtime, orchestrator or continuation engine.
- Authority is checked before a capability is allowed to perform. A missing or non-decisive human gate is recorded as `human_gate_no_decision`; an explicit `approved: false` is `human_gate_rejected`; an explicit approval is preserved as `human_gate_approved` in terminal receipts.
- The kernel returns a structured receipt. It does not provide automatic durable persistence; the caller owns persistence if it needs it.

**Terms in this repository:** A **capability** is an available action; a **grant** is the authority for an effect; a **human gate** is the decision surface the kernel consults when authority is insufficient, not a complete authenticated approval workflow; **provenance** records where a result or decision came from; a **receipt** is the structured object returned by the operation, not automatic durable persistence; a **criterion** is the governing standard used to judge the operation.

- [`demo/x402/`](./demo/x402/) is the only place that knows x402, Stellar and USDC. It is an economic capability example, not Vespi's identity. The adapter checks effective 402 terms before payload creation against the declared fixed 0.01 USDC effect and the operation grant.
- [`experiments/`](./experiments/) preserves public runs and evidence. [`001`](./experiments/001-operator-professor-loop/RUN.md) records an Operator↔Professor loop; [`002`](./experiments/002-x402-slice1/RUN.md) records an earlier x402/Stellar testnet slice with receipts and a kept verification failure; [`005`](./experiments/005/RUN.md) records the final RUN 05 evaluation, **CLOSED** within its declared local/offline scope.

## How the kernel thinks about authority and operations

The operation declares its required effects. The authority check compares those requirements with the grants available to the operation. A capability is not called until the requirements are sufficient or a human explicitly approves them. Only then does the capability perform, and the result is verified and returned as a receipt.

The boundary is deliberately small:

- `required()` says what a capability intends to do.
- `authority` says what the operation may do, including the destination when a grant is destination-specific.
- the human gate is a decision surface, not a substitute for capability availability.
- `perform()` is not evidence of success; verification is separate.
- a returned receipt is not automatically durable.

RUN 05 sharpened these boundaries without turning them into universal laws: authority must constrain the actual side effect before it occurs; a receipt must not attribute a human decision that did not happen; a structured receipt is not durable persistence; capability availability is not authority; a reachable criterion is not necessarily a loaded criterion; and durable state surfaces can diverge.

## The capability example: x402 and Stellar

x402/Stellar is the first exercised paid/economic capability, **not Vespi's identity**. It is where an operation can encounter a real economic boundary without teaching the kernel about payments.

The current evidence is **LOCAL / OFFLINE VERIFIED** for a bounded pre-signature path: version, exact scheme, Stellar testnet, USDC contract, configured recipient, exact 0.01 USDC price, safe timeout, sponsored authorization flow and the effective grant. The adversarial test proves, offline, that deviating offers do not reach `createPaymentPayload` while the exact offer does.

A fresh live x402 payment is **CURRENT LIVE NOT VERIFIED**. Real 402 response, signing, facilitator, settlement and Horizon verification remain **NOT VERIFIED** in the current local run. Experiment 002 provides **HISTORICAL TESTNET EVIDENCE**, not current live settlement evidence.

## Experiments and evidence

The public record belongs to the object. It keeps receipts, failures, blind reads, independent verification and unresolved questions in view. A method, benchmark or first-party skill does not become a law merely by appearing in this repository.

The question remains open: how much of the observed continuity comes from Vespi itself, and how much reduces to good state, policy, routing, host capabilities and verification? The residue is not assumed.

## THE BET / LA APUESTA

> **DIRECTION, NOT CURRENT IMPLEMENTATION.**

The bet is an operation that remains meaningful beyond the lifetime of one model, host or session, with enough state to continue honestly after an interruption.

### Continuity

We imagine an operation that can survive:

- changes of model;
- changes of host;
- quota or capacity exhaustion;
- interruptions;
- capability failures;
- reconstruction from durable state;

while preserving enough of the goal, authority, evidence, provenance, verification state and conditions for human intervention to know what remains true.

A model, host or provider may disappear without that necessarily meaning the operation has ceased to exist. **Direction, not current implementation:** Vespi would own continuation semantics; the host/runtime may own waking the process. The current repository contains no cross-host runtime, scheduler, migration engine or quota manager.

### Mechanical interruption is not human interruption

> **A resource limit should interrupt computation before it interrupts the human.**

### Attention is finite

> **Autonomy is not how long Vespi can operate without a human. It is how much legitimate work it can complete without consuming unnecessary human attention.**

A mechanical boundary should not automatically consume a person's attention. Waiting, asking or stopping can be the correct result of an operation.

### Continuation semantics

Eventually, the direction includes being able to:

- checkpoint what matters;
- determine what remains authorized;
- select another sufficient capability when appropriate;
- continue or wait according to policy;
- verify the result;
- preserve receipts and provenance;
- escalate only when a real human threshold appears.

These are directions to investigate, not current features.

### Model and capability economy

> **Use the least expensive sufficient intelligence. Escalation must be earned.**

A Vespi capability may be local, host-native, external or paid. Its economic form does not define Vespi. x402/Stellar is the first exercised paid/economic capability, not Vespi's identity.

### Honest uncertainty

> **We do not yet know how much of this requires something specifically called Vespi. Some of it may reduce to good state, policy, routing, host capabilities and verification. That is part of the experiment.**

The bet can be strong and still falsable. We do not invent “ese Vespi” to justify the name.

## Relationship to Lore Plugin

> **Lore Plugin prepares the ground. Vespi operates on it.**

**Today:** Vespi is a separate technical repository. LUS and Lore Plugin are part of its genealogy and criterion. There is no released first-party `vespi` skill.

In the intended division of labor, Lore Plugin is expected to provide the durable ground an operation needs: goal/state, the relevant criterion and owner, the authority boundary, and evidence/provenance. Vespi operates within those boundaries; it does not replace Lore Plugin or create a second learning or write path.

**Direction, not current implementation:** `vespi` should eventually become a first-party Lore Plugin skill, inherit Lore Plugin's governance and authority model, and preserve that single learning/write path.

## Origin, catalyst, pressure, horizon

- **ORIGIN: LUS + Lore Plugin.** Vespi grows from work on criterion, continuity and operational authority, not from a payment protocol.
- **CATALYST / CURRENT PUBLIC PRESSURE: Find Your Way + Tellus.** This is context and evaluation pressure only. No ownership, sponsorship, endorsement, partnership, funding or official affiliation is claimed.
- **FIRST EXERCISED ECONOMIC PRESSURE: x402 + Stellar testnet.** Payment is a pressure that exposed real authority questions; it is not the project's origin.
- **HORIZON: Meridian / HackMeridian 2026.** The [HackMeridian event](https://meridian.stellar.org/event-details) is context and a public horizon, not a claim of ownership, sponsorship, endorsement, partnership, funding or official affiliation.

## NOT VERIFIED: external and continuity claims

RUN 05 is **CLOSED** within its declared local/offline evaluation scope. The following are not current claims:

- a fresh live x402 payment, signature, facilitator, settlement or Horizon verification;
- automatic durable receipt persistence or persistent memory;
- a general orchestration runtime, universal scheduler, daemon, migration engine or quota manager;
- production readiness, regulatory compliance or a stable protocol;
- a released first-party `vespi` skill;
- a claim that Vespi is a crypto payment agent, a Tellus product or a hackathon-created project.

## Quickstart / evaluation path

**Level 1: kernel, nothing external.** Clone the repository and run:

```bash
node --test
```

The suite covers operation, bounded authority, human-gate provenance, capability boundaries, verification and receipts. No wallet, funds or network are required.

**Level 2: bounded x402 testnet demo.** See [`demo/x402/README.md`](./demo/x402/README.md). The paid route needs a funded testnet account, a USDC trustline, a receiver, environment variables and network access. The rejection route can stop before contacting the endpoint. The current local run does not certify a fresh live payment.

## Why publish this early?

Because the history is part of the evidence. Vespi should not arrive later with a polished origin story. What survives, what fails, what changes and what gets rejected should remain inspectable while the project is still becoming itself.

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

<p align="center"><a href="#english"><strong>English</strong></a> · <a href="#español"><strong>Español</strong></a></p>

**Vespi es un experimento de continuidad operacional bajo autoridad acotada.**

> **La unidad no es el agente. La unidad es la operación.**

Vespi es un pequeño experimento público sobre cómo personas, modelos y servicios pueden trabajar juntos sin compartir automáticamente el mismo contexto, permisos o historia. Lo construye en público **Andrés Peña Mellado**. Este repositorio es experimental: conserva lo que existe, lo que falla, lo que cambia y lo que sigue deliberadamente sin reclamar.

## Por qué existe

Capability, contexto y authority son cosas distintas. Una capability puede estar disponible sin estar autorizada. Un receipt puede registrar un resultado sin demostrar que ese resultado fue persistido. Un modelo puede ser poderoso sin saber qué decisión tiene permiso para tomar.

Vespi parte de la operación y no del agente: qué debe ocurrir, qué evidencia contaría, quién puede autorizarla, cómo se verifica y qué permanece cuando uno de los participantes desaparece.

## Qué existe hoy

> **HOY — frontera actual del repositorio.** Los puntos siguientes son registros públicos actuales o comportamientos ejercitados localmente. El runtime de continuidad descrito más adelante no existe hoy.

Estas son las afirmaciones públicas actuales respaldadas por el repositorio y RUN 05:

- **Registro histórico del release:** [`v0.1.1-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.1-kernel) reporta 16/16 tests del kernel al publicar.
- **Resultado de RUN 05 (posterior a v0.1.1; no es un tagged release):** el árbol actual incluye la corrección de provenance de la decisión humana y pasa localmente 19/19 tests del kernel y 1/1 test adversarial de x402. No es un nuevo tagged release.
- [`src/`](./src/) es el **operation kernel de hoy**: una primitiva local de ejecución para una operación acotada. Chequea authority, muestra opcionalmente una decisión, hace `perform` una vez, verifica por separado y devuelve un receipt estructurado. No es un runtime universal, orchestrator ni continuation engine.
- La authority se chequea antes de permitir que una capability haga `perform`. Un gate humano ausente o no decisivo queda como `human_gate_no_decision`; un `approved: false` explícito queda como `human_gate_rejected`; una aprobación explícita se preserva como `human_gate_approved` en receipts terminales.
- El kernel devuelve un receipt estructurado. No ofrece persistencia durable automática; el caller es responsable de persistirlo si la necesita.

**Términos de este repositorio:** Una **capability** es una acción disponible; un **grant** es la authority para un efecto; un **human gate** es la superficie de decisión que el kernel consulta cuando la authority no basta, no un workflow completo de aprobación autenticada; **provenance** registra de dónde viene un resultado o decisión; un **receipt** es el objeto estructurado que devuelve la operación, no persistencia durable automática; un **criterion** es el estándar que gobierna la operación.

- [`demo/x402/`](./demo/x402/) es el único lugar que conoce x402, Stellar y USDC. Es un ejemplo de capability económica, no la identidad de Vespi. El adapter chequea los términos efectivos del 402 antes de crear el payload contra el efecto fijo declarado de 0.01 USDC y el grant de la operación.
- [`experiments/`](./experiments/) conserva corridas y evidencia públicas. [`001`](./experiments/001-operator-professor-loop/RUN.md) registra un loop Operator↔Professor; [`002`](./experiments/002-x402-slice1/RUN.md) registra una slice anterior de x402/Stellar en testnet con receipts y un fallo de verificación conservado; [`005`](./experiments/005/RUN.md) registra la evaluación final de RUN 05, **CLOSED** dentro de su alcance local/offline declarado.

## Cómo piensa el kernel sobre authority y operaciones

La operación declara los efectos que requiere. El chequeo de authority compara esos requisitos con los grants disponibles. No se llama a una capability hasta que los requisitos sean suficientes o una persona la apruebe explícitamente. Solo entonces ocurre `perform`, y el resultado se verifica y se devuelve como receipt.

La frontera es deliberadamente pequeña:

- `required()` dice qué intends hacer.
- `authority` dice qué puede hacer la operación, incluido el destino cuando un grant es específico.
- el gate humano es una superficie de decisión, no un sustituto de la disponibilidad de una capability.
- `perform()` no es evidencia de éxito; la verificación es separada.
- un receipt devuelto no es durable automáticamente.

RUN 05 afiló estas fronteras sin convertirlas en leyes universales: la authority debe restringir el side effect real antes de que ocurra; un receipt no puede atribuir una decisión humana que no ocurrió; un receipt estructurado no es persistencia durable; disponibilidad de capability no es authority; un criterio alcanzable no es necesariamente un criterio cargado; y las superficies de estado durable pueden divergir.

## El ejemplo de capability: x402 y Stellar

x402/Stellar es la primera capability pagada/económica ejercitada, **no la identidad de Vespi**. Es donde una operación puede encontrar una frontera económica real sin que el kernel tenga que conocer pagos.

La evidencia actual es **VERIFICACIÓN LOCAL / OFFLINE** para una ruta pre-firma acotada: versión, esquema exacto, Stellar testnet, contrato USDC, destinatario configurado, precio exacto de 0.01 USDC, timeout seguro, flujo de autorización patrocinado y grant efectivo. El test adversarial demuestra, offline, que ofertas desviadas no llegan a `createPaymentPayload` mientras que la oferta exacta sí llega.

Un pago x402 live nuevo es **CURRENT LIVE NOT VERIFIED**. La respuesta 402 real, la firma, el facilitator, el settlement y la verificación Horizon siguen **NOT VERIFIED** en la corrida local actual. El experimento 002 aporta **EVIDENCIA HISTÓRICA DE TESTNET**, no evidencia actual de settlement live.

## Experimentos y evidencia

El registro público pertenece al objeto. Los experimentos conservan receipts, fallos, lecturas ciegas, verificaciones independientes y preguntas abiertas a la vista. Un método, benchmark o skill first-party no se convierte en ley solo por aparecer en este repositorio.

La pregunta sigue abierta: ¿cuánta de la continuidad observada pertenece a Vespi y cuánta se reduce a buen estado, policy, routing, capabilities del host y verificación? No se presupone el residuo.

## LA APUESTA

> **DIRECCIÓN, NO IMPLEMENTACIÓN ACTUAL.**

La apuesta es una operación que conserve significado más allá de la vida de un solo modelo, host o sesión, con suficiente estado para continuar honestamente después de una interrupción.

### Continuidad

Imaginamos una operación capaz de sobrevivir:

- cambios de modelo;
- cambios de host;
- agotamiento de cuota o capacidad;
- interrupciones;
- capability failures;
- reconstrucción desde estado durable;

conservando suficientemente:

- el goal;
- la authority;
- la evidencia;
- la provenance;
- el verification state;
- las condiciones de intervención humana.

Un modelo, host o proveedor puede desaparecer sin que eso implique necesariamente que la operación dejó de existir. **Dirección, no implementación actual:** Vespi poseería la semántica de continuación; el host/runtime podría encargarse de despertar el proceso. El repositorio actual no contiene un runtime cross-host, scheduler, migration engine ni quota manager.

### Una interrupción mecánica no es una interrupción humana

> **Un límite de recursos debería interrumpir el cómputo antes de interrumpir al humano.**

### La atención es un recurso finito

> **La autonomía no es cuánto tiempo puede operar Vespi sin un humano. Es cuánto trabajo legítimo puede completar sin consumir atención humana innecesaria.**

Un límite mecánico no debería consumir automáticamente la atención de una persona. Esperar, preguntar o detenerse puede ser el resultado correcto de una operación.

### Semántica de continuación

Eventualmente, la dirección incluye poder:

- hacer checkpoint de lo que importa;
- determinar qué sigue autorizado;
- seleccionar otra capability suficiente cuando corresponda;
- continuar o esperar según policy;
- verificar;
- preservar receipts y provenance;
- escalar solo cuando aparezca un umbral humano real.

Estas son direcciones a investigar, no capacidades actuales.

### Economía de modelos y capabilities

> **Usa la inteligencia suficiente más barata. La escalación debe ganarse.**

Una capability de Vespi puede ser local, host-native, external o paid. Su forma económica no define Vespi. x402/Stellar es la primera capability pagada/económica ejercitada, no la identidad de Vespi.

### Honestidad sobre la incertidumbre

> **Todavía no sabemos cuánto de esto requiere algo específicamente llamado Vespi. Parte puede reducirse a buen estado, policy, routing, capabilities del host y verificación. Descubrir ese residuo es parte del experimento.**

La apuesta puede ser fuerte y seguir siendo falsable. No inventamos “ese Vespi” para justificar la marca.

## Relación con Lore Plugin

> **Lore Plugin prepara el terreno. Vespi opera sobre él.**

**Hoy:** Vespi es un repositorio técnico separado. LUS y Lore Plugin son parte de su genealogía y su criterio. Todavía no existe una skill first-party `vespi` publicada.

En la división de trabajo prevista, Lore Plugin debe aportar el suelo durable que una operación necesita: goal/state, el criterion y owner relevantes, la frontera de authority y evidence/provenance. Vespi opera dentro de esos límites; no reemplaza Lore Plugin ni crea un segundo camino de aprendizaje o escritura.

**Dirección, no implementación actual:** `vespi` debería convertirse eventualmente en una skill first-party de Lore Plugin, heredar su modelo de governance y authority y conservar ese único camino de aprendizaje y escritura.

## Origen, catalizador, presión y horizonte

- **ORIGEN: LUS + Lore Plugin.** Vespi crece del trabajo sobre criterio, continuidad y authority operacional, no de un protocolo de pagos.
- **CATALIZADOR / PRESIÓN PÚBLICA ACTUAL: Find Your Way + Tellus.** Son contexto y presión de evaluación. No se reclama ownership, sponsorship, endorsement, partnership, funding ni afiliación oficial.
- **PRIMERA PRESIÓN ECONÓMICA EJERCITADA: x402 + Stellar testnet.** El pago es una presión que expuso preguntas reales de authority; no es el origen del proyecto.
- **HORIZONTE: Meridian / HackMeridian 2026.** El [evento HackMeridian](https://meridian.stellar.org/event-details) es contexto y horizonte público. No se reclama ownership, sponsorship, endorsement, partnership, funding ni afiliación oficial.

## NO VERIFICADO: afirmaciones externas y de continuidad

RUN 05 está **CLOSED** dentro de su alcance de evaluación local/offline declarado. Estas no son afirmaciones actuales:

- un pago x402 live nuevo, una firma, facilitator, settlement o verificación Horizon;
- persistencia durable automática de receipts o memoria persistente;
- un runtime general de orchestration, scheduler universal, daemon, migration engine o quota manager;
- production readiness, cumplimiento regulatorio o un protocolo estable;
- una skill first-party `vespi` publicada;
- un claim de que Vespi es un agente de pagos crypto, un producto de Tellus o un proyecto creado por un hackathon.

## Quickstart / ruta de evaluación

**Nivel 1: kernel, nada externo.** Clona el repositorio y ejecuta:

```bash
node --test
```

La suite cubre operación, authority acotada, provenance del gate humano, fronteras de capability, verificación y receipts. No requiere wallet, fondos ni red.

**Nivel 2: demo acotada de x402 en testnet.** Consulta [`demo/x402/README.md`](./demo/x402/README.md). La ruta pagada requiere una cuenta testnet fondeada, trustline USDC, receptor, variables de entorno y acceso a red. La ruta de rechazo puede detenerse antes de contactar el endpoint. La corrida local actual no certifica un pago live nuevo.

## ¿Por qué publicarlo tan temprano?

Porque la historia también es evidencia. Vespi no debería aparecer después con un relato de origen perfecto. Lo que sobrevive, lo que falla, lo que cambia y lo que se rechaza debería quedar inspeccionable mientras el proyecto todavía se está convirtiendo en sí mismo.

## Autor

**Andrés Peña Mellado**

Digital Art Director & Creative Developer trabajando entre agentes de IA, Web3, diseño e investigación.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/) &nbsp;&nbsp; <img src="./assets/icons/v2/discord.svg" width="28" alt="Discord">

---

[Génesis](./docs/GENESIS.md) · [Changelog](./CHANGELOG.md) · [Experimentos](./experiments/) · [Release v0.1.1-kernel](https://github.com/andresanemic/vespi/releases/tag/v0.1.1-kernel) · [Licencia MIT](./LICENSE)

</details>
