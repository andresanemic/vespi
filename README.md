<p align="center">
  <a href="./assets/vespiqueen-genesis.png"><img src="./assets/vespiqueen-genesis.png" alt="Vespiqueen genesis" width="100%"></a>
</p>

<h1 align="center">Vespi</h1>

<p align="center">
  <a href="./docs/RELEASE_0.1.5_KERNEL.md"><img src="https://img.shields.io/badge/version-v0.1.5-D7B698?style=for-the-badge&labelColor=07111A" alt="Version: v0.1.5"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-D7B698?style=for-the-badge&labelColor=07111A" alt="License: Apache 2.0"></a>
  <a href="./docs/SUITE_RESULT_0.1.5.txt"><img src="https://img.shields.io/badge/suite-1196_pass_%C2%B7_24_todo-E0C170?style=for-the-badge&labelColor=07111A" alt="Saved suite: 1,196 passed, 24 todo, 0 failed"></a>
  <a href="#the-projects"><img src="https://img.shields.io/badge/projects-11_documented-D7B698?style=for-the-badge&labelColor=07111A" alt="11 documented project explorations"></a>
  <a href="./docs/TESTNET_EVIDENCE.md"><img src="https://img.shields.io/badge/testnet-50_readbacks_%C2%B7_5_semantic-E0C170?style=for-the-badge&labelColor=07111A" alt="50 testnet readbacks; 5 cases semantically verified"></a>
  <a href="./demo/x402/"><img src="https://img.shields.io/badge/demo-x402_%C2%B7_Stellar_SDK-E0C170?style=for-the-badge&labelColor=07111A" alt="Opt-in x402 demo using the Stellar SDK"></a>
</p>

<p align="center"><b>The engine for building apps with AI on Stellar. You drive.</b><br>You talk to the AI, it builds, and you decide what matters. What you learn stays for next time.<br>We want Vespi to be the official kernel for building apps on Stellar.</p>


---

## Clone and run

The kernel runs on Node.js 24 or later and has no runtime dependencies. This repository is a source checkout, not a root-level npm package.

```sh
git clone https://github.com/andresanemic/vespi.git
cd vespi
node examples/walkthrough.js
```

At the prompt, enter `Ada: approve`. Inspect the receipt’s `status`, `coverage` and `notCovered` fields.

<details>
<summary><b>Read in English</b></summary>

<a id="english"></a>

## What you can do today

