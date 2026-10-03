# What Vespi can do

> Español: [más abajo](#qué-puede-hacer-vespi)

Vespi is a small, trusted kernel: it supervises a piece of work without knowing how to do that work itself. Think of a building's fire door and logbook: they set limits, stop the work when needed, and record what was checked, but they do not build the building. You use it so each app can reuse those controls instead of rebuilding them and asking you to trust a summary.

## Authority: what may happen, how much, where and until when

| Name | What it does | Example |
|---|---|---|
| `grantSpend(asset, maxAmount, to, expiresAt)` | Makes a spend permission with an asset and ceiling, and optionally a destination and expiry. It returns `{ spend: [...] }`; amounts are digit strings, such as `'500'`. | Allow up to 500 units of a named asset to one recipient until a stated time. |
| `sufficient(requirements, authority, options)` | Checks whether every requested spend fits a live grant for the same asset and recipient, and whether the total against that grant stays under its ceiling. A grant without `to` can cover different recipients, but they share one budget. It returns `{ ok, reason }`. | Two requests of 400 against one 500 grant fail, even if they go to different recipients. An expired match is refused with its expiry time. |
| `authority.signers = { required, allowed }` | Makes the human gate require that many distinct names from `allowed`. Names are labels, not cryptographic signatures. The operation's own agent and approvals written into the authority do not count. | If two of Ana, Bo and Cami are required, two different allowed people must answer through the gate. |
| `authority.pausers` | Lists the identities allowed to pause and resume an operation. | A named person can stop a process before it continues. |
| `options.now` for `sufficient` | The predicate accepts a clock under `options.now` and uses it to check grant expiry. In this worktree, `runOperation` does not pass `io.now` to `sufficient`, and receipt timestamps use the system clock; so `io.now` is not currently an operation-level clock. | A direct caller of `sufficient` can check the same expiry against a chosen moment. |

**Where to look:** [`src/authority.js`](../src/authority.js), [`src/operation.js`](../src/operation.js), [`test/k1.test.js`](../test/k1.test.js), [`test/k2.test.js`](../test/k2.test.js), [`test/operation.test.js`](../test/operation.test.js).

## One operation from request to result

| Name | What it does | Example or result |
|---|---|---|
| `createOperation` | Creates an operation with a goal, action, authority, optional agent and a named way out. It starts in `created`. | “Pay this invoice” can be the goal; “cancel or change the agreement” can be its exit. |
| `runOperation` | Asks the capability what authority it needs, checks that authority, runs `perform` at most once for that operation, then asks a separate verifier to check its evidence. It returns a status, receipt and, only when verified, output. | If a payment call times out, the result is `not_verified`; the kernel does not blindly repeat it. |
| `pauseOperation` | Changes a non-running, non-terminal operation to `paused` only when `who` appears in `authority.pausers`. | A listed person can pause a job before it runs again. |
| `resumeOperation` | Changes a paused operation back to `created`, only for a listed pauser. | The host may call `runOperation` again after an authorized resume. |
| `STATES` | Names the public states: `needs_human_decision` means the gate is waiting; `running` means `perform` is underway; `verified` means the verifier confirmed it; `failed` means the capability failed; `not_verified` means the effect may have happened but was not confirmed; `blocked` means the capability declared the task impossible; `paused` means an authorized person stopped it. | These are the operation's outcomes and checkpoints. |
| `DEFAULT_EXIT` | Supplies the default way out: `return to the person: change the agreement or cancel`. An operation can provide its own `exit`. | A refusal can point to a concrete next choice instead of leaving the person stuck. |
| `capability.required(operation)` | Declares the spend needed before work starts, as `{ spend: [{ asset, amount, to }] }`. It can instead declare `{ impossible: true, reason, exit }`. | A task that cannot legally proceed can return `blocked` with the reason and exit; `perform` is not called. |
| `capability.perform(context)` | Does the effect and returns a result such as `{ ok, evidence, output }`. A thrown error is a failure; an uncertain outcome is `not_verified`. | A payment capability can perform the payment, while the kernel remains unaware of its payment protocol. |

When authority is missing or does not cover the declared request, `perform` does not run. The operation opens the human gate; without an approval it returns `needs_human_decision`. A capability that declares no spend requirement is rejected as invalid.

**Where to look:** [`src/operation.js`](../src/operation.js), [`test/operation.test.js`](../test/operation.test.js), [`test/t1-adversarial.test.js`](../test/t1-adversarial.test.js).

## The human gate

The gate opens when the available authority does not cover the requirement, and always when `authority.signers` is present. Its request shows the requirements and cost first, includes the operation's exit, and sets `publicByDefault` to `false`. The four gestures named for this gate are: show the cost first; never let the agent consent for the person; keep public disclosure optional and off by default; name the exit in every refusal. These describe how the gate should behave, not four button labels supplied by the kernel.

The agent cannot consent for the person. If the approval names the operation's agent, or does not name a person when one is required, it is rejected. For a multi-person authority, only distinct allowed identities count. An approved request becomes authority for the declared spend, with the requested destination; the receipt records who approved as `decidedBy`. A rejection returns `needs_human_decision`, records `human_gate_rejected`, and names the exit. For example, if a backup destination is not authorized, the person can reject it and the receipt can say to change the agreement or cancel.

An optional `io.decide` model may attach a suggestion if its result passes the configured confidence threshold. It only advises; the person's named approval is still required.

**Where to look:** [`src/operation.js`](../src/operation.js), [`test/operation.test.js`](../test/operation.test.js), [`test/k2.test.js`](../test/k2.test.js), [`test/k2-hardening.test.js`](../test/k2-hardening.test.js).

## Receipts and public anchors

| Name | What it does | Example or result |
|---|---|---|
| `buildReceipt` | Builds a receipt with operation, capability, authority granted and exercised, outcome, evidence, verification, coverage, omissions and a SHA-256 digest. It keeps only named evidence fields and bounded scalar values; unknown evidence fields are dropped. | A payment receipt can retain its transaction hash and payer while excluding unrelated response data. |
| `verifyReceipt` | Recalculates the digest and checks that the receipt body has not changed since it was sealed, and that a non-pending anchor is bound to that digest. It proves integrity, not who created the receipt: someone able to rewrite it can calculate a new digest. | Changing a receipt's status without recalculating its digest makes verification fail. |
| `coverage` and `notCovered` | A check appears in `coverage` only when its value is exactly `true`. False, missing or non-true checks are named in `notCovered`; `external anchor` is also listed until confirmed. | A verifier's `exactAmount: true` is covered; `recipient: false` is not. |
| Receipt statuses | The six allowed values are `verified`, `not_verified`, `failed`, `blocked`, `paused`, and `needs_human_decision`. | A receipt says whether the work was confirmed, failed, is uncertain, impossible, paused or waiting for a person. |
| `anchorReceipt` | Calls a synchronous anchor adapter with the receipt digest, then a verifier with the transaction hash, digest and network. | Without a verifier confirming the network record, a returned transaction hash only reaches `submitted`. |
| `anchorReceiptAsync` | Does the same with asynchronous adapter and verifier functions. | An async network client can submit, then read back and confirm the receipt digest. |

Anchoring advances honestly from `pending` (nothing submitted), to `submitted` (the adapter returned a transaction hash), to `anchored` (the verifier confirmed the digest on the claimed network). A hash alone is not an anchor. The verifier receives `stellar:testnet` or `stellar:pubnet`; it must check the network as well as the digest. The kernel itself does not send anything to a network.

**Where to look:** [`src/receipt.js`](../src/receipt.js), [`test/evidence.test.js`](../test/evidence.test.js), [`test/k3.test.js`](../test/k3.test.js), [`test/k3-hardening.test.js`](../test/k3-hardening.test.js).

## Continue tomorrow from receipts

| Name | What it does | Example or result |
|---|---|---|
| `resumeFromReceipts(receipts, agreement, options)` | Checks receipt digests and returns `lastState`, `nextAction`, `needsPerson`, a reason, the number of discarded receipts, and the agreement's `workingMode`. | If the first approved step is verified and the next is not started, it returns that next action. |

It discards receipts whose integrity check fails. It also refuses to treat a `verified` claim as proof when the receipt lacks `verification.verified === true`, or when the host cannot establish the effect: a local reversible action needs `verifyLocal`; an external effect needs an anchored receipt and `verifyExternal`. It ignores unrecognized or out-of-agreement work for automatic continuation and sends an out-of-agreement verified action back to the person. A next action with any declared `changes`, or one whose last receipt is `blocked`, `paused` or `needs_human_decision`, also needs a person. Returning to the already agreed next action does not itself open the human gate. A receipt with a valid local digest alone cannot prove an external event happened.

**Where to look:** [`src/continuity.js`](../src/continuity.js), [`test/k4.test.js`](../test/k4.test.js), [`test/k4-hardening.test.js`](../test/k4-hardening.test.js), [`test/rc6-confianza.test.js`](../test/rc6-confianza.test.js).

## Delegate bounded work and review it

| Name | What it does | Example or result |
|---|---|---|
| `createDelegation` | Records a task, delegate, orchestrator and medium: working directory (`cwd`), material and forbidden paths. The delegate and orchestrator must differ. | Ask a helper to review files in one project folder, with a secrets folder forbidden. |
| `recordStart` | Records whether the delegate could read its assignment. If not, records `failed_to_start` and says to relaunch. | A host refusal to open the assignment is visible instead of appearing as completed work. |
| `recordResult` | Records a digest of the delegate's output, files it reports touching, and an optional short spark. Files outside `cwd` or under a forbidden path are violations; a recorded violation persists. | A touched file outside the agreed folder leaves the work `out_of_bounds`. |
| `reviewDelegation` | Lets the bound orchestrator record findings, request corrections, or accept an in-bounds returned result. A correction moves the work to `needs_correction`; acceptance moves it to `accepted`. | The reviewer can ask for a missing citation before accepting. |
| `integrateDelegation` | Returns a sealed delegation receipt only when the state is `accepted`. It does not itself merge files or apply code. | Unreviewed work cannot pass this integration point. |
| `delegationReceipt` | Produces a digest-sealed record of the task, medium, delegate, reported touches, violations, output digest, corrections and sparks. | The record carries what was reported for later review. |
| `recordCard` | Records a short internal card for the orchestrator from the `eno` or `entre` deck. Cards marked silent are omitted from the receipt and the person's view. | The delegate's short spark is visible, while the orchestrator's silent card is private to this delegation state. |
| `personView` | Returns the person's view: state, task, delegate and orchestrator names, output digest, touched files, corrections and sparks. | The person can see what the delegate says it touched and what correction is pending. |

The medium check looks at paths the delegate reports as touched; it is not a sandbox that prevents file access. The host still has to control what the delegate can actually read or change. The module binds the declared orchestrator identity, but it cannot authenticate who is calling it; that identity check belongs to the host. `material` is recorded, but the code does not use it to narrow the permitted path area.

**Where to look:** [`src/delegation.js`](../src/delegation.js), [`test/k7.test.js`](../test/k7.test.js), [`test/t1-adversarial.test.js`](../test/t1-adversarial.test.js).

## Blockchain, x402 and Stellar

x402 is a payment protocol for a web request that asks to be paid before it returns the requested service. The kernel does not implement x402 or speak to Stellar; `demo/x402/` contains the demo adapter that connects them to a Vespi capability.

| Name | What it does |
|---|---|
| `x402Capability(options)` | Creates the demo capability. It declares exactly 0.01 USDC to a configured recipient on Stellar testnet, checks the server's 402 offer and prepared Soroban transfer, and performs the paid request. |
| `verifyPreparedTransaction(transaction, expected)` | Checks the prepared payment before it is sent, including the expected payer, recipient, amount, contract, transfer invocation and authorization digest. |
| `verifySettlement(evidence, options)` | Reads the settled transaction through the supplied Horizon client and checks that the transaction, network, payer, contract, transfer, recipient and exact amount match. Its named boolean checks feed the receipt's `coverage`; anything not true appears in `notCovered`. |

The demo uses the x402 facilitator to verify and settle the payment, and returns a marketing-plan result only after those checks pass. It rejects redirects and duplicate transaction use in its current process. The payment adapter lives outside the kernel so the kernel remains independent of x402, Stellar, USDC, SDKs and network access.

The receipt anchor is another adapter boundary: `anchorReceipt` and `anchorReceiptAsync` accept caller-provided submit and verify functions. Evidence of the actual testnet work, including the live 0.01 USDC payment, is in [`docs/TESTNET_EVIDENCE.md`](./TESTNET_EVIDENCE.md). The README states the limits: testnet, one facilitator and one payer; no mainnet claim.

**Where to look:** [`demo/x402/README.md`](../demo/x402/README.md), [`demo/x402/capability.js`](../demo/x402/capability.js), [`demo/x402/settlement.js`](../demo/x402/settlement.js), [`demo/x402/verify.test.mjs`](../demo/x402/verify.test.mjs), [`docs/TESTNET_EVIDENCE.md`](./TESTNET_EVIDENCE.md), [`src/receipt.js`](../src/receipt.js).

## A capability outside the kernel: respaldo

`capabilities/respaldo/` copies a folder into another folder, including binary files. It is incremental, writes a manifest with file hashes, never deletes destination files, and can verify, restore a selected file or folder, and find the latest copy by a partial name. It can target a folder already synced by Drive, Dropbox or OneDrive, but it does not call those services.

| Name | What it does |
|---|---|
| `respaldoCapability(options)` | Wraps a backup as a kernel capability. The authority must name the destination folder. |
| `crearVerificador(options)` | Creates the verifier that recalculates destination hashes and checks them against the manifest digest reported by the capability. |
| `respaldar(options)` | Copies new or changed files and writes the manifest. |
| `verificar(options)` | Recalculates file hashes and reports intact, changed, missing files and manifest integrity. |
| `restaurar(options)` | Restores a selected file or folder only after checking its hash; it does not overwrite an existing file unless `sobrescribir: true`. |
| `dondeEsta(options)` | Searches the manifest by partial name and returns the latest matching copy, or says there is none. |

It does not encrypt files, upload through a service API, keep versions, enforce storage quotas, or check whether a sync service is paused or conflicted. Empty folders are copied but are not listed in the manifest for restoration. A file whose content changes without a size or timestamp change can be missed by the incremental shortcut; run `verificar` to recalculate destination hashes.

**Where to look:** [`capabilities/respaldo/LEEME.md`](../capabilities/respaldo/LEEME.md), [`capabilities/respaldo/nucleo.js`](../capabilities/respaldo/nucleo.js), [`capabilities/respaldo/capability.js`](../capabilities/respaldo/capability.js), [`test/respaldo.test.js`](../test/respaldo.test.js).

## What people build with it

The README lists these functional projects and their current descriptions. They are proofs of concept on fictional data, not claims that each is ready for users. The mappings below name a kernel function only where the README description supports it.

| Project | Example of the problem | Kernel connection supported by the README |
|---|---|---|
| Queen | A Stellar marketing agency keeps its spending inside an approved ceiling and uses a simulated x402 payment layer. | Bounded spend authority; the project description explicitly mentions a ceiling. |
| Casa Firme | A housing committee decides who has authority, and every donation leaves a trace. | No specific kernel function named in the project description. |
| Ficha Contigo | A clinical record uses what the patient allowed; emergency access is granted in advance. | No specific kernel function named in the project description. |
| Cátedra | A university declares AI use, has grades signed by a professor and issues verifiable degrees. | No specific kernel function named in the project description. |
| Llavero | A person can see who asks for their data, why, under what permission and what was refused. | Permission and refusal are explicit in the description; no API function is named there. |
| Farolero | Agent work is delegated without code; a delegation can only narrow authority, and work outside it returns blocked. | Delegation is explicit in the description. |

The README also lists Permamuseum, Escribano, Marea, Vela and TEMIS. Their descriptions are available there; this catalog does not assign them kernel functions beyond what those descriptions establish.

**Where to look:** [`README.md`, “The functional projects”](../README.md#the-functional-projects), [`src/authority.js`](../src/authority.js), [`src/delegation.js`](../src/delegation.js).

## What Vespi does not do

There is no runtime that moves work between hosts, scheduler, daemon, migration engine or quota manager. The host has to wake the process and store its receipts; a receipt is not durable by itself. The kernel speaks to no network. x402 is demonstrated only on testnet with one facilitator and one payer. There is no claim here of mainnet support, production readiness, regulatory compliance or a stable protocol. A digest is not proof of who wrote a receipt, and an anchor counts only after a verifier confirms the digest and network.

**Where to look:** [`README.md`, “What it does not do yet”](../README.md#what-it-does-not-do-yet-and-what-is-not-verified), [`docs/VERIFICATION.md`](./VERIFICATION.md), [`src/receipt.js`](../src/receipt.js).

---

<a id="qué-puede-hacer-vespi"></a>

# Qué puede hacer Vespi

Vespi es un kernel pequeño y confiable: supervisa una parte del trabajo sin saber hacer ese trabajo por sí mismo. Piensa en la puerta cortafuego y el libro de registro de un edificio: ponen límites, detienen el trabajo cuando hace falta y anotan qué se comprobó, pero no construyen el edificio. Lo usas para que cada app reutilice esos controles en vez de volver a construirlos y pedirte que confíes en un resumen.

## Autoridad: qué puede ocurrir, cuánto, dónde y hasta cuándo

| Nombre | Qué hace | Ejemplo |
|---|---|---|
| `grantSpend(asset, maxAmount, to, expiresAt)` | Crea un permiso de gasto con un activo y un tope, y de forma opcional un destino y una fecha de vencimiento. Devuelve `{ spend: [...] }`; los montos son cadenas de dígitos, como `'500'`. | Permitir hasta 500 unidades de un activo determinado a una persona destinataria y hasta cierta fecha. |
| `sufficient(requirements, authority, options)` | Comprueba que cada gasto pedido quepa en un permiso vigente para el mismo activo y destinatario, y que el total no supere su tope. Un permiso sin `to` puede cubrir distintos destinatarios, pero comparten un solo presupuesto. Devuelve `{ ok, reason }`. | Dos pedidos de 400 contra un permiso de 500 fallan, aunque vayan a destinatarios distintos. Un permiso vencido se rechaza y se indica cuándo venció. |
| `authority.signers = { required, allowed }` | Hace que la puerta humana exija esa cantidad de nombres distintos de `allowed`. Son nombres de identidad, no firmas criptográficas. No cuentan el agente de la operación ni las aprobaciones escritas de antemano en la autoridad. | Si se requieren dos personas entre Ana, Beto y Cami, dos personas distintas permitidas deben responder por la puerta. |
| `authority.pausers` | Enumera las identidades que pueden pausar y reanudar una operación. | Una persona autorizada puede detener un proceso antes de que continúe. |
| `options.now` para `sufficient` | El predicado acepta un reloj en `options.now` y lo usa para comprobar vencimientos. En este worktree, `runOperation` no pasa `io.now` a `sufficient`, y las horas de los recibos usan el reloj del sistema; por eso `io.now` todavía no es un reloj de operación. | Quien llame directamente a `sufficient` puede revisar un vencimiento en un momento elegido. |

**Dónde mirar:** [`src/authority.js`](../src/authority.js), [`src/operation.js`](../src/operation.js), [`test/k1.test.js`](../test/k1.test.js), [`test/k2.test.js`](../test/k2.test.js), [`test/operation.test.js`](../test/operation.test.js).

## Una operación, desde el pedido hasta el resultado

| Nombre | Qué hace | Ejemplo o resultado |
|---|---|---|
| `createOperation` | Crea una operación con objetivo, acción, autoridad, agente opcional y una salida indicada. Empieza en `created`. | “Pagar esta factura” puede ser el objetivo; “cancelar o cambiar el acuerdo” puede ser la salida. |
| `runOperation` | Pregunta a la capacidad qué autoridad necesita, comprueba esa autoridad, ejecuta `perform` como máximo una vez por operación y luego pide a un verificador aparte que compruebe la evidencia. Devuelve estado, recibo y, solo si se verificó, el resultado. | Si vence el tiempo de espera de un pago, el resultado es `not_verified`; el kernel no lo repite a ciegas. |
| `pauseOperation` | Cambia a `paused` una operación que no esté corriendo ni haya terminado, solo si `who` aparece en `authority.pausers`. | Una persona autorizada puede pausar el trabajo antes de que vuelva a correr. |
| `resumeOperation` | Cambia una operación pausada a `created`, solo si la solicita una persona autorizada para pausar. | Después de reanudarla, el anfitrión puede volver a llamar `runOperation`. |
| `STATES` | Nombra los estados públicos: `needs_human_decision` espera a la puerta; `running` indica que `perform` está en curso; `verified` significa que el verificador confirmó el resultado; `failed` indica que la capacidad falló; `not_verified` significa que el efecto pudo ocurrir, pero no se confirmó; `blocked` indica que la capacidad declaró imposible la tarea; `paused` indica que una persona autorizada la detuvo. | Estos son los resultados y puntos de control de la operación. |
| `DEFAULT_EXIT` | Da la salida predeterminada: `return to the person: change the agreement or cancel`. La operación puede indicar otra `exit`. | Un rechazo puede señalar una decisión concreta en vez de dejar a la persona atascada. |
| `capability.required(operation)` | Declara el gasto necesario antes de empezar, como `{ spend: [{ asset, amount, to }] }`. También puede declarar `{ impossible: true, reason, exit }`. | Una tarea que no puede avanzar legítimamente puede devolver `blocked` con motivo y salida; no se llama a `perform`. |
| `capability.perform(context)` | Hace el efecto y devuelve un resultado como `{ ok, evidence, output }`. Un error lanzado es un fallo; un resultado incierto es `not_verified`. | Una capacidad de pago puede hacer el pago mientras el kernel desconoce el protocolo de pago. |

Si falta autoridad o no cubre lo pedido, `perform` no se ejecuta. La operación abre la puerta humana; sin aprobación devuelve `needs_human_decision`. Una capacidad que no declara ningún requisito de gasto se rechaza como inválida.

**Dónde mirar:** [`src/operation.js`](../src/operation.js), [`test/operation.test.js`](../test/operation.test.js), [`test/t1-adversarial.test.js`](../test/t1-adversarial.test.js).

## La puerta humana

La puerta se abre cuando la autoridad disponible no cubre el requisito y siempre que exista `authority.signers`. La solicitud muestra primero los requisitos y el costo, incluye la salida de la operación y establece `publicByDefault` en `false`. Los cuatro gestos descritos para esta puerta son: mostrar primero el costo; nunca dejar que el agente consienta por la persona; mantener la publicación opcional y apagada por defecto; nombrar la salida en cada rechazo. Describen cómo debe comportarse la puerta, no cuatro etiquetas de botones que el kernel proporcione.

El agente no puede consentir por la persona. Si la aprobación nombra al agente de la operación, o no nombra a una persona cuando se requiere, se rechaza. Para una autoridad de varias personas, cuentan solo identidades permitidas y distintas. Si se aprueba, el gasto declarado se convierte en autoridad con el destinatario solicitado; el recibo registra quién aprobó en `decidedBy`. Un rechazo devuelve `needs_human_decision`, registra `human_gate_rejected` y nombra la salida. Por ejemplo, si un destino de respaldo no está autorizado, la persona puede rechazarlo y el recibo puede indicar que se cambie el acuerdo o se cancele.

Un modelo opcional en `io.decide` puede adjuntar una sugerencia si su resultado supera el umbral de confianza configurado. Solo aconseja; todavía hace falta la aprobación identificada de la persona.

**Dónde mirar:** [`src/operation.js`](../src/operation.js), [`test/operation.test.js`](../test/operation.test.js), [`test/k2.test.js`](../test/k2.test.js), [`test/k2-hardening.test.js`](../test/k2-hardening.test.js).

## Recibos y anclajes públicos

| Nombre | Qué hace | Ejemplo o resultado |
|---|---|---|
| `buildReceipt` | Construye un recibo con operación, capacidad, autoridad otorgada y ejercida, resultado, evidencia, verificación, cobertura, omisiones y un digest SHA-256. Conserva solo campos de evidencia permitidos y valores simples acotados; descarta campos de evidencia desconocidos. | Un recibo de pago puede conservar el hash de transacción y el pagador, y descartar datos ajenos de la respuesta. |
| `verifyReceipt` | Recalcula el digest y comprueba que el cuerpo del recibo no haya cambiado desde que se selló, y que un anclaje distinto de pendiente esté ligado a ese digest. Demuestra integridad, no quién creó el recibo: alguien que pueda reescribirlo puede calcular otro digest. | Si se cambia el estado sin recalcular el digest, la verificación falla. |
| `coverage` y `notCovered` | Una comprobación aparece en `coverage` solo cuando su valor es exactamente `true`. Las falsas, ausentes o no verdaderas se nombran en `notCovered`; `external anchor` también aparece hasta que se confirme. | `exactAmount: true` queda cubierto; `recipient: false` no. |
| Estados del recibo | Los seis valores permitidos son `verified`, `not_verified`, `failed`, `blocked`, `paused` y `needs_human_decision`. | El recibo indica si el trabajo se confirmó, falló, es incierto, imposible, está pausado o espera a alguien. |
| `anchorReceipt` | Llama un adaptador síncrono de anclaje con el digest del recibo y luego un verificador con hash de transacción, digest y red. | Sin que un verificador confirme el registro de la red, un hash de transacción solo llega a `submitted`. |
| `anchorReceiptAsync` | Hace lo mismo con funciones asíncronas para el adaptador y el verificador. | Un cliente de red asíncrono puede enviar el digest y leerlo después para confirmarlo. |

El anclaje avanza de forma honesta: `pending` (no se envió nada), `submitted` (el adaptador devolvió un hash de transacción) y `anchored` (el verificador confirmó el digest en la red declarada). Un hash solo no es un anclaje. El verificador recibe `stellar:testnet` o `stellar:pubnet`; debe comprobar la red además del digest. El kernel no envía nada a una red.

**Dónde mirar:** [`src/receipt.js`](../src/receipt.js), [`test/evidence.test.js`](../test/evidence.test.js), [`test/k3.test.js`](../test/k3.test.js), [`test/k3-hardening.test.js`](../test/k3-hardening.test.js).

## Retomar mañana desde recibos

| Nombre | Qué hace | Ejemplo o resultado |
|---|---|---|
| `resumeFromReceipts(receipts, agreement, options)` | Comprueba los digests y devuelve `lastState`, `nextAction`, `needsPerson`, una razón, cuántos recibos descartó y el `workingMode` del acuerdo. | Si el primer paso aprobado quedó verificado y el siguiente no empezó, devuelve esa siguiente acción. |

Descarta los recibos cuya comprobación de integridad falla. Tampoco trata como prueba una afirmación `verified` si al recibo le falta `verification.verified === true` o si el anfitrión no puede probar el efecto: una acción local reversible necesita `verifyLocal`; un efecto externo necesita un recibo anclado y `verifyExternal`. Ignora trabajo desconocido o fuera del acuerdo para continuar automáticamente, y devuelve a la persona una acción verificada que no esté acordada. La siguiente acción también requiere a una persona si declara cualquier `changes` o si su último recibo quedó `blocked`, `paused` o `needs_human_decision`. Retomar la acción ya acordada no abre por sí solo la puerta humana. Un digest local válido no demuestra que un efecto externo haya ocurrido.

**Dónde mirar:** [`src/continuity.js`](../src/continuity.js), [`test/k4.test.js`](../test/k4.test.js), [`test/k4-hardening.test.js`](../test/k4-hardening.test.js), [`test/rc6-confianza.test.js`](../test/rc6-confianza.test.js).

## Delegar trabajo acotado y revisarlo

| Nombre | Qué hace | Ejemplo o resultado |
|---|---|---|
| `createDelegation` | Registra una tarea, delegado, coordinador y medio: carpeta de trabajo (`cwd`), material y rutas prohibidas. El delegado y el coordinador deben ser distintos. | Pedir a un ayudante que revise archivos de una carpeta del proyecto y prohibirle la carpeta de secretos. |
| `recordStart` | Registra si el delegado pudo leer el encargo. Si no, registra `failed_to_start` y recomienda volver a lanzarlo. | Si el anfitrión no abre el encargo, queda visible en vez de aparecer como trabajo terminado. |
| `recordResult` | Registra el digest del resultado del delegado, los archivos que dice haber tocado y una nota breve opcional. Las rutas fuera de `cwd` o bajo una ruta prohibida son infracciones; una infracción registrada permanece. | Una ruta tocada fuera de la carpeta acordada deja el trabajo `out_of_bounds`. |
| `reviewDelegation` | Permite que el coordinador ligado registre hallazgos, pida correcciones o acepte un resultado devuelto y dentro de límites. Una corrección lleva a `needs_correction`; aceptar lleva a `accepted`. | El revisor puede pedir una cita faltante antes de aceptar. |
| `integrateDelegation` | Devuelve un recibo sellado de la delegación solo cuando el estado es `accepted`. No fusiona archivos ni aplica código por sí mismo. | El trabajo no revisado no pasa este punto de integración. |
| `delegationReceipt` | Produce un registro con digest de la tarea, el medio, el delegado, las rutas declaradas, las infracciones, el digest del resultado, las correcciones y las notas breves. | El registro conserva lo reportado para revisarlo después. |
| `recordCard` | Registra una tarjeta breve interna para el coordinador de los mazos `eno` o `entre`. Las tarjetas marcadas como silenciosas se omiten del recibo y de la vista de la persona. | La nota breve del delegado es visible; la tarjeta silenciosa del coordinador queda privada en el estado de esta delegación. |
| `personView` | Devuelve la vista de la persona: estado, tarea, nombres del delegado y coordinador, digest del resultado, rutas tocadas, correcciones y notas breves. | La persona puede ver qué archivos dice haber tocado el delegado y si hay correcciones pendientes. |

La comprobación del medio observa las rutas que el delegado reporta como tocadas; no es un aislamiento que impida el acceso a archivos. El anfitrión sigue siendo responsable de controlar qué puede leer o cambiar el delegado. El módulo liga la identidad declarada del coordinador, pero no puede autenticar quién llama a la función; esa comprobación corresponde al anfitrión. `material` queda registrado, pero el código no lo usa para reducir el área permitida.

**Dónde mirar:** [`src/delegation.js`](../src/delegation.js), [`test/k7.test.js`](../test/k7.test.js), [`test/t1-adversarial.test.js`](../test/t1-adversarial.test.js).

## Blockchain, x402 y Stellar

x402 es un protocolo de pago para una solicitud web que pide pago antes de entregar el servicio solicitado. El kernel no implementa x402 ni habla con Stellar; `demo/x402/` contiene el adaptador de demostración que los conecta con una capacidad de Vespi.

| Nombre | Qué hace |
|---|---|
| `x402Capability(options)` | Crea la capacidad de demostración. Declara exactamente 0,01 USDC a un destinatario configurado en Stellar testnet, comprueba la oferta 402 del servidor y la transferencia Soroban preparada, y hace la solicitud pagada. |
| `verifyPreparedTransaction(transaction, expected)` | Comprueba el pago preparado antes de enviarlo, incluidos pagador, destinatario, monto, contrato, instrucción de transferencia y digest de autorización esperados. |
| `verifySettlement(evidence, options)` | Lee la transacción liquidada mediante el cliente Horizon provisto y comprueba que coincidan transacción, red, pagador, contrato, transferencia, destinatario y monto exacto. Sus comprobaciones booleanas con nombre alimentan `coverage`; todo lo que no sea verdadero aparece en `notCovered`. |

La demostración usa el facilitador x402 para verificar y liquidar el pago, y solo devuelve un plan de marketing cuando pasan esas comprobaciones. Rechaza redirecciones y el uso duplicado de una transacción dentro de su proceso actual. El adaptador de pagos vive fuera del kernel para que este no dependa de x402, Stellar, USDC, sus SDK ni la red.

El anclaje de recibos es otro límite de adaptador: `anchorReceipt` y `anchorReceiptAsync` reciben funciones de envío y verificación provistas por quien los llama. La evidencia del trabajo real en testnet, incluido el pago en vivo de 0,01 USDC, está en [`docs/TESTNET_EVIDENCE.md`](./TESTNET_EVIDENCE.md). El README declara los límites: testnet, un facilitador y un pagador; no se afirma soporte de mainnet.

**Dónde mirar:** [`demo/x402/README.md`](../demo/x402/README.md), [`demo/x402/capability.js`](../demo/x402/capability.js), [`demo/x402/settlement.js`](../demo/x402/settlement.js), [`demo/x402/verify.test.mjs`](../demo/x402/verify.test.mjs), [`docs/TESTNET_EVIDENCE.md`](./TESTNET_EVIDENCE.md), [`src/receipt.js`](../src/receipt.js).

## Una capacidad fuera del kernel: respaldo

`capabilities/respaldo/` copia una carpeta en otra, incluidos archivos binarios. Es incremental, escribe un manifiesto con huellas de los archivos, nunca borra archivos del destino y permite verificar, restaurar un archivo o carpeta y encontrar la copia más reciente por nombre parcial. Puede apuntar a una carpeta que Drive, Dropbox o OneDrive ya sincronice, pero no llama a esos servicios.

| Nombre | Qué hace |
|---|---|
| `respaldoCapability(options)` | Envuelve una copia de respaldo como capacidad del kernel. La autoridad debe nombrar la carpeta de destino. |
| `crearVerificador(options)` | Crea el verificador que recalcula las huellas del destino y las compara con el digest del manifiesto que declara la capacidad. |
| `respaldar(options)` | Copia los archivos nuevos o modificados y escribe el manifiesto. |
| `verificar(options)` | Recalcula las huellas e informa archivos íntegros, cambiados o faltantes, y si el manifiesto está íntegro. |
| `restaurar(options)` | Restaura un archivo o carpeta seleccionados solo después de comprobar su huella; no sobrescribe archivos existentes sin `sobrescribir: true`. |
| `dondeEsta(options)` | Busca en el manifiesto por nombre parcial y devuelve la copia coincidente más reciente, o indica que no hay ninguna. |

Todavía no cifra archivos, sube mediante las API de esos servicios, guarda versiones, controla cuotas de almacenamiento ni detecta si la sincronización está pausada o tiene conflictos. Las carpetas vacías se copian, pero no aparecen en el manifiesto para restaurarlas. Un archivo cuyo contenido cambie sin variar su tamaño o fecha puede pasar inadvertido por el atajo incremental; ejecuta `verificar` para recalcular las huellas del destino.

**Dónde mirar:** [`capabilities/respaldo/LEEME.md`](../capabilities/respaldo/LEEME.md), [`capabilities/respaldo/nucleo.js`](../capabilities/respaldo/nucleo.js), [`capabilities/respaldo/capability.js`](../capabilities/respaldo/capability.js), [`test/respaldo.test.js`](../test/respaldo.test.js).

## Qué puedes construir con esto

El README enumera estos proyectos funcionales y sus descripciones actuales. Son pruebas de concepto con datos ficticios, no afirmaciones de que estén listos para usuarios. El vínculo de abajo nombra una función del kernel solo cuando la descripción del README la respalda.

| Proyecto | Problema que aborda | Vínculo con el kernel que respalda el README |
|---|---|---|
| Queen | Una agencia de marketing de Stellar mantiene el gasto dentro del tope otorgado y usa una capa de pago x402 simulada. | Autoridad de gasto acotada; la descripción menciona explícitamente el tope. |
| Casa Firme | Un comité de vivienda decide quién tiene autoridad, y cada donación deja una huella. | La descripción no nombra una función específica del kernel. |
| Ficha Contigo | Una ficha clínica usa lo que autorizó el paciente; el acceso de emergencia se concede de antemano. | La descripción no nombra una función específica del kernel. |
| Cátedra | Una universidad declara el uso de IA, hace que el profesor firme las notas y emite títulos verificables. | La descripción no nombra una función específica del kernel. |
| Llavero | Una persona puede ver quién pide sus datos, para qué, bajo qué permiso y qué se rechazó. | La descripción menciona permiso y rechazo; no nombra una función de API. |
| Farolero | El trabajo de agentes se delega sin código; delegar solo puede reducir la autoridad y lo que se sale de sus límites vuelve bloqueado. | La descripción menciona la delegación explícitamente. |

El README también enumera Permamuseum, Escribano, Marea, Vela y TEMIS. Sus descripciones están allí; este catálogo no les asigna funciones del kernel más allá de lo que esas descripciones permiten afirmar.

**Dónde mirar:** [`README.md`, “Los proyectos funcionales”](../README.md#los-proyectos-funcionales), [`src/authority.js`](../src/authority.js), [`src/delegation.js`](../src/delegation.js).

## Lo que Vespi no hace

No hay runtime que mueva el trabajo entre anfitriones, planificador, demonio, motor de migración ni gestor de cuotas. El anfitrión debe despertar el proceso y guardar los recibos; un recibo no es durable por sí solo. El kernel no habla con ninguna red. x402 solo está demostrado en testnet, con un facilitador y un pagador. No se afirma soporte de mainnet, preparación para producción, cumplimiento regulatorio ni un protocolo estable. Un digest no demuestra quién escribió el recibo, y un anclaje solo cuenta después de que un verificador confirma el digest y la red.

**Dónde mirar:** [`README.md`, “Lo que todavía no hace, y lo que no está verificado”](../README.md#lo-que-todavía-no-hace-y-lo-que-no-está-verificado), [`docs/VERIFICATION.md`](./VERIFICATION.md), [`src/receipt.js`](../src/receipt.js).
