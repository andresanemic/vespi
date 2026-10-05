# Puente x402 recortado — inventario de fallas (2026-10-05, tarde)

Rama de trabajo: `feat/x402-recorte` (desde `master` 221bfa0). Tope: martes 6 al mediodía, versión recortada que pase su revisión; lo que no pase se declara como límite, no entra con hueco conocido.

## Lo que ya está cerrado (rama `feat/x402puente`, para portar)

- A01: el runner lee el flag del puente; el adaptador histórico queda fuera.
- A02–A07: cuerpo acotado, payload que se cierra, un registro por autorización, firma del pagador verificada, ventana real de validez, claims store exigido, opciones contradictorias rechazadas.
- A10, A14: incluidos en el fix de arriba.
- A08: el fixture firma el preimage de autorización del SDK y lo comprueba contra el SDK.
- A09: el ejemplo toma spec, secreto, claims store y puerta humana de su host.
- Ronda 1 del kit (10 arreglos) y ronda 2 parcial (R2-01 a R2-04, R2-06) ya en `master`.

## Lo que sigue abierto (segunda revisión: 13 de 26 sin bloquear)

- ADV11, ADV12, ADV13, ADV15, ADV16, ADV17, ADV18, ADV19 del round ADV01–ADV20 (detalle en `feat/x402puente:test/k4-puente-r1-advisor.test.js`).
- Los 7 arreglos mínimos de la segunda revisión (roadmap §3): identidad de autorización reservada sin sobrescribir ni resucitar; registros pendientes que ya no pueden enviarse, eliminados; forma de autorización cerrada a lo que el puente declara; cuerpo del RPC acotado y cancelado con revalidación del aborto; cancelación propagada a Horizon durante la lectura; cuerpo cancelado aun con rechazo previo al lector; afirmaciones públicas del ejemplo y del puente corregidas.
- R3 diferidos con nombre (en `master` como `todo` declarado): R3-05, R3-06, R3-07, R3-10; HX-09, HX-11, HX-12, HX-13.

## Superficie recortada (lo único que se construye)

Preparar, inspeccionar una copia cerrada de la autorización, enviar una sola vez, verificar contra el ledger real, con almacén de reclamaciones explícito y lecturas acotadas. Más los 10 arreglos de la primera ronda y las fallas de la segunda convertidas en pruebas. Regla del kernel intacta: una pieza con vía de elusión de autoridad vigente NO entra.
