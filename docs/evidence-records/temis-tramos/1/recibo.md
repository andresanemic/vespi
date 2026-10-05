# Tramo 1 — recibo (2026-10-02)

**Qué es:** forma canónica TEMIS-CF-1 y firma/contrafirma con verificación estricta. Diseño en `forma-canonica.md`, revisado por el Advisor (`advisor-1.md`).

| Estado | Evidencia |
|---|---|
| **Terminado** | Rojo observado (`rojo-observado.txt`: `Cannot find module '../src/canonical.js'`, commit `d9ffe6a`). Verde: `src/canonical.js` y `src/firma.js`, 56/56 con `node --test test/*.test.js`. Los vectores los calcula `vectores/generar.cjs` sin usar `src/`. |
| **Verificado (por el coordinador, aparte del implementador)** | (a) El implementador se negó a doblar la especificación cuando dos vectores positivos contradecían a un negativo; el defecto era del generador de vectores (un heredoc de shell des-escapó las barras; es el fallo ya anotado en la memoria del coordinador) y se corrigió regenerando con la herramienta Write. (b) Fuzz diferencial: 400 casos al azar (claves en distintos planos de Unicode, NFC/NFD, escapes, int64) canonicalizados por Node y por una segunda implementación en Python que no comparte código (`fuzz/`): 400 iguales, 0 discrepancias, bytes y digest. (c) Los ocho puntos de orden pequeño de ed25519, por sus codificaciones conocidas, se rechazan con `clave_orden_pequeno`. |
| **Certificado** | Pendiente: lo certifica Andrés usando el recorrido. |
| **Cerrado** | No. Falta el certificado y el visto bueno de Andrés para publicar. |

**Quién hizo qué.** Diseño y pruebas rojas: coordinador (Sonnet 5.5, Claude Code, esfuerzo bajo). Advisor: Opus (subagente, 79 s). Implementación: Bunny (`opencode/space-bunny-free`, opencode 1.18.34, permisos acotados a `src/` y a correr las pruebas, lanzado desprendido; 2026-10-02 de 18:28:44Z a 18:40:27Z, salida 0), con una sola vuelta de corrección del propio implementador sobre tres causas (`fin()` invertido, pares de sustitutos válidos rechazados, lectura little-endian de ed25519). Verificación y arreglo del generador: coordinador.

**Lo que no cubre.** Que `\p{Cn}` use la tabla Unicode del motor (Node 24.15) y no una versión fijada: dos implementaciones con tablas distintas podrían discrepar solo en puntos de código recién asignados; está declarado en `forma-canonica.md`. La verificación estricta de ed25519 se probó con los casos de arriba, no contra el conjunto completo de vectores de Wycheproof.

**Decisiones del coordinador que Andrés puede revertir antes del push:** claves de firma de las partes distintas de la cuenta Stellar; partes identificadas por clave pública hexadecimal; escala por importe (ver `forma-canonica.md`).
