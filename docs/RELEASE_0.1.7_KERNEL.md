# Vespi Kernel 0.1.7

## Continue with the same approval, reconcile uncertain effects

This release keeps the network and resource of a scoped payment approval attached to the operation and its receipt. If a payment stops before send, the memory store lets the same operation retry after renewed approval; once send was called, uncertainty keeps its reservation for reconciliation. Delivered JSON must now match the digest on its receipt.

It also records a rejected valid skill request and provenance verification time, rejects resolver text whose UTF-8 encoding loses information, and contains unreadable nested receipt context as a failed receipt. x402 receipts include the internally computed effect-key hash and version; the public rejection-code catalog is frozen. Effect keys retain their version-2 format.

## Evidence

- Kernel: **1,218 passed, 0 failed, 0 TODO, 0 skipped**. [Frozen suite result](./SUITE_RESULT_0.1.7.txt).
- x402 demo: **86 passed**, using the Stellar SDK with local fixtures; no live payment.
- Twelve pending tests were activated and fixed or strengthened; twelve obsolete or out-of-contract expectations were retired; six regressions were added. [Disposition and reasons](./TODO_RESOLUTION.md).
- A separate Sol review found grant scope dropped by operation construction and a hidden serialization hook; both were reproduced, fixed and rechecked. This is our own model review, not an external security audit. [Threat model](./THREAT_MODEL.md).

## Adoption and limits

**This is not a test-only release.** Existing receipts still verify, but newly built provenance/x402 receipts have additional sealed fields and different digests. Consumers that pin exact result/receipt keys must adapt before adopting it. JSON delivery validators must report SHA-256 of `JSON.stringify(output)`; mismatched hashes, nested accessors/proxies, sparse arrays, hidden fields and serialization hooks are refused. Without output, the digest remains the validator's report.

Explicit grant network/resource constraints are enforced and preserved by operation construction and the human gate. Legacy grants without those fields keep their generic scope. The system clock supplies provenance verification time; it is not authenticated time. Publishing an effect-key hash permits receipt correlation, but does not disclose signed authorization or the private provider hint.

Custom claims stores may offer synchronous `releaseEffect` only with reservations that do not expire or get reassigned during a run; lease-based stores need owner-bound release and are outside this contract. Memory claims remain process-local. No new mainnet, durability, autonomous runtime or production-security claim is made.

**Lore Plugin and all functional projects retain their existing kernel pins.** This release does not vendor or repin any of them. The published 0.1.6 tag remains intact.

---

## Retomar con la misma aprobación, reconciliar efectos inciertos

Esta release conserva la red y el recurso de una aprobación de pago acotada en la operación y su recibo. Si un pago se detiene antes de enviar, el almacén en memoria permite reintentar la misma operación tras renovar la aprobación; una vez llamado el envío, la incertidumbre conserva la reserva para reconciliar. El JSON entregado debe coincidir con el digest de su recibo.

También registra una solicitud válida de skill rechazada y el instante de verificación de procedencia, rechaza texto del resolver cuya codificación UTF-8 pierde información y contiene contexto anidado ilegible con un recibo fallido. Los recibos x402 incluyen el hash y versión de la clave de efecto calculada dentro del kernel; el catálogo público de códigos queda congelado. Las claves conservan el formato de versión 2.

## Evidencia

- Kernel: **1.218 pasan, 0 fallos, 0 TODO, 0 omitidas**. [Resultado congelado](./SUITE_RESULT_0.1.7.txt).
- Demo x402: **86 pasan**, con SDK de Stellar y fixtures locales; sin pago vivo.
- Doce pruebas pendientes se activaron y corrigieron o reforzaron; doce expectativas obsoletas o fuera del contrato se retiraron; seis regresiones se agregaron. [Resolución y motivos](./TODO_RESOLUTION.md).
- Una revisión separada Sol encontró pérdida de alcance al construir operaciones y un hook oculto de serialización; ambos se reprodujeron, corrigieron y re-verificaron. Es revisión propia con modelos, no auditoría externa. [Modelo de amenazas](./THREAT_MODEL.md#modelo-de-amenazas).

## Adopción y límites

**No es una release solo de tests.** Los recibos existentes siguen verificando; los nuevos de procedencia/x402 tienen campos sellados adicionales y otros digests. Quien fija las claves exactas de resultados/recibos debe adaptarse antes de adoptar. Los validadores JSON deben reportar SHA-256 de `JSON.stringify(output)`; se rechazan hashes ajenos, accessors/proxies anidados, arrays con huecos, campos ocultos y hooks de serialización. Sin output, el digest sigue siendo reporte del validador.

Se conservan y exigen los alcances explícitos de red/recurso al crear operaciones y aprobar en la puerta humana. Los grants antiguos sin esos campos mantienen su alcance genérico. La hora de verificación viene del reloj del proceso, sin autenticar tiempo externo. Publicar el hash de la clave permite relacionar recibos, sin divulgar autorización firmada ni hint privado del proveedor.

Los almacenes externos pueden ofrecer `releaseEffect` síncrono únicamente con reservas que no expiren ni se reasignen durante el run; los almacenes con leases necesitan liberación ligada al propietario y quedan fuera del contrato. Los claims en memoria siguen ligados al proceso. No se afirma nueva capacidad mainnet, durabilidad, runtime autónomo ni seguridad de producción.

**Lore Plugin y los proyectos funcionales conservan sus pins existentes.** Esta release no vendoriza ni cambia sus versiones de kernel. El tag publicado de 0.1.6 permanece intacto.
