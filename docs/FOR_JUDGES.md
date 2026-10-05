# Judge Vespi

Vespi keeps the authority you granted, the checked result and the next agreed action together when work changes hands. An uncertain exercised effect returns to you for reconciliation, as [continuation tests](../test/v014.test.js) verify, but the host must store receipts and run the next action. Kernel `0.1.4`: candidate cut, publication date pending.

## Run the local evidence

From the repository root, with Node.js available, run:

```sh
node examples/walkthrough.js
node --test "test/*.test.js"
node scripts/verify-testnet-evidence.mjs --offline
```

Answer the walkthrough's terminal prompt with `Ada: approve`. Inspect the receipt's `status`, `coverage` and `notCovered`, then the next action selected by another process. [The walkthrough test](../test/walkthrough.test.js) checks a local observed effect, but the receipt is passed explicitly to that process; this does not establish automatic transfer, durable storage or authenticated human identity. [The bilingual walkthrough](./WALKTHROUGH.md) explains the source and transcript.

The [saved suite result](./SUITE_RESULT.txt) records the command and exact counts for this cut. The last command checks only shape and uniqueness of hashes, without comparing transaction facts or accessing a network. [The evidence guide](./TESTNET_EVIDENCE.md#recheck-the-saved-responses) gives the command for comparing saved responses with local expectations and an optional Horizon refresh. The saved comparison yields 50 readbacks, 5 semantically verified cases, 45 partially verified cases and 0 discrepancies; the expected facts come from local execution records, not Horizon.

To create a manifest for the exact checkout you are judging, run:

```sh
node scripts/judge-package.mjs
```

This runs the kernel suite, hashes files under `src`, `docs`, `demo` and `scripts`, and writes [JUDGE_PACKAGE.json](./JUDGE_PACKAGE.json), without a network; root README and CHANGELOG, tests and examples are outside that hash inventory. Check `packageVersion`, `gitCommit`, `tests` and `fileHashes` against your checkout. A saved manifest may belong to an earlier cut; regenerate it after the final version and files are fixed. Its project status strings come from an earlier static index, which omits Permamuseum and still mentions code and tests; those strings do not establish current access. Use the README schedule below. The manifest does not fetch projects, and its test counts omit the `todo` breakdown reported above.

## What entered from the 0.1.3 promise

The [0.1.3 note](./RELEASE_0.1.3_KERNEL.md) announced emergency access, zero knowledge, skill provenance and x402 in the kernel. [The bilingual 0.1.4 note](./RELEASE_0.1.4_KERNEL.md) records what entered and each independent review condition. [Emergency regressions](../test/k1-emergencia-r6-advisor.test.js) cover prior authority exercised by the grantee's opaque host-issued principal and reviews refused to the executor, but real identity, trusted time, storage, execution and effect verification remain the host's; D4 counts uses, not money. [Provenance regressions](../test/k2-procedencia-r5-advisor.test.js) cover the resolver's own evidence, without sending declared `author` or `contentDigest`, and hostile prototype data, but not same-process code replacing built-in functions after loading; `provenanceSource` distinguishes `verified` from `declared`, while the name stays declared.

[x402 regressions](../test/k4-x402-r3-advisor.test.js) cover an injected-port paid-effect contract with mandatory synchronous `claims` and operation identity in the effect key, but no durable claims store, reservation release or refunds. The validator declares the output digest; the kernel does not recompute it or inspect nested output values. The [reference bridge](../demo/x402/ports.js) has [SDK loopback tests](../demo/x402/bridge.test.mjs) reported by its builder, but no final independent review, verified live payment or exercised real Soroban RPC payload path. [The minimal example](../examples/x402-app.js) uses simulated ports:

```sh
node examples/x402-app.js
```

The example belongs to the kernel suite. SDK tests are a separate demo suite requiring the dependencies in [demo/x402/package.json](../demo/x402/package.json); they are outside the kernel count above.

[ZK port tests](../test/k3b-zk-port.test.js) cover a pinned key and agreed public inputs, but trust an injected cryptographic backend. The internal [BN254 Groth16 reference](../src/zk-bn254-reference.js) has [reference tests](../test/k3d-zk-groth16.test.js), but is not a public API, is unaudited and is not production ready. Proofs are malleable, a degenerate key accepts forgeries and a Promise timeout cannot interrupt synchronous CPU verification. These tests do not demonstrate integration with Casa Firme or Vela.

D3 stamps `stellar:testnet` in a newly built pending anchor, as [receipt.js](../src/receipt.js) shows, but does not affect the digest or prove a network submission; it becomes configurable in 0.1.5. D5 keeps Vela's sealed content plaintext in the demonstration according to the owner; a real deployment requires encryption at rest and third-party key custody.

## Historical evidence and project access

Inspect [the saved x402 receipt](../demo/x402/receipts/live-testnet-2026-10-02.json): `status: "verified"`, `verification.verified: true`, `notCovered: ["external anchor"]` and `anchor.status: "pending"`. Its [transaction readback](./testnet-evidence.json) matches the declared payment, but belongs to the historical adapter and does not validate the new bridge. The first historical payment's receipt remains `not_verified` even though its later readback matches the declared facts. Everything here is Stellar testnet, with fictional data and no real money.

The [functional-project repositories](../README.md#the-functional-projects) remain public and today contain README files only, according to the owner's schedule. Code is scheduled to enter the main branch by a push on 12 October 2026 at 20:29 Chile time and to leave it by another push on 16 October 2026 at 19:31. The margin is 30 minutes around deliberation, from 12 October at 20:59 to 16 October at 19:01. Removal by a new commit does not erase code from Git history, and an obtained copy cannot be withdrawn. This is an owner's commitment, not evidence that a future push happened. Project suites cannot be reproduced from README-only repositories today.

## Qué NO trae el 0.1.4 y pasa al 0.1.5

Spend-authority narrowing stays out because the base `grantSpend` constructor has an inherited-setter defect. [The release note](./RELEASE_0.1.4_KERNEL.md#what-014-does-not-bring-and-moves-to-015) gives each reason for x402 HX-09, HX-11, HX-12, HX-13, R2-05 and H11; provenance N07, N08, H12d and H13d; emergency H21; and withdrawn bridge cases R2-11 and R2-12. Other `todo` cases declare contract boundaries without promising future fixes. No autonomous cross-host runtime, scheduler, mainnet evidence, second payment provider, external security audit, regulatory certification or production readiness is demonstrated.

---

# Revisar Vespi

Vespi conserva juntas la autoridad que otorgaste, el resultado comprobado y la siguiente acción acordada cuando el trabajo cambia de manos. Un efecto ejercido incierto vuelve a ti para reconciliarlo, como verifican [las pruebas de continuidad](../test/v014.test.js), pero el host debe guardar los recibos y ejecutar la siguiente acción. Kernel `0.1.4`: corte candidato, fecha de publicación pendiente.

## Corre la evidencia local

Desde la raíz del repositorio, con Node.js disponible, ejecuta:

```sh
node examples/walkthrough.js
node --test "test/*.test.js"
node scripts/verify-testnet-evidence.mjs --offline
```

Responde al terminal con `Ada: approve`. Revisa `status`, `coverage` y `notCovered` del recibo, y la siguiente acción seleccionada por otro proceso. [La prueba del recorrido](../test/walkthrough.test.js) comprueba un efecto local observado, pero el recibo se pasa explícitamente a ese proceso; no demuestra transporte automático, almacenamiento durable ni identidad humana autenticada. [El recorrido bilingüe](./WALKTHROUGH.md) explica el código y la transcripción.

El [resultado guardado de la suite](./SUITE_RESULT.txt) registra el comando y los conteos exactos de este corte. El último comando solo comprueba forma y unicidad de hashes, sin comparar hechos ni acceder a la red. [La guía de evidencia](./TESTNET_EVIDENCE.md#comparar-las-respuestas-guardadas) contiene el comando para comparar respuestas guardadas con expectativas locales y una consulta opcional a Horizon. La comparación guardada da 50 lecturas, 5 casos verificados semánticamente, 45 parcialmente verificados y 0 discrepancias; los hechos esperados vienen de registros locales de ejecución, no de Horizon.

Para crear un manifiesto de la copia exacta que revisas, ejecuta:

```sh
node scripts/judge-package.mjs
```

Esto corre la suite del kernel, calcula huellas de `src`, `docs`, `demo` y `scripts`, y escribe [JUDGE_PACKAGE.json](./JUDGE_PACKAGE.json), sin red; README y CHANGELOG de la raíz, pruebas y ejemplos quedan fuera del inventario de huellas. Contrasta `packageVersion`, `gitCommit`, `tests` y `fileHashes` con tu copia. Un manifiesto guardado puede corresponder a un corte anterior; regenéralo con la versión y los archivos finales. Sus textos de estado vienen de un índice estático anterior, que omite Permamuseum y todavía menciona código y pruebas; esos textos no establecen el acceso actual. Usa el calendario del README indicado abajo. El manifiesto no descarga proyectos, y sus cifras de pruebas omiten el desglose de `todo` reportado arriba.

## Qué entró de lo anunciado en 0.1.3

[La nota del 0.1.3](./RELEASE_0.1.3_KERNEL.md) anunció emergencia, conocimiento cero, procedencia de skills y x402 dentro del kernel. [La nota bilingüe del 0.1.4](./RELEASE_0.1.4_KERNEL.md) registra qué entró y cada condición de revisión independiente. [Las regresiones de emergencia](../test/k1-emergencia-r6-advisor.test.js) cubren autoridad anticipada ejercida por el principal opaco del grantee y revisión rechazada al ejecutor, pero identidad real, tiempo confiable, almacenamiento, ejecución y verificación del efecto corresponden al host; D4 cuenta usos, no dinero. [Las regresiones de procedencia](../test/k2-procedencia-r5-advisor.test.js) cubren evidencia propia del resolver, sin enviarle `author` ni `contentDigest` declarados, y datos hostiles en prototipos, pero no código del mismo proceso que reemplace funciones integradas después de cargar; `provenanceSource` distingue `verified` de `declared`, y el nombre sigue declarado.

[Las regresiones x402](../test/k4-x402-r3-advisor.test.js) cubren un contrato de efecto pagado por puertos inyectados con `claims` obligatorio y síncrono e identidad de operación en la clave del efecto, pero sin almacén durable, liberación de reservas ni reembolsos. El validador declara el digest de salida; el kernel no lo recalcula ni inspecciona valores anidados. [El puente de referencia](../demo/x402/ports.js) tiene [pruebas con SDK en loopback](../demo/x402/bridge.test.mjs) reportadas por el constructor, pero no revisión final independiente, pago en vivo verificado ni prueba del camino real Soroban RPC para el payload. [El ejemplo mínimo](../examples/x402-app.js) usa puertos simulados:

```sh
node examples/x402-app.js
```

El ejemplo pertenece a la suite del kernel. Las pruebas con SDK son otra suite de la demo, requieren las dependencias de [demo/x402/package.json](../demo/x402/package.json) y quedan fuera del conteo del kernel de arriba.

[Las pruebas del puerto ZK](../test/k3b-zk-port.test.js) cubren clave fijada y entradas públicas acordadas, pero confían en el backend criptográfico inyectado. La [referencia interna BN254 con Groth16](../src/zk-bn254-reference.js) tiene [pruebas de referencia](../test/k3d-zk-groth16.test.js), pero no es API pública, no está auditada y no es apta para producción. Las pruebas son maleables, una clave degenerada acepta falsificaciones y un timeout con Promise no interrumpe la verificación con CPU síncrona. Estas pruebas no demuestran integración con Casa Firme o Vela.

D3 estampa `stellar:testnet` en todo ancla pendiente nueva, como muestra [receipt.js](../src/receipt.js), pero no afecta el digest ni demuestra un envío a la red; se parametriza en 0.1.5. D5 mantiene en claro el contenido sellado de Vela en la demostración, según el dueño; un despliegue real requiere cifrado en reposo y custodia de claves de un tercero.

## Evidencia histórica y acceso a los proyectos

Revisa [el recibo x402 guardado](../demo/x402/receipts/live-testnet-2026-10-02.json): `status: "verified"`, `verification.verified: true`, `notCovered: ["external anchor"]` y `anchor.status: "pending"`. Su [lectura guardada](./testnet-evidence.json) coincide con el pago declarado, pero corresponde al adaptador histórico y no valida el puente nuevo. El recibo del primer pago histórico sigue en `not_verified` aunque la lectura posterior coincida con los hechos declarados. Todo corresponde a Stellar testnet, con datos ficticios y sin dinero real.

[Los repositorios de proyectos funcionales](../README.md#los-proyectos-funcionales) son siempre públicos y hoy contienen solo README, según el calendario del dueño. Su código entra por un push a la rama principal el 12 de octubre de 2026 a las 20:29, hora de Chile, y se retira de esa rama por otro push el 16 de octubre de 2026 a las 19:31. El margen es de 30 minutos alrededor de la deliberación, del 12 de octubre a las 20:59 al 16 de octubre a las 19:01. Retirarlo con un commit nuevo no lo borra del historial de Git, y una copia que ya obtuviste no se puede retirar. Es un compromiso del dueño, no evidencia de que el push futuro haya ocurrido. Hoy no puedes reproducir las suites de los proyectos desde repositorios que solo contienen README.

## Qué NO trae el 0.1.4 y pasa al 0.1.5

La reducción de autoridad de gasto queda fuera por el defecto de setters heredados en el constructor base `grantSpend`. [La nota de versión](./RELEASE_0.1.4_KERNEL.md#qué-no-trae-el-014-y-pasa-al-015) da la razón de x402 HX-09, HX-11, HX-12, HX-13, R2-05 y H11; procedencia N07, N08, H12d y H13d; emergencia H21; y los casos retirados del puente R2-11 y R2-12. Otros `todo` declaran fronteras del contrato sin prometer arreglos futuros. No se demuestran runtime autónomo entre hosts, planificador, evidencia mainnet, segundo proveedor de pagos, auditoría externa de seguridad, certificación regulatoria ni preparación para producción.
