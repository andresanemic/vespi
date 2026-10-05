# Cambios al candidato del whitepaper (2026-10-02)

Punto de partida: `85d8d2c1ef7687edf8bea0f2c1852d18c7b5377fc12c6a9ba35e43440a60f811` (36.674 bytes). Hash tras estas correcciones: ver el final de este archivo. Cada cambio nombra su fuente en `fuentes.md` o `kernel-citado.md`.

| § | Cambio | Por qué |
|---|---|---|
| Cabecera | Párrafo «Estado al 2 de octubre» | Reconciliar con el alcance del acuerdo del proyecto y decir qué se verificó |
| 1 | RC6 → candidato 0.1.3; x402 «no verificado de punta a punta» → una liquidación verificada en testnet el 2026-10-02 | Recibo de la corrida y transacción confirmada en Horizon |
| 4.1 | Se agrega que la forma canónica del kernel no sirve para TEMIS (orden UTF-16, sin NFC, sin escala) | `src/receipt.js:21-29` |
| 4.4 | La tabla de pagos: el protocolo sí exige deduplicar atómicamente (métodos con reenvío indistinguible); lo durable es de TEMIS. *upfront*: la razón de la especificación es otra; sin reembolso definido | `scheme_exact.md` l. 18, 20, 42 |
| 4.5 | Reescrito con archivo y línea; deja de ser «según el relevo» | `kernel-citado.md` |
| 7 | Facilitador x402: una corrida real en testnet | Recibo de la corrida |
| 8 | `/settle` acredita envío y sondeo hasta `SUCCESS` o `FAILED` | `scheme_exact_stellar.md` l. 184 |
| 9 | Las cuatro primeras filas de «construido y diseño» pasan de «reportado» a «comprobado» | `kernel-citado.md`, recibo x402 |
| 10 | Ley 21.719: texto citado + el Boletín 18.623-07 que la posterga al 2027 (proyecto); art. 16 bis d) con la cita literal; DFL 251: «inciso segundo» → «inciso tercero»; reglamento del art. 13 de la 20.584: la última consulta es del 2026-09-27 | `fuentes.md` |
| 15 | SEP-57 es borrador; se retira «herramienta pública que genera los contratos» | `fuentes.md` |
| 17 | Alcance del MVP: pruebas 0 a 8; 9 y 10 pendientes con su condición; 11 fuera; prueba 0 hecha | `acuerdo.md` |
| 19 | Fecha de consulta y punteros a los tres recibos | — |

No se cambió el encargo del whitepaper ni se convirtió en memo de reunión. No se tocó el §18 (lo que solo deciden Andrés y Francisco).
- hash final: 9bca986120178382875e254af5e5cc28157b6a7b13769e966d6aff196628a5d9
