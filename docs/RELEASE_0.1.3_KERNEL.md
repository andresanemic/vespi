# v0.1.3 (candidate — not a tag, not published)

> **Not released.** The last tag in this repository is
> [`v0.1.2-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.2-kernel). Nothing on this
> page is a release note for something the world can install; it is what this tree proposes, written
> so that a person can decide whether to tag it.

## What you no longer have to carry

**The unit is the operation, and the operation is what gets kept.**

Until now, when a session ended and another had to begin, what carried over was a summary. A
summary does not say who allowed the thing, how much, until when, to whom, or whether the thing that
was supposed to happen actually happened. Those are not details of a summary — they are the
operation. So Vespi starts from the operation, and this candidate is what makes that hold.

- **You re-decide less.** Resuming what was agreed does **not** ask you anything. The kernel reads
  the operation back from its receipts, not from a handoff document, and it only continues if what it
  is about to do is still what was agreed.
- **Anything off the agreement comes back to you.** Three things open the gate, and only three: a
  verified receipt for an action outside the agreement, a change to the scope, amount, ceiling or
  status of the next action, and a last receipt for that action that was `blocked`, `paused` or
  `needs_human_decision`. It does not guess between them.
- **The impossible thing comes back blocked, with its way out.** Not retried blindly. The receipt
  names the exit, and the agreement says who may pause it.
- **The agent never consents for you.** If the operation declares an agent, an approval whose `by`
  is that agent is refused, the kernel writes down that the agent cannot consent for the person, and
  the operation returns to `needs_human_decision`.

## The authority, the gate and the receipt

This is the depth, and it enters after the first screen, not instead of it.

- **Authority is granted with three things at once** — a clock, a budget and a destination. A grant
  with `to` covers only that destination. A grant without `to` covers any destination but keeps
  **one** budget: 400 + 400 against a 500 ceiling is not enough. An expired grant is refused with a
  reason that names the moment it expired, and `now` is injectable, so the same grant can be
  exercised on both sides of its own clock.
- **Several people can be required.** `authority.signers = { required, allowed }`. The gate returns
  identities, not cryptographic signatures, and the kernel counts *distinct* identities drawn from
  `allowed`. The same identity twice counts once; an identity outside `allowed` does not count; the
  operation's own agent never counts; approvals pre-loaded into the authority do not count, only
  approvals that arrive through the gate.
- **The human gate has its four gestures**: show the cost first, never let the agent give the
  consent that belongs to the person, keep what goes public optional and off, and name the exit in
  every refusal.
- **Every step leaves a receipt** with a SHA-256 fingerprint over the canonical form, and the
  fingerprint **proves integrity, not authenticity**: it carries no key, so anyone able to rewrite
  the receipts file can recompute it. Coverage is not a claim — a check counts as covered only when
  it came back `true`, and anything else is listed in `notCovered` by name.
- **Anchoring on Stellar is an interface, not a certificate.** `pending` when nothing reached the
  network, `submitted` when the adapter returned a transaction hash, and `anchored` **only** when
  the verifier confirms the digest *and* the network. A transaction hash on its own is not an anchor.

## What is deliberately still open

Written as open, not softened.

- **`0.1.4` is already scoped and not built**: emergency access granted in advance and exercised with
  an immediate receipt, a zero-knowledge proof verifier, skill provenance, and x402 in live.
- **The receipt is not durable by itself.** The kernel returns a receipt; whoever calls it owns where
  it lives. There is no cross-host runtime, scheduler, migration engine or quota manager here.
- **A fresh live x402 payment is NOT VERIFIED**: the real 402 response, the signature, the
  facilitator, the settlement and Horizon verification remain unverified in the current local run.
- **The commits in this repository are not signed.** `git log --format='%G?'` returns `N` for every commit in this repository.
  See [`../NOTICE`](../NOTICE).
- **No stable protocol, no production readiness, no regulatory compliance, and no external security
  review has run.** A review enters this repository with its run attached, or it does not enter.

## What was tested, and what was not

| Claim | Result | Cut and scope |
|---|---|---|
| `node --test test/*.test.js` at the previous RC5 cut `54c20c7` | **181/181**, exit 0 | Historical baseline carried by the installed RC5 plugin; not the 0.1.3 candidate result. |
| Candidate core suite, `node --test test/*.test.js` at `892bd91` | **203/203**, exit 0 | Kernel tests, run on 2026-09-30. |
| Full candidate suite, `node --test` at `892bd91` | **249/249**, exit 0 | Includes the x402 demo with its dependencies available. |
| Benchmark for this version | **Not run.** No figure on this page describes a measured effect of 0.1.3. | — |
| External review | **Pending.** No review is credited here without its run attached. | — |
| Installation | **None.** This is a candidate, not a tag. | — |

---

# v0.1.3 (candidato — sin etiqueta, sin publicar)

> **No está publicado.** La última etiqueta de este repositorio es
> [`v0.1.2-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.2-kernel). Nada de esta
> página es la nota de un lanzamiento que alguien pueda instalar; es lo que propone este árbol,
> escrito para que una persona decida si etiquetarlo.

## Lo que ya no tienes que cargar tú

**La unidad es la operación, y lo que se conserva es la operación.**

Hasta ahora, cuando una sesión terminaba y otra tenía que empezar, lo que pasaba era un resumen. Un
resumen no dice quién autorizó la cosa, cuánto, hasta cuándo, a quién, ni si la cosa que debía
pasar de verdad pasó. Eso no son detalles de un resumen: es la operación. Por eso Vespi parte de la
operación, y este candidato es lo que hace que eso se sostenga.

- **Vuelves a decidir menos.** Retomar lo acordado **no** te pregunta nada. El kernel relee la
  operación desde sus recibos, no desde un documento de traspaso, y solo continúa si lo que está a
  punto de hacer sigue siendo lo acordado.
- **Lo que se sale del acuerdo vuelve a ti.** Tres cosas abren la puerta, y solo tres: un recibo
  verificado de una acción fuera del acuerdo, un cambio en el alcance, la cantidad, el techo o el
  estado de la siguiente acción, y un último recibo de esa acción que fuera `blocked`, `paused` o
  `needs_human_decision`. No adivina entre ellas.
- **Lo imposible vuelve bloqueado, con su salida.** No se reintenta a ciegas. El recibo nombra la
  salida, y el acuerdo dice quién puede pausarlo.
- **El agente nunca consiente por ti.** Si la operación declara un agente, se rechaza una aprobación
  cuyo `by` sea ese agente, el kernel deja escrito que el agente no puede consentir por la persona,
  y la operación vuelve a `needs_human_decision`.

## La autoridad, la puerta y el recibo

Esta es la profundidad, y entra después de la primera pantalla, no en vez de ella.

- **La autoridad se otorga con tres cosas a la vez**: un reloj, un presupuesto y un destino. Un
  grant con `to` cubre solo ese destino. Uno sin `to` cubre cualquier destino pero conserva **un**
  presupuesto: 400 + 400 contra un techo de 500 no alcanza. Un grant vencido se rechaza con una
  razón que nombra el momento en que venció, y `now` es inyectable, así que el mismo grant se puede
  ejercitar a los dos lados de su propio reloj.
- **Se puede exigir más de una persona.** `authority.signers = { required, allowed }`. La puerta
  devuelve identidades, no firmas criptográficas, y el kernel cuenta identidades *distintas* tomadas
  de `allowed`. La misma identidad dos veces cuenta una sola vez; una identidad fuera de `allowed` no
  cuenta; el agente de la operación nunca cuenta; las aprobaciones cargadas de antemano en la
  autoridad no cuentan, solo las que llegan por la puerta.
- **La puerta humana tiene sus cuatro gestos**: mostrar el costo primero, nunca dejar que el agente
  dé el consentimiento que le toca a la persona, mantener lo que sale a lo público opcional y
  apagado, y nombrar la salida en todo rechazo.
- **Cada paso deja un recibo** con una huella SHA-256 sobre la forma canónica, y la huella **prueba
  integridad, no autenticidad**: no lleva clave, así que cualquiera que pueda reescribir el archivo
  de recibos puede recalcularla. La cobertura no es una afirmación: un chequeo cuenta como cubierto
  solo cuando volvió `true`, y cualquier otra cosa aparece en `notCovered` por su nombre.
- **Anclar en Stellar es una interfaz, no un certificado.** `pending` cuando nada llegó a la red,
  `submitted` cuando el adaptador devolvió un hash de transacción, y `anchored` **solo** cuando el
  verificador confirma el digest *y* la red. Un hash por sí solo no es un anclaje.

## Lo que sigue deliberadamente abierto

Escrito como abierto, no suavizado.

- **El `0.1.4` ya está acotado y no está construido**: acceso de emergencia otorgado por adelantado
  y ejercido con recibo inmediato, un verificador de pruebas de conocimiento cero, procedencia de
  skills y x402 en vivo.
- **El recibo no es durable por sí solo.** El kernel devuelve un recibo; quien lo llama decide dónde
  vive. Aquí no hay runtime cross-host, scheduler, migration engine ni quota manager.
- **Un pago x402 live nuevo está NO VERIFICADO**: la respuesta 402 real, la firma, el facilitator,
  el settlement y la verificación en Horizon siguen sin verificarse en la corrida local actual.
- **Los commits de este repositorio no están firmados.** `git log --format='%G?'` devuelve `N` para todos los commits de este repositorio. Ver [`../NOTICE`](../NOTICE).
- **No hay protocolo estable, ni producción lista, ni cumplimiento regulatorio, y no se ha corrido
  ninguna revisión de seguridad externa.** Una revisión entra a este repositorio con su corrida
  adjunta, o no entra.

## Qué se probó, y qué no

| Afirmación | Resultado | Corte y alcance |
|---|---|---|
| `node --test test/*.test.js` en el corte RC5 anterior `54c20c7` | **181/181**, exit 0 | Línea base histórica que llevaba el plugin RC5 instalado; no es el resultado del candidato 0.1.3. |
| Suite central candidata, `node --test test/*.test.js` en `892bd91` | **203/203**, exit 0 | Pruebas del kernel, corridas el 2026-09-30. |
| Suite completa candidata, `node --test` en `892bd91` | **249/249**, exit 0 | Incluye la demo x402 con sus dependencias disponibles. |
| Benchmark de esta versión | **No corrido.** Ninguna cifra de esta página describe un efecto medido del 0.1.3. | — |
| Revisión externa | **Pendiente.** Aquí no se acredita ninguna revisión sin su corrida adjunta. | — |
| Instalación | **Ninguna.** Esto es un candidato, no una etiqueta. | — |
