# Tramo 4 — recibo: pruebas 5 a 8 del §17 en testnet (2026-10-03)

**Qué es:** las cuatro pruebas que faltaban para el alcance del MVP (`acuerdo.md`: pruebas 0 a 8), corridas en Stellar testnet con cuentas y datos de fantasía, más la verificación aparte de lo que se construyó para la prueba 7. Los datos crudos de cada corrida están en este directorio; los guiones en `scripts/`.

| Estado | Evidencia |
|---|---|
| **Terminado** | Prueba 5 (`payto-multiplexada.json`): **negativa**, `/verify` rechaza la `payTo` multiplexada con `invalid_exact_stellar_payload_event_wrong_to`; el control con `payTo` normal pasa. Prueba 6 (`tipo-operacion.json`): `payment` (`a7b8393c…`, ledger 4995969) e `invoke_host_function` (`44e0f752…`, ledger 4995970); evento `transfer` idéntico. Prueba 7 (`idempotencia.json`): una llamada al facilitador, un abono real en Horizon, entrega reintentada sin recobrar; el reenvío directo del mismo payload al `/settle` fue rechazado por simulación. Prueba 8 (`carrera.json`): tres rondas con dos procesos reales compitiendo; ganó A una vez y B dos, y la reconstrucción coincidió con el orden de la red y con el libro invertido. Suite del proyecto: **135/135**. |
| **Verificado (aparte de quien lo construyó)** | **Dos verificaciones independientes de `src/pagos.js`** por un modelo Advisor (Opus, solo lectura, con scripts de reproducción en un directorio temporal) y **una lectura independiente del whitepaper §17.1 y §9 contra los cuatro JSON** (Sonnet, solo lectura). Lo que encontraron y se corrigió, con rojo primero cada vez, está abajo. |
| **Certificado** | Pendiente: lo certifica Andrés. |
| **Cerrado** | No. |

## Lo que encontró la verificación aparte

**Primera verificación de `pagos.js`** (la primera versión usaba un archivo por clave, un candado y escrituras en el lugar): dos caminos reproducidos de doble cobro (limpieza no atómica de un candado viejo, y un cobrador lento que pisaba el estado), un `liquidado` que retrocedía a `incierto`, un resultado perdido cuando el candado no se podía tomar tras un cobro exitoso, una entrega duplicada y un bloqueo permanente con una reserva vacía. Se rediseñó como **registro de solo creación** (cada hecho es un archivo nuevo, atómico por enlace, nunca reescrito; el estado se deriva leyendo los hechos; sin candados) y la clave pasó a ser **la obligación que se paga**, no la autorización. 9 pruebas nuevas (`test/pagos-hallazgos.test.js`).

**Segunda verificación** (sobre el rediseño): ningún doble cobro en 15 rondas con 16 procesos. Quedaban: un orden raro de intentos que dejaba un `liquidado` sin aviso aunque otro intento pudo haber cobrado, hechos ilegibles leídos como si fueran un estado, el borrado del temporal que podía lanzar después de crear el hecho, dos cobros distintos del mismo intento y un error propio reconocido por su código. Corregido (tercera versión): el `liquidado` lleva `sin_cerrar` y un aviso, `resolver` acepta `{ intento }`, un hecho ilegible detiene la tabla con `HECHO_ILEGIBLE`, el borrado del temporal no cambia el resultado, dos cobros del mismo intento dan `conflicto`, el error propio se distingue por identidad y se barren temporales viejos. 9 pruebas nuevas (`test/pagos-segunda-ronda.test.js`). Lo que **no** se resolvió y está escrito en el encabezado del módulo: un cobrador más lento que el plazo puede dejar que alguien reconcilie «no cobrado» y que luego llegue su cobro (se ve como `conflicto`, no se impide; la protección de fondo es aceptar «no cobrado» solo cuando vence la autorización); la tabla necesita enlaces duros (NTFS, ext4, APFS) y no fuerza a disco la entrada de directorio.

**Lectura independiente del whitepaper:** la tabla de actores decía que el operador no existía mientras otra fila lo daba por construido; «un solo pago» estaba desactualizado; la prueba 7 se describía con un caso distinto del que se corrió (la entrega que falla después de cobrar, no la liquidación que falla después de entregar); no se mencionaba el estado `conflicto` ni el supuesto de relojes; la prueba 5 generalizaba de un facilitador, un pagador y solo `/verify`; «evidencia completa» y «con hashes» pasaban de lo que hay. Todo corregido en el texto.

## Lo que este recibo NO dice

- Cada prueba se corrió **una vez**, con **un** facilitador (`x402.org`), **un** pagador por corrida y datos de fantasía. No hay mainnet ni servicio operando.
- La prueba 5 es solo `/verify`: no se corrió `/settle` con la multiplexada. «No se puede etiquetar el pago» es lo que se observó en ese facilitador.
- La prueba 7 no cubrió el caso inverso del §17 (la liquidación que falla después de entregar el servicio). Los caminos `incierto` y `conflicto` de la tabla se ejercitan en pruebas locales (`test/`), no en testnet. «La autorización no se puede reutilizar» es una lectura del rechazo por simulación.
- En la prueba 8 las tres rondas no cayeron en el mismo ledger: el desempate por índice dentro de un ledger no se ejercitó en vivo, y en cada ronda la perdedora fue la que tuvo que reintentar por colisión de secuencia.
- La autenticidad de las firmas de las transacciones de Stellar no se verificó en ninguna de las reconstrucciones.
- La revisión jurídica del §10 por una persona competente sigue pendiente; las pruebas 9 y 10 siguen pendientes por su condición de entrada.

## Quién hizo qué

Corridas, scripts, la tabla de pagos (tres versiones) y las correcciones: el coordinador (Sonnet 5.5, Claude Code). **El implementador previsto, Bunny por OpenCode, no estuvo disponible**: el free tier de OpenCode respondió «only be used from within OpenCode» desde la CLI el 2026-10-03, también con configuración limpia; se registra como bloqueo del host y no como fallo del proyecto. Verificaciones aparte: Advisor Opus (dos pasadas) y un lector independiente (Sonnet).
