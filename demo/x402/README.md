# Demo: x402 capability behind the kernel boundary

This folder contains the fixed paid-capability adapter used to exercise the Vespi kernel. The kernel remains dependency-free; x402, Stellar and USDC live here. The runner can return a schema-valid marketing plan after settlement verification and does not write a brief.

> **Demo boundary:** this is an offline-testable, in-process experiment. It is not a production payment service and must not be used with real funds or credentials.

## Offline verification

The local commands below are tested with Node 24+.

```sh
cd demo/x402
npm ci --offline
npm test
```

`npm test` runs the complete local suite, including the adversarial authorization, redirect, abort, replay and receipt tests. No wallet or funds are required. The tests run against local fixtures; `npm ci --offline` requires a warm npm cache.

The kernel suite can be run separately from the repository root:

```sh
node --test test/operation.test.js
```

## Testnet walkthrough

Run these commands from `demo/x402`; if needed, first run `cd demo/x402`.

Use Node 24+, a funded Stellar testnet payer, a USDC trustline, a receiver you control, and a reachable x402 facilitator. Never use mainnet for this demo.

Terminal 1: reference paid endpoint

```sh
BORA_PAY_TO=G... npm run server
```

Terminal 2: no authority

```sh
CLIENT_SECRET=S... \
BORA_PAY_TO_EXPECTED=G... \
SERVICE_BASE_URL=http://localhost:3777/api/agent-service \
node run.js --max-usdc=0
```

With no approval (press Enter), this ends at `needs_human_decision`; no payment is attempted. Answering `y` approves the payment path.

With a sufficient, destination-bound grant:

```sh
CLIENT_SECRET=S... \
BORA_PAY_TO_EXPECTED=G... \
SERVICE_BASE_URL=http://localhost:3777/api/agent-service \
node run.js --max-usdc=0.05
```

Before the paid request, the runner checks the selected 402 terms and prepares the exact Soroban transfer, including its authorization digest. After the response, it verifies the Soroban authorization shape, transaction envelope, x402-reported network, Horizon transaction hash/envelope, payer, contract, function, recipient and atomic amount, then returns a `verified` receipt only when all checks pass.

## What the adapter checks

- Each selected 402 requirement matches the paid effect: x402 v2, `exact`, Stellar testnet, the configured USDC contract and receiver, 0.01 USDC, supported sponsored-authorization flow and a bounded signing window.
- The operation grant is bound to the configured receiver; a wildcard grant cannot redirect the payment.
- Redirects are rejected, network and body reads have deadlines, and an abort signal is checked before the paid request.
- The settlement verifier ties authorization to the exact Soroban `transfer` root invocation, with no sub-invocations, pending signatures or excessive expiration.
- Evidence is reduced to an allowlist; the schema-valid plan is returned separately from the receipt and is exposed only after verification.
- The reference route applies a local duplicate-payment guard after x402 processing in the current process and bounds its idempotency set.

## Limits that remain explicit

The local idempotency guard is in-process only. It does not provide a durable operation ledger, a shared store across processes, or recovery after a crash. If a timeout occurs after a remote settlement was accepted, the result is `not_verified` and must be reconciled through the transaction history before a new operation is created.

The current verification surface is the offline suite. The paid walkthrough is a separate testnet setup; use only testnet credentials and never real funds.

<a id="espanol"></a>

## Guía en español

Esta carpeta contiene el adaptador de capacidad pagada que permite ejercitar el kernel de Vespi. El kernel no importa x402, Stellar ni USDC: esos detalles viven aquí. El ejecutor puede devolver un plan de marketing válido después de verificar la liquidación; no escribe un informe.

> **Frontera del demo:** es un experimento dentro del proceso y verificable sin conexión. No es un servicio de pagos de producción y no debe usarse con fondos reales.

En esta guía, `offline` significa sin conexión, `live` significa en vivo, `redirect` es redirección, `abort` es cancelación, `replay` es repetición, `facilitator` es facilitador y `trustline` es línea de confianza. Los identificadores de API se conservan sin traducir.

### Verificación local

Los comandos locales siguientes se probaron con Node 24+.

```sh
cd demo/x402
npm ci --offline
npm test
```

`npm test` ejecuta la suite local completa, incluidos los casos adversariales de autorización, redirecciones, cancelación, repeticiones y recibos. No requiere wallet ni fondos. Las pruebas usan fixtures locales; `npm ci --offline` necesita una caché de npm preparada.

### Recorrido testnet

Ejecuta estos comandos desde `demo/x402`; si hace falta, primero ejecuta `cd demo/x402`.

Usa Node 24+, una cuenta pagadora de Stellar testnet con fondos, un trustline de USDC, un receptor que controles y un facilitator x402 accesible. Nunca uses mainnet para este demo.

Terminal 1: endpoint de referencia

```sh
BORA_PAY_TO=G... npm run server
```

Terminal 2: sin autoridad

```sh
CLIENT_SECRET=S... \
BORA_PAY_TO_EXPECTED=G... \
SERVICE_BASE_URL=http://localhost:3777/api/agent-service \
node run.js --max-usdc=0
```

Sin aprobación, el recorrido termina en `needs_human_decision` y no intenta ningún pago. Responder `y` habilita la ruta pagada.

Con un grant suficiente ligado al receptor:

```sh
CLIENT_SECRET=S... \
BORA_PAY_TO_EXPECTED=G... \
SERVICE_BASE_URL=http://localhost:3777/api/agent-service \
node run.js --max-usdc=0.05
```

Antes de la solicitud pagada, el ejecutor comprueba los términos 402 seleccionados y prepara la transferencia Soroban exacta, incluido su digest de autorización. Después de la respuesta, verifica la autorización Soroban, el envelope, la red reportada por x402, el hash y envelope de Horizon, el pagador, el contrato, la función, el receptor y el monto atómico. Solo entonces devuelve un recibo verificado.

### Qué comprueba el adaptador

- Cada requisito 402 seleccionado coincide con el efecto de pago: x402 v2, `exact`, Stellar testnet, el contrato USDC y el receptor configurados, 0.01 USDC, flujo de autorización patrocinado y una ventana de firma acotada.
- El permiso de la operación está ligado al receptor configurado; un permiso comodín no puede redirigir el pago.
- Se rechazan redirecciones, las lecturas de red y del cuerpo tienen límites de tiempo y la señal de cancelación se comprueba antes de la solicitud pagada.
- La autorización se limita a la invocación Soroban `transfer` esperada, sin subinvocaciones, firmas pendientes ni expiración excesiva.
- La evidencia se reduce a una lista permitida; el plan de marketing se expone separado del recibo y solo después de verificarlo.
- La ruta de referencia aplica una protección local contra pagos duplicados después del procesamiento x402 y limita el conjunto de idempotencia del proceso.

### Límites explícitos

La protección de idempotencia funciona dentro del proceso y después del procesamiento x402. No ofrece un ledger durable, un almacén compartido entre procesos ni recuperación después de un fallo. Si se agota el tiempo después de que un settlement remoto haya sido aceptado, el resultado es `not_verified` y debe reconciliarse mediante el historial de transacciones antes de crear una operación nueva. La superficie actual de verificación es la suite sin conexión. La ruta pagada es un recorrido separado de testnet: usa solo credenciales de testnet y nunca fondos reales.
