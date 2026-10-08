# v0.1.5-kernel

> Published on 2026-10-08 as `v0.1.5-kernel`. The tag records the released kernel; reading or running this source does not change an installed Lore Plugin copy.

## What changes for the person

If an operation stops before its anchor is confirmed, the pending receipt keeps the selected network so the next resume can see what was chosen. `buildReceipt({ anchorNetwork })` lets the host choose `stellar:testnet` or `stellar:pubnet`; the default remains `stellar:testnet`. A value outside those two networks throws. The selected network stays outside the receipt body digest, and naming it does not submit anything to a network. Regression tests pin the previous default digest and verify the selected network remains pending if an adapter does not confirm an anchor.

This cut also contains an opt-in x402 reference bridge under [`demo/x402/`](../demo/x402/), selected only with `--bridge=1`. It admits one payer authorization for its declared Stellar transfer, checks the signed authorization against the declared effect, and reads settlement with bounded, cancellable Horizon requests. A resolved but malformed Horizon response returns a closed settlement failure rather than leaking a raw exception. The bridge is an example integration; it does not alter the kernel's host-supplied payment ports or make a payment for the host.

## What the evidence covers

- Kernel suite: `node --test test/*.test.js` — 1,220 tests, 1,196 passed, 0 failed, 24 declared `todo`, 0 skipped. The exact candidate run is recorded in [`SUITE_RESULT_0.1.5.txt`](./SUITE_RESULT_0.1.5.txt), including the Node version and Git baseline. The TODO cases remain visible and are not counted as passing tests. The two new tests cover F5e (a resolved-but-malformed Horizon response, e.g. `null`, returns a closed `failure` rather than leaking a raw `TypeError`).
- x402 demo suite: `npm test -- --test-reporter=tap` from `demo/x402/` — 86 passed, 0 failed, 0 TODO, 0 skipped. Fixtures bind network calls to loopback and exercise real Stellar SDK objects; they do not send a payment to testnet.
- Benchmark harness: `node --test --test-reporter=tap bench/unidad-operacion.test.mjs` — 3 setup and adjudication-shape checks passed. The four assignments and eight criteria are a fixture, not an observed comparative result; no benchmark adjudication is claimed.
- Saved testnet evidence: `node scripts/verify-testnet-evidence.mjs --offline` confirms 50 unique transaction hashes and valid file shape. It does not recheck network state or compare transaction facts. The saved payments belong to the historical adapter, not this reference bridge.

The bridge reviews recorded in [`REVISION-fludge-r1.md`](./x402-recorte/REVISION-fludge-r1.md) and [`REVISION-fludge-r2.md`](./x402-recorte/REVISION-fludge-r2.md) found and drove fixes for authorization replay, reserved authorizations, cancellation and error handling. R2 then identified the resolved-malformed-response case; this candidate adds regression F5e and contains it in the closed result vocabulary. Those reviews are prior model reviews, not an external security audit, and they did not review the final 0.1.5 candidate after F5e. The kernel suite's 24 declared TODO cases remain as listed by their tests.

## What remains outside this cut

There is no live payment evidence for the reference bridge, no mainnet evidence, durable cross-process claims store, refund flow, shared money budget, second payment provider, autonomous cross-host runtime or production-readiness claim. The benchmark harness has no comparative findings. Host identity, receipt storage, execution and wake-up remain host responsibilities. Kernel operation semantics are supported by local tests; autonomous operation remains untested. The Final Vespi Gate remains `READY_FOR_MUSE_DISCOVERY` and `NOT_READY_FOR_IMPLEMENTATION`. A real `security-review` before freeze remains pending, as recorded in the prior cut's release note.

# v0.1.5-kernel — español

> Publicado el 2026-10-08 como `v0.1.5-kernel`. El tag registra el kernel publicado; leer o ejecutar este código no cambia una copia instalada de Lore Plugin.

## Qué cambia para la persona

