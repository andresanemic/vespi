# Tramo 2 — recibo (2026-10-02)

**Qué es:** líneas, cadena, first-write-wins, anulación y reconstrucción desde un libro y un archivo (`src/cadena.js`; reglas en `cadena.md`).

| Estado | Evidencia |
|---|---|
| **Terminado** | Rojo observado (`rojo-observado.txt`, commit `417bf1f`). Verde: 106/106 con `node --test test/*.test.js` (45 de cadena: 22 del encargo, 6 de la verificación del coordinador, 14 de los hallazgos del Advisor y 3 de los del tercero independiente; 5 del anclaje; y las 56 del tramo 1). |
| **Verificado (coordinador, aparte del implementador)** | Primera pasada, leyendo `cadena.js` contra `cadena.md`: **cuatro huecos que ninguna prueba del implementador cubría** (anulación hacia un digest inexistente, hacia el acuerdo, hacia otra anulación o hacia otro hito; y un `incumplimiento` solo del operador pisando un `cumplido` respaldado por las dos partes). Segunda pasada, tras el Advisor (`advisor-2.md`): **cuatro huecos más** (anular lo ajeno; contraste sin objetivo y cierre sobre la aceptación de otra declaración o con una impugnación vigente; cuerpo mal formado vigente; acuerdo sin cuenta ancla declarada). Todos con rojo primero y corrección; ver abajo la búsqueda de gemelos. |
| **Certificado** | Pendiente: lo certifica Andrés. |
| **Cerrado** | No. |

**Gemelos (búsqueda hecha el 2026-10-02 sobre `src/cadena.js`).** Construcción errónea buscada: una línea que cambia el estado de un hito sin las firmas de quien lo sufre; se buscaron los sitios donde firma solo el operador (`grep -n operador src/cadena.js`). TWINS: encontré 3 sitios. `hito_abierto`: solo abre, no decide nada disputado. `cierre`: ahora exige respaldo de las partes para `cumplido` y ausencia de respuesta para `cumplido_no_confirmado`. `incumplimiento`: ya no pisa un cierre respaldado; sí deja `incumplido` un hito sin cierre, y solo el operador puede anularlo. Este último es el que más confianza deposita en el operador y está declarado: una parte no tiene cómo anular un incumplimiento que considere falso, y su recurso es la `controversia`.

**Quién hizo qué.** Diseño, pruebas rojas, verificación y correcciones: coordinador (Sonnet 5.5, Claude Code, esfuerzo bajo). Advisor: Opus (subagente, 96 s). Implementación inicial: Bunny (`opencode/space-bunny-free`, opencode 1.18.34, permisos acotados a `src/cadena.js` y a correr las pruebas, desprendido, 2026-10-02 de 18:46:01Z a 18:56:05Z, salida 0), que dejó escritas sus decisiones sobre lo que la especificación no cerraba.

**Lo que no cubre.** `controversia` se registra y no cambia ningún estado. El plazo de un hito no está modelado: «sin respuesta» se expresa con el cierre `cumplido_no_confirmado` que emite el operador. No hay evento para cambiar la cuenta ancla. El operador conserva el orden del libro (riesgo de una sola cuenta ancla; whitepaper §4.3).
