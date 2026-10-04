# v0.1.4

> **Published as [`v0.1.4-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.4-kernel) on 2026-10-05.** The previous release is [`v0.1.3-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.3-kernel).

## Vespi in one line

**The simplest way to say it.** Building with AI should not require being an AI expert. Vespi does the hard parts: cycles until the work is done, test-first development, blind readers, and verification by someone other than the person who did the work. The person does not need to know how those methods work.

## What changed in 0.1.4

- **Uncertain effects return to a person.** After an exercised `not_verified` receipt, or a `failed` receipt with `settlementUnknown`, `resumeFromReceipts` returns `needsPerson: true` and `reconciliation_required`. Only a later `verified` receipt closes that uncertainty.
- **The effect gets a stable key.** `perform` receives a SHA-256 `idempotencyKey` derived from the canonical goal, action and requirements. It stays stable across attempts and resumes. It excludes time, operation ids and renewable permission metadata. The destination still has to honor the key for external deduplication.
- **Delegation deadlines are consultative.** `deadlineMs` and `delegationStatus(d, now)` report `{ overdue, dueAt }` when queried. They do not schedule work or act on a delegation.
- **Actions can have an attempt limit.** `maxAttempts` is per action in the agreement. Duplicate receipts count once. When the limit is reached, the result is `needsPerson: true` with `attempts_exhausted`.
- **The operation clock can be supplied.** `io.now` is used when checking permission validity and issuing receipts.
- **Compatibility is preserved.** No public export was removed or renamed. A receipt built without the new clock keeps its previous digest.

## What was tested, and what was not

| Claim | Result | Scope |
|---|---|---|
| `node --test test/*.test.js` on this release prep | **277/277 passed**, exit 0 | Includes the existing tests and the 0.1.4 tests. |
| Independent verification | **Six independent passes**; every defect they reproduced was corrected with a red-first test | The first pass found 8 defects; later passes found more in time handling, signals of unknown shape and asynchronous clocks. The last pass found no new high-severity defect once the delegation clock was fixed. |
| Publication | **Published on 2026-10-05 as `v0.1.4-kernel`** | The runbook creates the annotated tag and release after the final checks. |
| External behavior | Not tested here | No network test or benchmark is claimed for this release cut. |

The tests were written first and observed failing. A worker model implemented the changes. A separate model reviewed them and found eight real defects, including colliding keys, a signal lost while constructing a receipt, and an older receipt hiding later uncertainty. Those findings were corrected with red-first tests. Five more independent passes followed, each reproducing remaining defects with scripts, until the last one had nothing new of high severity. Known limits: the kernel trusts the injected clock and it must be synchronous; and a receipt whose `exercised` entry has an unknown shape now carries an `exercisedUnknown` signal, so its digest differs from the older format. Digest compatibility holds for valid entries.

## Security and verification

A receipt records what the kernel was told about an authority. That record is data, not proof of who said it. The receipt digest can show that its contents have not changed since it was computed. It does not authenticate the speaker. The independent review found concrete defects and improved the code, but it is not a completed security audit.

## What remains open

Lightweight receipt chaining with `prev`, intent recorded before an effect, accumulated budgets across operations, `narrow(parent, child)`, and a resume epoch are not included. Leases, a scheduler and a project-owned Merkle log are not recommended for this cut.

---

# v0.1.4

> **Publicado como [`v0.1.4-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.4-kernel) el 2026-10-05.** La versión anterior es [`v0.1.3-kernel`](https://github.com/andresanemic/vespi/releases/tag/v0.1.3-kernel).

## Vespi en una línea

**Lo más simple.** Construir con IA no debería exigir ser experto en IA. Vespi hace lo difícil: ciclos hasta terminar el trabajo, desarrollo con la prueba primero, lectores ciegos y verificación por alguien distinto de quien hizo el trabajo. La persona no tiene que saber cómo funcionan esos métodos.

## Qué cambió en 0.1.4

- **Los efectos inciertos vuelven a una persona.** Después de un recibo `not_verified` con gasto ejercido, o de un recibo `failed` con `settlementUnknown`, `resumeFromReceipts` devuelve `needsPerson: true` y `reconciliation_required`. Solo un recibo `verified` posterior cierra esa incertidumbre.
- **El efecto recibe una clave estable.** `perform` recibe un `idempotencyKey` SHA-256 derivado del objetivo, la acción y los requisitos canónicos. Se mantiene entre intentos y reanudaciones. Excluye la hora, los ids de operación y los metadatos renovables del permiso. El destino todavía debe respetar la clave para deduplicar efectos externos.
- **Los plazos de delegación son consultivos.** `deadlineMs` y `delegationStatus(d, now)` informan `{ overdue, dueAt }` al consultarlos. No programan trabajo ni actúan sobre una delegación.
- **Las acciones pueden tener un tope de intentos.** `maxAttempts` se define por acción en el acuerdo. Los recibos duplicados cuentan una sola vez. Al alcanzar el límite, el resultado es `needsPerson: true` con `attempts_exhausted`.
- **Se puede suministrar el reloj de la operación.** `io.now` se consulta al comprobar la vigencia del permiso y al emitir recibos.
- **Se conserva la compatibilidad.** No se quitó ni renombró ninguna exportación pública. Un recibo creado sin el nuevo reloj conserva su digest anterior.

## Qué se probó y qué no

| Afirmación | Resultado | Alcance |
|---|---|---|
| `node --test test/*.test.js` en esta preparación de versión | **277/277 aprobadas**, código de salida 0 | Incluye las pruebas existentes y las de 0.1.4. |
| Verificación independiente | **Seis pasadas independientes**; cada defecto que reprodujeron se corrigió con una prueba escrita antes | La primera encontró 8 defectos; las siguientes hallaron más en el manejo del tiempo, en señales de forma desconocida y en relojes asíncronos. La última no halló nada nuevo de gravedad alta una vez corregido el reloj de la delegación. |
| Publicación | **Publicado el 2026-10-05 como `v0.1.4-kernel`** | El runbook crea la etiqueta anotada y la publicación después de las comprobaciones finales. |
| Comportamiento externo | No probado aquí | Esta versión no reclama pruebas de red ni benchmarks. |

Las pruebas se escribieron primero y se observó que fallaban. Un modelo trabajador implementó los cambios. Otro modelo hizo una revisión separada y encontró ocho defectos reales, entre ellos claves que colisionaban, una señal que se perdía al construir el recibo y un recibo antiguo que ocultaba incertidumbre posterior. Esos hallazgos se corrigieron con pruebas primero en rojo. Siguieron cinco pasadas independientes más, cada una con defectos reproducidos con scripts, hasta que la última no halló nada nuevo de gravedad alta. Límites conocidos: el kernel confía en el reloj inyectado y este debe ser síncrono; y un recibo cuya entrada de `exercised` tiene una forma desconocida ahora lleva la señal `exercisedUnknown`, así que su digest difiere del formato anterior. La compatibilidad de digest vale para entradas válidas.

## Seguridad y verificación

Un recibo registra lo que el kernel recibió como dato sobre una autoridad. Ese registro es un dato, no una prueba de quién lo dijo. El digest puede mostrar que el contenido no cambió desde que se calculó. No autentica a quien habla. La revisión independiente encontró defectos concretos y mejoró el código, pero no equivale a una auditoría de seguridad terminada.

## Lo que sigue abierto

No se incluyen el encadenamiento ligero de recibos con `prev`, la intención registrada antes del efecto, los presupuestos acumulados entre operaciones, `narrow(padre, hijo)`, ni una época de reanudación. No se recomiendan leases, un planificador ni un log de Merkle propio para este corte.
