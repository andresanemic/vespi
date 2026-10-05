# Revisión Fludge R1 — puente x402 recortado (2026-10-05)

Veredicto: **entra con arreglos**.

## 1. Ataques contra la SPEC (propios, ≥8)

Formato: el ataque, si la SPEC lo cierra (línea de SPEC.md) o no, y cómo está en el código.

1. **Doble cobro del mismo efecto en un proceso** (re-preparar los mismos bytes tras un reenvío o una carrera). SPEC 11 ("Enviar una sola vez… el segundo es duplicado bloqueado") lo nombra, y el código lo cierra: F1, identidad = sha256 de los bytes leída una vez, conjunto `spent`, rechazo antes de cualquier segunda reserva (demo/x402/ports.js, prepare). Verde F1a/F1b. Resuelto.
2. **Registro reservado que el ledger ya no aceptará llena el tope MAX_PENDING_AUTHORIZATIONS y bloquea pagos vivos**. SPEC 13 ("reservas pendientes que ya no pueden enviarse se eliminan con diseño de caída escrito"). Código: F2, `dropUnsendable`/`sweepUnsendable` antes de consultar el tope; un registro cuya expiración no se lee se conserva; su identidad no pasa a `spent`. Verde F2a/F2b. Resuelto.
3. **Envelope con segunda entrada de autorización firmada por el mismo payer** (un segundo efecto que el ledger honraría, colado en la autorización del efecto declarado). La SPEC no exige forma cerrada: solo habla de copia cerrada y veredicto contra el ledger. Cerrado en código por F3 (`closedAuthorizationShape`, chequeado antes que cualquier lectura de estructura o firma). Verde F3/F3b. Cerrado en implementación, **ausente en el texto de la SPEC**.
4. **Abort durante la lectura del ledger** (una ventana "verificada" que nadie espera, o una preparación verificada tras la cancelación). SPEC 14: "el aborto se revalida al regresar". Código: F4, `throwIfAborted` tras la respuesta del lector de ledger. Verde F4a/F4b. Resuelto.
5. **Cancelación que no llega a Horizon y excepción de Horizon que escapa cruda al host**. SPEC 14 habla de lecturas acotadas y cancelables; el texto no exige que la señal arribe al SDK ni que el lector responda en vocabulario cerrado ante un fallo. Código: el puerto sí pasa la señal (`ports.js` verifySettlement → `readSettlementFromLedger(evidence, { signal })`), y el lector la consulta en sus puertas (`aborted()` en settlement.js), **pero** nunca la cablea al `.call()` de Horizon y no envuelve la lectura en try/catch: una excepción de Horizon sale como error crudo. Evidencia: F5a rojo en una corrida (`Error: no ledger here` escapa de settlement.js:254) y verde en otras (la puerta de aborto gana la carrera a veces). **Abierto e intermitente.**
6. **Cuerpo cancelado aun cuando la negativa precede al lector del cuerpo** (la negativa no es excusa para dejar el stream colgado). SPEC 14. Código: F6, cancel al denegar por tamaño declarado y al rechazar antes de leer. Verde F6a/F6b. Resuelto.
7. **Texto del puerto o del host en el recibo** (trazas, mensajes del SDK, valores del body). SPEC 15 ("Recibo sellado sin texto del puerto ni del host; catálogo cerrado de códigos"). Verde ADV11, F7. Resuelto.
8. **Verificador hostil: colgado, mentiroso o servicio que nunca cierra**. SPEC 12 ("un verificador hostil, colgado o mentiroso nunca verifica"). El código recortado responde: el veredicto lo da el lector real de liquidación, no el puerto mentiroso; lo colgado es presupuesto de `verify` en master con timer. Resuelto por diseño, con el límite declarado de que el lector es código de host confiable.
9. **Doble envío concurrente del mismo efecto, o un mismo kernel operation reutilizado con nuevo envelope**. SPEC 11. Código: deduplicación por claims store compartido; preparar la misma identidad rechaza. Verde ADV16/ADV18/ADV18b. Resuelto.
10. **Envelope con sub-invocaciones** (efecto más amplio que el declarado, aceptado por un lector ingenuo). La SPEC no lo nombra en texto. Código: F3 lo rechaza por forma antes de la firma. Verde F3. Cerrado en implementación, **ausente en la SPEC**.
11. **Cuerpo RPC sin tope o stream que nunca termina**. SPEC 14. Código: MAX_BODY_BYTES (1 MiB), BODY_READ_TIMEOUT_MS, abort extendido por toda la lectura. Verde ADV19/F6a. Resuelto.
12. **El runner carga el puente sin pedirlo, o el adaptador histórico sigue activo en paralelo** (dos verdades distintas para un mismo pago). La SPEC no lo nombra; cerrado en código por A01: `--bridge=1` es la única forma, el runner carga `ports.js` solo en esa rama, tests de no-import estático. Verde ADV15. Cerrado en implementación, **ausente en la SPEC**.