- [Install Lore Plugin](https://github.com/andresanemic/lore-plugin) — the kit you work with

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

The [offline walkthrough](./docs/WALKTHROUGH.md) runs without installing dependencies for the kernel. To run the complete suite, install the x402 demo’s dependencies from its folder, then run the tests and offline evidence check:

```sh
(cd demo/x402 && npm ci)   # required by the complete suite
node --test "test/*.test.js"
node scripts/verify-testnet-evidence.mjs --offline
```

The walkthrough's [test](./test/walkthrough.test.js) checks an observed local effect and a next action selected in another process, but the receipt is passed to that process explicitly: this does not demonstrate automatic transfer, durable storage or authenticated human identity. The [saved suite result](./docs/SUITE_RESULT_0.1.5.txt) records the command, exact counts, Node version and Git baseline for the published cut. The [judge guide](./docs/FOR_JUDGES.md) explains how to reproduce the evidence and its limits.

### Authority, a human gate and receipts

The kernel is JavaScript without runtime dependencies. A capability declares its requirements; the operation checks authority before `perform`, asks the human gate when required and obtains a separate verification result. [Authority tests](./test/k2.test.js) cover asset, ceiling, destination, expiry and distinct named approvals, but ordinary approval names are labels rather than authenticated signatures and money budgets are not accumulated across operations. The host controls its tools, identities, clock and storage.

[Receipt tests](./test/k3.test.js) cover the SHA-256 digest, named successful checks and omissions, but the digest proves integrity rather than authenticity and can be recomputed by anyone who rewrites the receipt. An external anchor requires a separate confirmation of digest and network. `buildReceipt({ anchorNetwork })` accepts `stellar:testnet` (the default) or `stellar:pubnet`; unsupported networks throw. All chain evidence here is testnet, on fictional data and with no real money.

[The capability catalog](./docs/CAPABILITIES.md) explains the API and host responsibilities.

### Evidence you can open

[The evidence file](./docs/testnet-evidence.json) records 50 successful testnet transactions read back from Horizon, with 5 cases semantically verified and 45 partially verified, and 0 discrepancies. Expectations come from local execution records rather than Horizon; partial checks do not fill in missing facts. [The evidence guide](./docs/TESTNET_EVIDENCE.md) owns the transaction links, field coverage and historical payment details, including the 0.1.3 adapter's saved x402 receipt. That history is historical evidence for the earlier adapter only. Check file shape offline with `node scripts/verify-testnet-evidence.mjs --offline`; the guide also provides a comparison against saved responses and an optional network refresh.

### Lore Plugin and the build method

[Lore Plugin](https://github.com/andresanemic/lore-plugin) supplies criterion and the coordinator workflow; Vespi supplies the authority and receipt semantics around an operation. The [method](./docs/METHOD.md) describes loops, test-first work, specifications, bounded delegation, blind reading and separate verification; it is a workflow for host tools, not a kernel that generates apps or images itself. Lore Plugin carries a pinned kernel, so this source snapshot does not update an installed kit automatically.

The agreement keeps its order. Its purpose is to preserve your agency and avoid repeated decisions; its method coordinates bounded authority, a human gate and receipts; each operation's concrete result must be checked. The [verification record](./docs/VERIFICATION.md), [judge findings from the earlier cut](./docs/JUDGES_FINDINGS_0.1.4.md), [prior-art notes](./docs/PRIOR_ART.md) and [experiments](./experiments/) retain construction history. Model reviews independent of the builders are not an external security audit. The method credits [The Fable Method](https://github.com/Sahir619/fable-method); Raven MCP, Stellar and the Lore/LUS work belong to the construction narrative, not proof that the whole product operates autonomously.

### Author and license

Andrés Peña Mellado, Digital Art Director & Creative Developer.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/)

Kernel license: [Apache-2.0](./LICENSE), with attribution in [NOTICE](./NOTICE).

</details>

---

<details>
<summary><b>Leer en español</b></summary>

<p align="center"><b>Postulamos a la hackatón Find Your Way y planeamos participar en Meridian.</b><br><a href="#empieza-con-una-operacion">Clona y ejecuta</a> · <a href="./docs/FOR_JUDGES.md">Guía para jueces</a> · <a href="./docs/TESTNET_EVIDENCE.md">Evidencia de testnet</a></p>

## Español

<a id="español"></a>

<p align="center"><b>El motor para crear apps con IA en Stellar. Tú manejas.</b><br>Conversas con la IA, ella construye y tú decides lo importante. Lo que aprendes queda para la próxima vez.<br>Queremos que Vespi sea el kernel oficial para crear apps en Stellar.</p>

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
git clone https://github.com/andresanemic/vespi.git
cd vespi
node examples/walkthrough.js
```

El demo x402 tiene dependencias propias. Instálalas solo si vas a correr la suite completa:

```sh
(cd demo/x402 && npm ci)
node --test "test/*.test.js"
node scripts/verify-testnet-evidence.mjs --offline
```

[La prueba del recorrido](./test/walkthrough.test.js) comprueba un efecto local observado y la selección de la siguiente acción en otro proceso, pero el recibo se pasa explícitamente a ese proceso: no demuestra transporte automático, almacenamiento durable ni identidad humana autenticada. [El resultado guardado de la suite](./docs/SUITE_RESULT_0.1.5.txt) registra el comando, los conteos exactos, la versión de Node y la base Git del corte publicado. [La guía para jueces](./docs/FOR_JUDGES.md) explica cómo reproducir la evidencia y sus límites.

### Autoridad, puerta humana y recibos

El kernel es JavaScript sin dependencias de runtime. Una capacidad declara sus requisitos; la operación comprueba autoridad antes de `perform`, consulta la puerta humana cuando corresponde y recibe una verificación separada. [Las pruebas de autoridad](./test/k2.test.js) cubren activo, techo, destino, vencimiento y aprobaciones con nombres distintos, pero los nombres de aprobación ordinaria son etiquetas y no firmas autenticadas, y los presupuestos de dinero no se acumulan entre operaciones. El host controla herramientas, identidades, reloj y almacenamiento.

[Las pruebas de recibos](./test/k3.test.js) cubren el digest SHA-256, comprobaciones exitosas con nombre y omisiones, pero el digest demuestra integridad y no autenticidad, y cualquiera que reescriba el recibo puede recalcularlo. Un ancla externa exige confirmar por separado digest y red. `buildReceipt({ anchorNetwork })` acepta `stellar:testnet` (el valor por defecto, sin cambio) o `stellar:pubnet`; una red no admitida produce un error. El ancla pendiente no prueba interacción con una red y su network no entra al digest del recibo. Toda evidencia de cadena aquí es testnet, con datos ficticios y sin dinero real.

[El catálogo de capacidades](./docs/CAPABILITIES.md) explica la API y las responsabilidades del host.

### Evidencia que puedes abrir

[El archivo de evidencia](./docs/testnet-evidence.json) registra 50 transacciones exitosas en testnet leídas de Horizon, con 5 casos verificados semánticamente, 45 parcialmente verificados y 0 discrepancias. Las expectativas vienen de registros locales de ejecución y no de Horizon; las comprobaciones parciales no completan hechos ausentes. [La guía de evidencia](./docs/TESTNET_EVIDENCE.md) contiene los enlaces de transacciones, la cobertura por campos y los detalles de pagos históricos, incluido el recibo x402 del adaptador de 0.1.3. Esa historia es evidencia histórica de aquel adaptador. Comprueba la forma del archivo sin red con `node scripts/verify-testnet-evidence.mjs --offline`; la guía también permite comparar respuestas guardadas y volver a consultar la red de forma opcional.

### Lore Plugin y el método de construcción

[Lore Plugin](https://github.com/andresanemic/lore-plugin) aporta el criterio y el flujo del coordinador; Vespi aporta la semántica de autoridad y recibos alrededor de una operación. [El método](./docs/METHOD.md) describe ciclos, pruebas primero, especificaciones, delegación acotada, lectura ciega y verificación separada; es un flujo de trabajo para herramientas del host, no un kernel que genere apps o imágenes por sí solo. Lore Plugin lleva una copia fija del kernel, por lo que este corte de código no actualiza automáticamente un kit instalado.

El acuerdo conserva su orden. La finalidad es cuidar tu agencia y evitar decisiones repetidas; el método coordina autoridad acotada, puerta humana y recibos; el resultado concreto debe comprobarse en cada operación. [El registro de verificación](./docs/VERIFICATION.md), [los hallazgos de jueces del corte anterior](./docs/JUDGES_FINDINGS_0.1.4.md), [las notas de arte previo](./docs/PRIOR_ART.md) y [los experimentos](./experiments/) conservan la historia de construcción. Las revisiones por modelos independientes de sus constructores no son una auditoría de seguridad externa. El método acredita [The Fable Method](https://github.com/Sahir619/fable-method); Raven MCP, Stellar y el trabajo de Lore/LUS pertenecen al relato de construcción, no prueban que el producto completo opere de forma autónoma.

### Autor y licencia

Andrés Peña Mellado, Digital Art Director & Creative Developer.

[<img src="./assets/icons/v2/telegram.svg" width="28" alt="Telegram">](https://t.me/andresanemic) &nbsp;&nbsp; [<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/icons/v2/x-dark.svg"><img src="./assets/icons/v2/x.svg" width="28" alt="X"></picture>](https://x.com/andresanemic) &nbsp;&nbsp; [<img src="./assets/icons/v2/linkedin.svg" width="28" alt="LinkedIn">](https://www.linkedin.com/in/andresanemic/)

Licencia del kernel: [Apache-2.0](./LICENSE), con atribución en [NOTICE](./NOTICE).

</details>
