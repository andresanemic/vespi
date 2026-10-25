# Vespi kernel 0.1.8 — Keep the agreement when work resumes

An approval now carries its checked context into the operation and receipt. Before an effect, the kernel checks that context again: changed scope or unreadable context returns control to the host instead of silently continuing under an old approval. Checkpoint and continuation handling retain bounded authority across a host-managed resume.

Callback receivers vary by port; consult the [callback contract](./HOST_CALLBACKS.md) and do not rely on a receiver. `runOperation` and x402 reject non-native thenables without subscribing to them; host-provided functions in emergency and delegation may return thenables, which the kernel subscribes to. `attenuates` rejects an authority with too many grants to verify within its fixed work budget; `MAX_ATTENUATION_WORK` is 1,000,000 units. Two limits stay declared: a checkpoint's generation does not order two checkpoints by itself when the authority already covers the spend, so the host must consume each checkpoint atomically and enforce its own minimum generation (`minGeneration` does not tell such checkpoints apart); and the context is re-read once just before `perform`, so in x402 it can change while `prepare` runs.

## Evidence and adoption

The [frozen source suite](./SUITE_RESULT_0.1.8.txt) records 1,319 passing tests, zero failures, zero skipped tests and zero TODOs on Node24. These are local tests with fixtures and installed SDK dependencies. They do not establish the authenticity of a host clock, context, verifier or checkpoint store. A digest checks integrity, not authorship; the host must enforce its minimum accepted checkpoint generation. Revocation is cooperative and does not terminate arbitrary host code. Promise subclasses with custom `Symbol.species` remain outside the exercised compatibility coverage.

The source package includes the callback migration contract. Lore Plugin adopts a fixed source commit in its own release; other consumers retain their existing pins until they choose to migrate. Previous release notes and tags remain unchanged.

---

## Conservar el acuerdo al retomar

La aprobación conserva el contexto comprobado en la operación y en el recibo. Antes de un efecto, el kernel vuelve a comprobarlo: un alcance cambiado o un contexto ilegible devuelve el control al host. Los checkpoints y las continuaciones conservan autoridad acotada al reanudar mediante el host.

El receptor depende del puerto; consulta el [contrato de callbacks](./HOST_CALLBACKS.md) y no bases el contrato del host en `this`. `runOperation` y x402 rechazan thenables no nativos sin suscribirse; las funciones que entrega el host en emergency y delegation pueden devolver thenables, a los que el kernel se suscribe. `attenuates` rechaza una autoridad con demasiadas concesiones para comprobarla dentro de un presupuesto fijo; `MAX_ATTENUATION_WORK` es de 1.000.000 unidades. Quedan dos límites declarados: la generación de un checkpoint no ordena por sí sola dos checkpoints cuando la autoridad ya cubre el gasto, así que el host debe consumir cada checkpoint de forma atómica y aplicar su propia generación mínima (`minGeneration` no distingue esos checkpoints); y el contexto se relee una vez justo antes de `perform`, por lo que en x402 puede cambiar mientras corre `prepare`. La suite congelada registra 1.319 pruebas aprobadas, sin fallos, omitidas ni TODO en Node24. Son pruebas locales con fixtures y dependencias del SDK instaladas; no establecen la autenticidad del reloj, el contexto, el verificador ni el almacén de checkpoints del host. Un digest comprueba integridad, no autoría; el host debe aplicar la generación mínima aceptada de sus checkpoints. La revocación es cooperativa y no termina código arbitrario del host. No se afirma compatibilidad ejercida con subclases de Promise que cambien `Symbol.species`.

Lore Plugin adopta un commit fijo en su propia release; los demás consumidores conservan sus pins hasta decidir su migración.
