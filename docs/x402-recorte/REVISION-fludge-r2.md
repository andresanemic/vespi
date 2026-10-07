# Revisión Fludge R2 — puente x402 recortado (2026-10-05)

Veredicto: **entra con arreglos**.

## 1. Orden rojo-primero: confirmado

Worktree en `48c1143` (el test, sin `e6658e2`), misma corrida de `test/k4-puente-r2.test.js`:

- ✖ F5a rojo ("the signal reaches Horizon and no read is opened after it")
- ✖ F5b rojo (`Error: no ledger here` escapando crudo de settlement.js:254 — la misma vía que R1 nombró)
- ✖ F5c rojo ("the read never ended: the signal never reached fetch") — 5 s contra el SDK real en loopback
- ✔ F5d verde antes y después

En la rama con `e6658e2`: F5a/F5b/F5c/F5d verde. El test realmente falla sin el fix y no pasa por carrera.

## 2. F5 atacado otra vez

**2.1 Abierto — el vocabulario cerrado cubre el rechazo, no la respuesta malformada.**
`readSettlementPage` guarda los `.call()` con try/catch (settlement.js:251-265), pero todo lo que viene *después* de una respuesta válida se accede sin guarda: `txn.hash` (settlement.js:299), `txn.envelope_xdr` → `decodeTransaction` (308), `operations._links` (327), `operations.records` (329), `full.asset_balance_changes` (339). Reproducción directa (Horizon doble que resuelve `null`):

```
ESCAPED raw: TypeError Cannot read properties of null (reading 'hash')
```

Es la misma clase de fallo que R1 (excepción cruda cruzando al host), ahora por la rama *resolved* en vez de la *rejected*. La claim del commit "nothing left to throw" es falsa: solo cubre los tres `.call()`.

**2.2 Latente — el SDK reemplaza la señal del run si alguien pone timeout.**
`boundedFetchAdapter` (fetch-client.js:213-219) construye `currentInit = { ...config.fetchOptions, ... }` y luego `...signal ? { signal } : {}`: la `signal` local es `composeSignals([timeoutSignal])`, o sea **el timeout desplaza a la señal de la corrida, no la compone**. Además `makeRequest` (fetch-client.js:348-349) sobrescribe `config.signal` en cada petición y el adapter bounded nunca la reenvía a fetch. Hoy el puerto no pone timeout, por eso F5c sale verde; el día que esta lectura gane un timeout, la cancelación deja de llegar a fetch sin que ningún test lo note. También: `config.cancelToken` aborta un controlador que nunca llega a fetch en la vía bounded. Ojo de latencia real, no fallo vivo.

## 3. Suite atacada

- Corrida completa: `tests 1216, pass 1192, fail 0, todo 24`. Los 24 todos son explicados, uno por uno, con decisión de coordinador (diferido a 0.1.5), "out of contract" o "declared as a limit". Ninguno es un F de R1 escondido; el único con sabor de bug (H21 de emergency-hardening) está declarado rojo con razón y se quedaría red solo si lo cerraban mal.
- Orden: sin condicionamiento real. Cada test construye su propio bridge (`ports()` fresco, `horizonUrl: 'http://127.0.0.1:1'`), F5c levanta su propio server en loopback, y el único estado global tocado, `globalThis.fetch`, se restaura con `try/finally` (k4-puente-r2.test.js:163-170).
- No hay test F5 que cubra la rama resolved-malformed (ver 2.1): hace falta F5e.

## 4. Veredicto y lista ordenada de lo que falta

Entra con arreglos. En orden:

1. Cerrar 2.1: un Horizon que *resuelve* con forma inesperada no debe poder sacar un TypeError crudo de `verifySettlement`. Envolver el procesamiento posterior a cada lectura (o validar la forma antes de tocar campos) y responder con el vocabulario cerrado. Test nuevo (F5e): resolución nula/malformada → `failure`/`refused`, jamás excepción.
2. Dejar por escrito, en el código del puerto, la condición que mantiene viva la señal (no fijar `timeout` en la config del settlement read sin componer también la señal de la corrida), o componerlas a mano antes de registrar el interceptor. 2.2 es trampa para el próximo que toque ese adapter.
3. Nada más. F5 queda real: F5a/F5b/F5c/F5d verdes de forma determinista, rojo verificado sin el fix, y el cableado señal→fetch pasa por el SDK en loopback.

No-entra-directo resuelto: la vía de R1 (excepción cruda + señal que no llega) está cerrada. El desbordamiento residual es la rama resuelta-malformada, que es la misma superficie un paso más adentro.
