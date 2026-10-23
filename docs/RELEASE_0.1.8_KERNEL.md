# Vespi kernel 0.1.8 — Keep the agreement when work resumes

An approval now carries its checked context into the operation and receipt. Before an effect, the kernel checks that context again: changed scope or unreadable context returns control to the host instead of silently continuing under an old approval. Checkpoint and continuation handling retain bounded authority across a host-managed resume.

Callback receivers vary by port; consult the [callback contract](./HOST_CALLBACKS.md) and do not rely on a receiver. `runOperation` and x402 reject non-native thenables without subscribing to them; emergency `authorizeGrantor` and `authenticate` may read and subscribe to a thenable's `then` property.

## Evidence and adoption

The [frozen source suite](./SUITE_RESULT_0.1.8.txt) records 1,310 passing tests, zero failures, zero skipped tests and zero TODOs on Node24. These are local tests with fixtures and installed SDK dependencies. They do not establish the authenticity of a host clock, context, verifier or checkpoint store. A digest checks integrity, not authorship; the host must enforce its minimum accepted checkpoint generation. Revocation is cooperative and does not terminate arbitrary host code. Promise subclasses with custom `Symbol.species` remain outside the exercised compatibility coverage.

The source package includes the callback migration contract. Lore Plugin adopts a fixed source commit in its own release; other consumers retain their existing pins until they choose to migrate. Previous release notes and tags remain unchanged.

---

## Conservar el acuerdo al retomar

La aprobación conserva el contexto comprobado en la operación y en el recibo. Antes de un efecto, el kernel vuelve a comprobarlo: un alcance cambiado o un contexto ilegible devuelve el control al host. Los checkpoints y las continuaciones conservan autoridad acotada al reanudar mediante el host.

El receptor depende del puerto; consulta el [contrato de callbacks](./HOST_CALLBACKS.md) y no bases el contrato del host en `this`. `runOperation` y x402 rechazan thenables no nativos sin suscribirse; `authorizeGrantor` y `authenticate` de emergency pueden leer y suscribirse a la propiedad `then` de un thenable. La suite congelada registra 1.310 pruebas aprobadas, sin fallos, omitidas ni TODO. Son pruebas locales; el host conserva la responsabilidad de autenticar y almacenar sus checkpoints, fijar la generación mínima aceptada y aportar reloj, contexto y verificación fieles. La revocación requiere cooperación de sus puertos. No se afirma compatibilidad ejercida con subclases de Promise que cambien `Symbol.species`.

Lore Plugin adopta un commit fijo en su propia release; los demás consumidores conservan sus pins hasta decidir su migración.
