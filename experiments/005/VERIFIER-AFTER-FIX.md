# RUN 05 — verificación independiente después de la reparación

**Fecha:** 2026-09-23. **Veredicto de la frontera pre-firma: PASS, dentro del alcance offline.** No certifico un pago live.

## Prompt y frontera

> Eres verificador independiente, distinto del executor, en C:\Vespi. No edites código/docs ni leas Cuaderno privado. Inspecciona directamente el bloqueo pre-firma y su reparación actual sin confiar en RUN.md ni en interpretación del executor. Reproduce y documenta: node --test; nuevo node --test demo/x402/capability.adversarial.mjs (revisa que el test realmente intercepta el borde de createPaymentPayload y que RED anterior/fallo 0.50 está documentado, no aceptes un falso verde); npm ci offline en temp y deps/imports; git diff --check; rechazo pre-capability sin servidor; 402 amount 0.50 vs grant 0.05, token, payTo, network, scheme, firma/ventana y control válido; que términos inválidos no llegan a payload creation/sign/settlement y que solo ofertas válidas se pasan al selector; recibo y semántica de required vs max; docs EN/ES/demo; kernel v0.1.1 intacto; status y protocolo hash. No usar fondos, claves operativas ni red para pagos. Clasifica PASS/FAIL/NOT VERIFIED y cualquier blocker; un pago live no es requisito. Guarda prompt/frontera y reporte completo en C:\Vespi\experiments\005\VERIFIER-AFTER-FIX.md (único archivo que puedes escribir). Usa escalación del sandbox para esa escritura si hace falta.

Frontera aplicada: leí código público, documentación pública y el protocolo/reporte previo para constatar procedencia del RED; no leí Cuaderno privado, no edité código ni docs, no usé claves operativas, fondos, RPC, facilitator ni red para pagos. La única escritura persistente en el repositorio es este informe. La instalación offline usó y eliminó un directorio temporal.

## Resultado por comprobación

| Comprobación | Estado | Evidencia directa y límite |
| --- | --- | --- |
| Kernel | PASS | Node v24.15.0; `node --test` desde raíz: 16 pruebas, 16 pass, 0 fail. `git diff --quiet HEAD -- src test` salió 0: no cambios al kernel ni sus tests. |
| Test adversarial nuevo | PASS | `node --test capability.adversarial.mjs` desde `demo/x402`: 1 prueba, 1 pass. El test sustituye y restaura `x402Client.prototype.createPaymentPayload`; cuenta llamadas y lanza `PAYLOAD_BOUNDARY`. El control válido exige exactamente una llamada y ese error, así que un test desconectado del borde no daría verde. |
| RED anterior | PASS documental | `git show HEAD:demo/x402/capability.js` muestra `createPaymentPayload(pr)` directo, sin comparación con `required()` ni grant. `experiments/005/VERIFIER-FINAL.md` addendum documenta reproducción offline de 0,50 USDC (`5000000` atómicos) aceptado por el selector anterior con esquema falso, por encima del requisito 0,01 y grant 0,05, sin firma ni settlement. No repetí esa prueba sobre el código viejo. El test nuevo rechaza explícitamente el mismo valor antes de payload. |
| Instalación e imports | PASS | En directorio temporal, `npm ci --offline` instaló 168 paquetes, salida 0; importé allí `@stellar/stellar-sdk`, `@x402/core`, `@x402/express`, `@x402/fetch`, `@x402/stellar`, `express`: todos OK. Los seis están en `package.json` y en la raíz de `package-lock.json`. Las importaciones externas del demo corresponden a esos paquetes; `src/` usa módulos locales. |
| Diff y versión | PASS | `git diff --check` salió 0. HEAD `32493e00b592c854ebe844a7bd98e036624f29e9`, tag local `v0.1.1-kernel` apunta a HEAD. El protocolo `experiments/005/PROTOCOL.md` da SHA-256 `0D9BA39FA400E78FE0F9142A0CBDAEE70C3906A9F8FFC38D3A162994DA72E318`, igual al hash medido. No hice consulta remota de release/tag. |
| Rechazo sin servidor | PASS | Con endpoint `127.0.0.1:1`, `--max-usdc=0`, valores ficticios no operativos y respuesta `n`, `run.js` salió 0: `needs_human_decision`, `exercised: []`, `evidence: null`, `approval: human_gate_rejected`. El flujo termina antes de `perform()` y no requiere 402. |

## Traza de la frontera económica

