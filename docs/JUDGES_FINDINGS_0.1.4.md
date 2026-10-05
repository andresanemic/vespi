# Judge findings for kernel 0.1.4

This is the historical judge-review cut, before the integrated emergency, provenance, x402, ZK and evidence work. Its suite counts and missing-expectation finding describe that earlier checkout. The integrated [release note](./RELEASE_0.1.4_KERNEL.md) and [evidence guide](./TESTNET_EVIDENCE.md) record the current scope and the saved comparison: 50 readbacks, 5 semantically verified cases, 45 partially verified cases and 0 discrepancies.

Este documento conserva el corte histórico de revisión, anterior a la integración de emergencia, procedencia, x402, ZK y evidencia. Sus cifras de pruebas y el hallazgo de expectativas ausentes describen aquella copia. [La nota integrada](./RELEASE_0.1.4_KERNEL.md) y [la guía de evidencia](./TESTNET_EVIDENCE.md) registran el alcance actual y la comparación guardada: 50 lecturas, 5 casos verificados semánticamente, 45 parciales y 0 discrepancias.

## English

Reviewed the findings in sections (b) and (f) of simulated judge reports A, B, and C against the local 0.1.4 kernel tree. No network calls were made. For each reported kernel behavior, the verdict and reproducible evidence follow.

### 1. Uncertain result continuity (`not_verified`)

**Verdict: real in the earlier tree, corrected in 0.1.4.** When a `not_verified` receipt records an exercised effect, resumption must request reconciliation and must not propose that action again. The pre-0.1.4 implementation from `c128a44^` reproduced the judge's result: `nextAction: payment`, `needsPerson: false`, `reason: resumes payment`. The 0.1.4 implementation enforces reconciliation. `test/v014.test.js`, V014-C1, covers the exercised case; V014-C2 distinguishes a receipt with no exercised effect, and V014-C3/C4 cover later verification and unknown settlement.

Proof: `node --test test/v014.test.js` passed 24/24 tests in the focused run.

### 2. Digest changes after anchoring

**Verdict: real. Fixed in this branch.** The anchor adapters received and confirmed a digest for a body whose `notCovered` field was then changed. The confirmed body and returned digest therefore differed. Anchor preparation now sets final successful coverage before computing the submitted digest. Successful synchronous and asynchronous paths preserve the digest sent, confirmed, returned, and bound in `anchor.digest`.

Proof: `test/anchor-digest-stability.test.js` was red before the fix in both modes, then passed. `test/k3.test.js` and `test/k3-hardening.test.js` now also assert the binding. The focused anchor suite passed 32/32 tests.

### 3. Stellar testnet evidence semantics and historical responses

**Verdict: real. Verifier added; the checked-in evidence data is incomplete.** The repository did not contain `scripts/verify-testnet-evidence.mjs`. The new verifier checks `successful` and the expected operation, memo, asset, amount, and recipient. It accepts an injected transaction reader, so tests use a simulated response and do not contact Horizon. It stores each readback under `historical_response`, with `classification: "historical_readback"` and a capture timestamp.

The current `docs/testnet-evidence.json` has 50 transaction entries, but none declares an `expected` object and none has a saved raw historical response. The default verifier therefore stops before network access and reports that the 50 cases lack expectations. Their operation, memo, asset, amount, and recipient cannot be supplied safely from this checkout without inventing facts. `--offline` still checks only hash shape and uniqueness; it does not claim semantic verification.

Proof: `test/testnet-evidence-verifier.test.js` passed 4/4 tests, including mismatches for each expected field, successful exact matching, persisted-response classification, and rejection of undeclared expectations before the injected reader is called. `node scripts/verify-testnet-evidence.mjs --offline` reported 50 unique hashes and explicitly said expected facts were not checked. Running the online mode stopped on missing expectations without making a request.

### 4. Other findings in section (f)

**Verdict: no additional kernel runtime defect was evidenced there.** The remaining recommendations concern presentation, evidence packaging, portfolio documentation, judge access, demo shell instructions, or a future external pilot. They are outside this kernel behavior review. Within the code findings, the continuity and anchor items above are covered by existing or added regressions.