Si la operación se detiene antes de confirmar el ancla, el recibo pendiente conserva la red elegida para que la próxima reanudación pueda ver qué se seleccionó. `buildReceipt({ anchorNetwork })` permite que el host elija `stellar:testnet` o `stellar:pubnet`; el valor por defecto sigue siendo `stellar:testnet`. Cualquier otro valor produce un error. La red elegida sigue fuera del digest del cuerpo del recibo, y nombrarla no envía nada a una red. Las regresiones fijan el digest del valor por defecto anterior y comprueban que la red elegida permanece pendiente si un adaptador no confirma el ancla.

Este corte también contiene un puente de referencia x402 opt-in en [`demo/x402/`](../demo/x402/), que se selecciona solo con `--bridge=1`. Admite una autorización del pagador para la transferencia Stellar declarada, coteja la autorización firmada con ese efecto y lee la liquidación mediante solicitudes Horizon acotadas y cancelables. Una respuesta Horizon resuelta pero malformada produce un fallo de liquidación con vocabulario cerrado; no filtra una excepción cruda. El puente es una integración de ejemplo; no modifica los puertos de pago que aporta el host ni paga por él.

## Qué cubre la evidencia

- Suite del kernel: `node --test test/*.test.js` — 1.220 pruebas, 1.196 aprobadas, 0 fallidas, 24 `todo` declaradas y 0 omitidas. La corrida exacta de esta candidata está en [`SUITE_RESULT_0.1.5.txt`](./SUITE_RESULT_0.1.5.txt), con la versión de Node y la base Git. Los casos `todo` siguen visibles y no cuentan como aprobados. Las dos pruebas nuevas cubren F5e (una respuesta Horizon resuelta pero malformada, p. ej. `null`, produce un `failure` con vocabulario cerrado; no filtra un `TypeError` crudo).
- Suite del demo x402: `npm test -- --test-reporter=tap` desde `demo/x402/` — 86 aprobadas, 0 fallidas, 0 `todo` y 0 omitidas. Los fixtures limitan las llamadas de red a loopback y ejercitan objetos reales del SDK Stellar; no envían un pago a testnet.
- Arnés de benchmark: `node --test --test-reporter=tap bench/unidad-operacion.test.mjs` — aprobaron 3 comprobaciones de estructura del fixture y adjudicación. Los cuatro encargos y ocho criterios son un fixture, no un resultado comparativo observado; no se afirma una adjudicación de benchmark.
- Evidencia guardada de testnet: `node scripts/verify-testnet-evidence.mjs --offline` confirma 50 hashes de transacción únicos y la forma válida del archivo. No vuelve a consultar la red ni coteja hechos de transacciones. Los pagos guardados pertenecen al adaptador histórico, no a este puente de referencia.

Las revisiones del puente registradas en [`REVISION-fludge-r1.md`](./x402-recorte/REVISION-fludge-r1.md) y [`REVISION-fludge-r2.md`](./x402-recorte/REVISION-fludge-r2.md) encontraron y guiaron arreglos para reenvío de autorizaciones, reservas, cancelación y manejo de errores. Después R2 identificó la respuesta resuelta pero malformada; esta candidata añade la regresión F5e y la encierra en el vocabulario cerrado de resultados. Son revisiones previas hechas por modelos, no una auditoría externa de seguridad, y no revisaron la candidata 0.1.5 final después de F5e. Los 24 casos `todo` declarados por la suite del kernel se mantienen según sus pruebas.

## Qué queda fuera de este corte

No hay evidencia de un pago vivo con el puente de referencia, evidencia de mainnet, almacén durable de claims entre procesos, flujo de reembolsos, presupuesto monetario compartido, segundo proveedor de pagos, runtime autónomo entre hosts ni afirmación de preparación para producción. El arnés de benchmark no tiene hallazgos comparativos. La identidad del host, el almacenamiento de recibos, la ejecución y el despertar siguen a cargo del host. La semántica de operación del kernel está respaldada por pruebas locales; la operación autónoma sigue sin probarse. El Final Vespi Gate permanece `READY_FOR_MUSE_DISCOVERY` y `NOT_READY_FOR_IMPLEMENTATION`. Sigue pendiente un `security-review` real antes de congelar, como ya registraba la nota del corte anterior.