`x402Capability.required()` declara un efecto fijo de `100000` atómicos (0,01 USDC), contrato `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` y `payTo` configurado. `run.js` concede por defecto `maxAmount=500000` (0,05 USDC). El max es techo de autorización, no importe ejercido: el recibo verificado del kernel registra el `required()` de 0,01. Por eso un 402 de 0,04, aun dentro de 0,05, también debe rechazarse para este adaptador de precio fijo; la prueba lo exige.

Después del primer 402, `capability.js` solo conserva ofertas con versión x402 2, esquema `exact`, red `stellar:testnet`, contrato USDC esperado, destinatario configurado, importe exacto `100000`, `maxTimeoutSeconds` entero seguro entre 1 y 300, `areFeesSponsored === true`, flujo `authorization` o ausente, y `sufficient()` contra el grant efectivo recibido de `runOperation`. Si no queda oferta, devuelve `ok:false` antes de `createPaymentPayload`.

El test intercepta ese mismo método de la clase usada por el adaptador. Para 0,50 USDC frente a grant 0,05; 0,04 frente a la declaración 0,01; otro token; otro `payTo`; otra red; otro esquema; ventana de 3600 s; y flujo `escrow`, observa **0 llamadas** a creación de payload y resultado de capability fallido. También prueba grant de 0,01 frente a 0,04. El control exacto 0,01 bajo grant 0,05 observa **1 llamada**. Con lista mixta [0,50, 0,01] observa una llamada y el selector recibe únicamente [0,01]. Esto descarta un falso verde que solo rechazara todo.

La firma Stellar ocurre dentro del camino de `createPaymentPayload` de la librería; el segundo fetch de pago y el settlement aparecen después en el adaptador. Con 0 llamadas al borde interceptado, estos casos probados no llegan a firma ni a settlement por este flujo. La prueba no observa internamente una firma real; no certifica el camino válido hasta settlement. Una respuesta 402 malformada puede lanzar antes de ese filtro y producir recibo fallido vía `runOperation`; no implica pago.

En `src/operation.js`, el kernel comprueba `required()` antes de invocar la capability; pasa la authority efectiva a `perform()`, incluyendo la grant de destino creada si el gate humano aprueba. Ante el rechazo del filtro, `runOperation` devuelve recibo `failed` con `exercised: []`, sin evidencia ni verificación. Esta semántica es consistente con ausencia de intento de payload; para un pago válido, `exercised` registra el efecto declarado y la verificación sigue siendo posterior al pago.

## Documentación y estado

**PASS:** `README.md`, `README_es.md` y `demo/x402/README.md` separan rechazo previo a contactar endpoint de ruta pagada que requiere 402. Ambas READMEs dicen que el demo compara términos efectivos antes de crear payload; la guía del demo nombra importe exacto, grant, red, destinatario, esquema y ventana, y da el comando del test adversarial. `CHANGELOG.md` sitúa la reparación en Unreleased y conserva v0.1.1 como release anterior. `demo/x402/server.js` configura precio de referencia $0.01 en testnet; su salida live no se probó aquí. El test y el filtro cubren también condiciones adicionales de `extra`.

**NOT VERIFIED:** pago live, firma real, facilitator, settlement, consulta de cadena, receptor y fondos reales, release remoto. No son requisitos para cerrar esta verificación pre-firma. Tampoco repetí el RED contra el checkout antiguo; constaté el código antiguo y la reproducción previa documentada.

**Blockers:** ninguno para la afirmación local de que ofertas 402 fuera de la declaración o grant no alcanzan la creación del payload en los casos probados. Un claim de settlement nuevo sigue necesitando ejecución y verificación externas.

## Estado Git al verificar

Nueve archivos tracked modificados: `CHANGELOG.md`, `README.md`, `README_es.md`, `demo/x402/README.md`, `demo/x402/capability.js`, `demo/x402/package-lock.json`, `demo/x402/package.json`, `demo/x402/run.js`, `experiments/002-x402-slice1/RUN.md`. Untracked antes de este informe: `assets/vespi-A.png`, `assets/vespi-B.png`, `demo/x402/capability.adversarial.mjs`, `demo/x402/server.js`, y seis archivos ya presentes en `experiments/005/`: `BLIND-CHECK.md`, `BLIND-READ-FINAL-v2.md`, `BLIND-READ-FINAL.md`, `PROTOCOL.md`, `RUN.md`, `VERIFIER-FINAL.md`. Git avisó que no podía leer el ignore global del usuario y que varios LF pasarían a CRLF; las verificaciones dieron salida 0.