Resumen de los doce: 9 cerrados también en texto, 3 cerrado en código pero ausente en el texto de la SPEC (casos 3, 10, 12), 1 abierto de verdad: el caso 5 (F5).

## 2. Dif leído arreglo por arreglo (constructor @daimon)

- **F1 (3c4be69): real.** Identidad desha256 de los bytes leída una vez en prepare; `spent` se llena al consumir, no al terminar; re-preparar una identidad reservada o gastada se rechaza antes de firmar. No es un apaño de prueba.
- **F2 (3882528): real.** `dropUnsendable` recorre `prepared` antes de consultar el tope; solo elimina cuando el ledger ya pasó la expiración del registro; expiración ilegible conserva; identidad eliminada no pasa a `spent` y el caso nunca fue enviado. La caída está escrita junto al código.
- **F3 (c828fdb): real.** `closedAuthorizationShape` exige exactamente una entrada de autorización y corre antes que cualquier lectura de estructura o firma, en `verifyAuthorizationSignature` y en `inspectPrepared`. Segunda entrada del mismo payer y sub-invocaciones quedan fuera por forma.
- **A01 (319ccf3): real.** `bridgeRequested` exige el valor exacto `1` y rechaza presencia o cualquier otro valor; un claims store por proceso; el runner llega a `ports.js` solo en la rama del flag, nunca por import estático: el test lo afirma y el diff coincide.
- **F4 (dentro de 3c4be69): real.** `throwIfAborted` tras la respuesta del lector de ledger; F4b verde.
- **F5: NO real, abierto.** El puerto pasa la señal y el lector la consulta en puertas, pero no se cablea al `.call()` de Horizon y no hay try/catch que convierta la excepción en veredicto cerrado. F5a intermitente: en una corrida escapa `Error: no ledger here` de settlement.js:254; en otras pasa porque la puerta de aborto gana la carrera.
- **F6 (F6a/F6b, dentro de 1d740e6 y verde): real.** El body se cancela también cuando la negativa precede a la adquisición del lector.
- **F7 (header de ports.js y del ejemplo, verde): real.** El header nombra qué ejecuta el puente (bridge.test.mjs, loopback, SDK real) y qué no cubre (pago vivo, segundo proveedor, claims durable). El ejemplo rechaza inventar spec, secreto, claims store y puerta humana.

## 3. Veredicto y lista ordenada de lo que falta

Entra con arreglos. Lo que falta, en orden:

1. **F5 real**: en `demo/x402/settlement.js`, cablear la señal al `.call()` del SDK de Horizon y envolver la lectura en try/catch que responda con el vocabulario cerrado (`failure(...)`); que F5a sea verde de forma determinista, no por carrera.
2. **SPEC al día con el código**: nombrar la forma cerrada de la autorización (exactamente una entrada, una transferencia, un payer), la propagación de la señal a Horizon, y el bloqueo de doble vía runner/histórico salvo `--bridge=1`. Hoy esos cierres viven solo en el código y en los tests.
3. **Lo declarado como límite, declarado una sola vez y en un solo lugar**: claims store durable, pago vivo en testnet y segundo proveedor siguen siendo límites nombrados, no demostrados; el header de `ports.js` ya los nombra y conviene dejarlo así hasta que exista prueba.

No entra directo: sin el punto 1 la superficie de verificación tiene una excepción cruda que puede cruzar al host y una señal que no llega al SDK, y eso es vía vigente sobre un camino de pago.