Complete suites: `node --test test/*.test.js` passed 273/273; `node --test` passed 322/322 after installing the x402 demo dependencies from the local npm cache with network access disabled.

## Español

Se contrastaron los hallazgos de las secciones (b) y (f) de los informes simulados A, B y C con el candidato local 0.1.4. No se hicieron consultas de red. Cada veredicto sobre comportamiento del kernel y su prueba reproducible se detalla a continuación.

### 1. Continuidad de un resultado incierto (`not_verified`)

**Veredicto: real en el árbol anterior, corregido en 0.1.4.** Si un recibo `not_verified` registra un efecto ejercido, reanudar debe exigir reconciliación y no debe volver a proponer esa acción. La implementación anterior a 0.1.4 de `c128a44^` reprodujo el resultado del juez: `nextAction: payment`, `needsPerson: false`, `reason: resumes payment`. El candidato ya exige reconciliación. `test/v014.test.js`, V014-C1, cubre el efecto ejercido; V014-C2 distingue el recibo sin efecto ejercido y V014-C3/C4 cubren una verificación posterior y un resultado de liquidación desconocido.

Prueba: `node --test test/v014.test.js` pasó 24/24 en la ejecución enfocada.

### 2. Cambio del digest después del anclaje

**Veredicto: real. Corregido en esta rama.** Los adaptadores de anclaje recibían y confirmaban el digest de un cuerpo cuyo campo `notCovered` se modificaba después. El cuerpo confirmado y el digest devuelto no coincidían. La preparación del anclaje ahora fija la cobertura final exitosa antes de calcular el digest enviado. Las rutas síncrona y asíncrona conservan el mismo digest enviado, confirmado, devuelto y asociado en `anchor.digest`.

Prueba: `test/anchor-digest-stability.test.js` quedó rojo antes de la corrección en ambos modos y después pasó. `test/k3.test.js` y `test/k3-hardening.test.js` también comprueban ahora la asociación. La suite enfocada de anclaje pasó 32/32 pruebas.

### 3. Semántica de evidencia Stellar e historial de respuestas

**Veredicto: real. Se añadió el verificador, pero los datos de evidencia del repositorio están incompletos.** El repositorio no contenía `scripts/verify-testnet-evidence.mjs`. El nuevo verificador contrasta `successful` y la operación, memo, activo, monto y destinatario esperados. Acepta un lector de transacciones inyectado, por lo que las pruebas usan una respuesta simulada sin consultar Horizon. Guarda cada respuesta bajo `historical_response`, con `classification: "historical_readback"` y la hora de captura.

El archivo actual `docs/testnet-evidence.json` contiene 50 transacciones, pero ninguna declara un objeto `expected` y ninguna incluye la respuesta histórica sin procesar. Por eso el verificador predeterminado se detiene antes de acceder a la red e informa que a los 50 casos les faltan expectativas. No se pueden completar con seguridad operación, memo, activo, monto y destinatario solo a partir de esta copia sin inventar datos. `--offline` sigue comprobando únicamente forma y unicidad de hashes; no declara verificación semántica.

Prueba: `test/testnet-evidence-verifier.test.js` pasó 4/4 pruebas, incluidas discrepancias en cada campo esperado, coincidencia exacta, identificación de la respuesta guardada y rechazo de expectativas ausentes antes de invocar al lector simulado. `node scripts/verify-testnet-evidence.mjs --offline` informó 50 hashes únicos y aclaró que no comprobó los datos esperados. El modo online se detuvo por expectativas ausentes sin hacer solicitudes.

### 4. Otros hallazgos de la sección (f)

**Veredicto: no se documentó allí otro defecto de ejecución del kernel.** Las recomendaciones restantes son sobre la presentación, el paquete de evidencia, la documentación del portafolio, el acceso de jueces, instrucciones de terminal para la demo o un piloto externo futuro. No forman parte de esta revisión de comportamiento del kernel. Los hallazgos de código sobre continuidad y anclaje están cubiertos por regresiones existentes o añadidas.

Suites completas: `node --test test/*.test.js` pasó 273/273; `node --test` pasó 322/322 después de instalar las dependencias de la demo x402 desde la caché local de npm, con la red deshabilitada.
