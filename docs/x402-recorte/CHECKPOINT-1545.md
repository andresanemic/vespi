# Checkpoint 15:45 — puente x402 recortado

- Rama `feat/x402-recorte`: 7 commits de Bunny sobre la spec (rojos ADV11-13/ADV15-19, rojos de los 7 mínimos, puente recortado, ejemplo, A01, F1, F2). Constructor vivo.
- Suite en este punto: 1213 tests, 1182 pasan, 7 fallan, 24 todo (base: 1191/1166/0/25).
- Los 7 rojos: 5–6 son los rojos nuevos de `k4-puente-r2.test.js` todavía sin cerrar (trabajo en curso, esperado) y 1 es `F1b-P3` (`collect-testnet-evidence`), que exige que `demo/x402/run.js` conserve su ISSUER — si el recorte toca `run.js`, esa expectativa se actualiza por decisión explícita, no en silencio.
- Un archivo sin commitear (`test/k4-puente-r2.test.js`): Bunny trabajando encima ahora mismo; no tocar.
- Siguiente: al entregar Bunny, entra Fludge con ronda adversarial propia; arbitro yo.
