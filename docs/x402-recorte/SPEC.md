# Puente x402 recortado — spec corta (2026-10-06)

## Estado de la especificación

Sincronizada con el cierre de los puntos que R1 marcaba como ausentes: una sola entrada de autorización por efecto, señal de cancelación que alcanza a Horizon, y puente exclusivo bajo `--bridge=1`. Los siete comportamientos tienen prueba roja primero en `demo/x402/bridge.test.mjs` (30/30) y el caso de respuesta resuelta pero malformada (F5e) está cubierto tanto en el demo como en `test/f5e-settlement-malformed.test.js` (2/2). Criterio de entrada original: superado en R1/R2; F5e añadido en este corte.

## Restricción de diseño

El puente vive en `demo/x402/` (tiene `package.json` con el SDK; `src/` sigue sin dependencias). Nada del puente entra a `src/`. El ejemplo construye una aplicación x402 desde el contrato del kernel y prueba contra el SDK real con red contenida por fixtures (ledger inyectado; la corrida de ejemplo en testnet, sin dinero real, viene después de la revisión).

## Comportamiento (todo con prueba roja primero)

1. Preparar: la oferta exacta se selecciona y solo los campos admitidos entran a los términos; lo demás es `INVALID_SPEC`.
2. Inspeccionar: la autorización se lee una vez en una copia cerrada; lo que se firma es lo leído. La forma admitida tiene exactamente una entrada de autorización del pagador para la transferencia declarada; una segunda entrada, pagador distinto o subinvocación se rechaza antes de verificar firmas. La ventana de validez real se lee de un lector de ledger inyectable. **Cerrado**: `authorizationError` rechaza múltiples entradas, pagador distinto y subinvocaciones (D1-D4 en bridge.test.mjs).
3. Enviar una sola vez: concurrentes del mismo efecto pagan una vez; el segundo es duplicado bloqueado, nunca reenvío. El runner carga el puente de referencia solo con `--bridge=1`; si no se selecciona esa ruta, el adaptador histórico sigue fuera de ese flujo y el puente no se importa. **Cerrado**: `createMemoryPaymentClaims` + efecto por identidad; F1-F4 en x402.test.js confirman deduplicación.
4. Verificar: el veredicto lo da el puerto de liquidación contra el ledger; un verificador hostil, colgado o mentiroso nunca verifica. Una respuesta Horizon rechazada, cancelada, nula o malformada queda dentro del vocabulario cerrado del kernel y nunca escapa como error crudo del SDK. **Cerrado**: try/catch en `verifySettlement` envuelve todo el procesamiento posterior a cada lectura; F5e en bridge.test.mjs y `test/f5e-settlement-malformed.test.js` lo verifican.
5. Claims store explícito del host, sin default silencioso; reservas pendientes que ya no pueden enviarse se eliminan con diseño de caída escrito. **Cerrado**: `VESPI_X402_CLAIMS_REQUIRED` sin store; F5-F6 en x402.test.js.
6. Cuerpo del RPC acotado por tamaño y cancelable; la señal del run llega a la lectura de Horizon, el aborto se revalida al regresar y se propaga durante toda la lectura. **Cerrado**: `readSettlementPage` pasa `signal` al `.call()` del SDK y revalida `aborted()` antes y después de cada lectura; F5a-F5d en bridge.test.mjs lo verifican con SDK real en loopback.
7. Recibo sellado sin texto del puerto ni del host; catálogo cerrado de códigos. **Cerrado**: `sanitizeEvidence`/`sanitizeVerification` + razón con código del catálogo en todo rechazo; E10 y H1 en x402.test.js.

## Límites de esta spec (lo que NO cubre)

- No hay evidencia de pago vivo en testnet con este puente.
- El `config.cancelToken` del adapter bounded no llega a fetch mientras el puerto no fije timeout (trampa latente documentada en R2-2.2); no es un fallo vivo hoy.
- La validación de planitud del cuerpo de entrega verifica solo el nivel superior; valores nested no se inspeccionan (límite declarado R3-05/R3-06).
- El almacén de claims es en-memoria y se vacía con cada reinicio; no es durable entre procesos.
