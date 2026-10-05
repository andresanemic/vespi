# Tramo 3 — recibo: datos sintéticos, testnet de punta a punta y reconstrucción por un tercero (2026-10-02)

**Qué es:** una corrida real en Stellar testnet de todo el recorrido (alta, firmas, anclaje, hito, corrección, aceptación, cierre, hito sin respuesta, impugnación, escritura perdedora, controversia) más ocho líneas adversariales, y la reconstrucción del resultado por un agente que no participó. Guion: `scripts/e2e-testnet.cjs`. Datos de fantasía; sin dinero real. Autorización: «si no existen, crea cuentas nuevas de testnet» (Andrés) y el acuerdo 019 (solo testnet y datos sintéticos).

| Estado | Evidencia |
|---|---|
| **Terminado** | Expediente `exp-murckqaa`, cuenta ancla `GDWWBZGP…342H`, ledgers 4989043–4989065: 23 transacciones, 22 con `MEMO_HASH` (`corrida-exp-murckqaa.json`). Estados: `h1` cumplido (tras una corrección por anulación), `h2` cumplido sin confirmar, `h3` impugnado (con una escritura perdedora). Once estatus distintos, cada línea adversarial rechazada por su motivo. |
| **Verificado (aparte de quien lo construyó)** | **Reconstrucción independiente** (`tercero/reconstruccion.md`): un agente (Bunny, `opencode/space-bunny-free`, permisos de lectura limitados a la especificación pública, el archivo y Horizon, escritura solo en `tercero/`; 2026-10-02 de 19:22:07Z a 19:33:08Z, salida 0) implementó **su propio** canonicalizador y su propio ed25519 en Python a partir de las dos especificaciones; reportó haber leído solo los archivos permitidos (el registro de herramientas de la sesión muestra tres lecturas —las dos especificaciones y el archivo— y dos consultas a Horizon; los dos libros auxiliares de `datos/e2e/` los declara como lectura de control) y que **21 de 22 firmas verifican** (la restante es de un tercero y no cuenta). **Cruce programático** (`scripts/cotejar-con-tercero.cjs`, `cruce-con-tercero-exp-murckqaa.json`): los estatus de las 22 transacciones del tercero coinciden **22 de 22** con los de `src/cadena.js`, los tres hitos coinciden, y las tres diferencias que halla entre el archivo y el historial (`falta_en_la_copia`, `falta_en_el_historial`, `cuerpo_alterado`) son las que calcula `compararConCopia`. |
| **Certificado** | Pendiente: lo certifica Andrés. |
| **Cerrado** | No. |

**Lo que este recibo NO dice** (el Advisor pidió esta redacción):

- No dice que «la reconstrucción por un tercero está verificada» sin más. Dice que un agente independiente reprodujo, desde la especificación y el historial público, los 22 estatus y los 3 estados, y que hubo coincidencia con la implementación.
- «Sin ver el código» lo declara el agente y la transcripción de lecturas lo respalda; no es una garantía criptográfica.
- Los estatus los ejercitó **una** corrida de **un** archivo. `cuenta_no_autorizada` no la vio el tercero (solo leyó el historial de la cuenta ancla, donde esa transacción no aparece, y la reportó como `falta_en_el_historial`); la ejercitan las pruebas y mi propio cruce con ambos libros.
- La autenticidad de las **transacciones** de Stellar (sus firmas) no se verificó: el tercero dio por buenos los memos que Horizon devuelve y comprobó, en la primera corrida, que los 32 bytes del digest están en el sobre de cada transacción (`envelope_xdr`); el informe de la segunda no lo menciona.
- El vínculo entre la clave del operador y la cuenta ancla **no se puede probar** con datos públicos; el acuerdo, firmado por las dos partes, solo lo declara.
- La completitud del archivo no se puede verificar desde fuera: solo que no sobra ni falta nada para lo anclado (y en esta corrida el archivo adversarial **sí** sobra y falta, y el tercero lo dijo).
- El canonicalizador del tercero quedó probado en el subconjunto que estos cuerpos ejercitan (ASCII, enteros, objetos y arreglos anidados); no ejercita NFC, el orden UTF-8 no trivial ni los rechazos por Unicode sin asignar. Eso lo cubren los vectores propios y el fuzz contra Python del tramo 1.

**Qué encontró el tercero que no estaba en las pruebas**, y se corrigió con rojos primero (106/106):

1. `compararConCopia` declaraba «coincide» en una corrida donde faltaba un cuerpo anclado y había un cuerpo alterado: ignoraba las líneas `sin_cuerpo` (el encargo a Bunny decía «con cuerpo» y era mío el error) y no miraba los cuerpos alterados. Ahora marca `falta_en_la_copia` y `cuerpo_alterado`.
2. Lagunas de la especificación: el valor de `expedientes[id].estado`, el contenido que exige cada evento, si una línea anulada sigue siendo línea aceptada para la cadena, qué cierre cuenta si hay dos, cómo se busca el cuerpo (digest declarado) y de dónde sale el índice dentro del ledger. Todas escritas en `cadena.md`; el tercero dijo que ninguna cambiaba el resultado.

**Primera corrida (descartada como evidencia final).** `exp-murbsq49`, 15 líneas, sin `cuenta_ancla` ni líneas adversariales; el tercero la reconstruyó con 3 estatus de 15. Sus datos se conservan en `datos/e2e-primera-corrida/` y `tercero-anterior/`; el acuerdo de esa corrida no cumple la regla que después se agregó (cuenta ancla), así que ya no se reconstruye con la implementación actual.

**Quién hizo qué.** Corrida y cruce: coordinador (Sonnet 5.5, Claude Code, esfuerzo bajo). Reconstrucción independiente: Bunny. Advisor del cierre: Opus (`tramos/2/advisor-2.md`).

**Lo que falta del paso 4:** el certificado de Andrés, y una corrida donde el tercero sea otro modelo o persona distinta a la que implementó la cadena (aquí implementó la cadena Bunny y reconstruyó otra sesión del mismo modelo, con otro prompt y sin acceso al código; la independencia es de información, no de modelo).
