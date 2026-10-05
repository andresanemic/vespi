# Tramo 0, paso 0 — el kernel de Vespi, citado con archivo y línea

Hecho el 2026-10-02 por el coordinador (Sonnet 5.5, Claude Code, esfuerzo bajo), leyendo el árbol `C:\Claude\founder\proyectos\vespi\kernel` en el commit `581a65c`, rama `codex/rc6`. Las rutas son relativas al kernel. Esto reemplaza al relevo de otro agente que el whitepaper §4.5 declara como base: aquí cada afirmación trae su archivo y línea, y quien lo lee puede comprobarla abriéndolo.

**Corte.** El whitepaper habla del kernel RC6. El árbol actual es el candidato 0.1.3, que añade a RC6 la autoridad de varias personas, el anclaje con tres estados, la continuidad por recibos y la delegación. Donde el whitepaper dice «RC6», se lee «el kernel al commit citado».

**Qué cambió de rol.** La asignación inicial ponía a Fledge a citar el kernel. Fledge no respondió en el primer minuto del despacho (ver `observaciones.md`), y esta lectura es corta, de un solo archivo por afirmación; la hizo el coordinador. Queda dicho para que la verificación del tramo no la trate como una lectura independiente.

## Lo que el §4.5 dice que el kernel aporta

| Afirmación del whitepaper | Cita | Qué se leyó |
|---|---|---|
| Autoridad: `grantSpend`, `sufficient`; límites de activo, importe, destinatario y expiración | `src/authority.js:4-9` y `:41-93` | `grantSpend(asset, maxAmount, to, expiresAt)` devuelve `{ spend: [grant] }` (`:4-9`). `sufficient` valida activo, importe atómico, destinatario opcional y `expiresAt` (`:51-63`), elige el grant vigente específico y si no el comodín sin `to` (`:74-75`), rechaza uno vencido con el momento de vencimiento (`:80`) y compara el consumo acumulado contra `maxAmount` (`:86-90`). Es un permiso de gasto, sin saldo ni custodia. |
| Operaciones: `createOperation`, `runOperation`, `pauseOperation`, `resumeOperation`; estados, decisión, ejecución, verificación | `src/operation.js:284`, `:427`, `:389`, `:405`; export en `:927` | `createOperation` devuelve el estado `created`, el historial y `inFlight: false` (`:284-309`). Pausar y reanudar rechazan una operación en ejecución (`:394`, `:429`). |
| Recibos: `buildReceipt`, `verifyReceipt`, `anchorReceipt`; digest de JSON canónico | `src/receipt.js:283`, `:93`, `:170`; `:21-40` | `computeDigest` ordena las claves con `Object.keys(...).sort()`, hace `JSON.stringify` y aplica SHA-256 sobre UTF-8, excluyendo `digest` y `anchor` (`:21-39`). `verifyReceipt` recomputa y compara (`:93-108`). |
| Un conector de pagos con una capacidad x402 de ejemplo en testnet | `demo/x402/capability.js:281` | `x402Capability({ serviceUrl, payTo, secret })` exige un gasto en USDC de `PRICE_ATOMIC` (0,01 USDC) hacia el destinatario (`:285`). Vive en `demo/x402`, no en `src/`; el propio kernel no importa x402. |

## Lo que el §4.5 dice que le falta, y lo que se encontró

| Ausencia que el whitepaper declara | Cita | Qué se encontró |
|---|---|---|
| **Ninguna firma:** no hay ed25519 ni clave privada y el digest no va firmado | `src/*.js` (búsqueda de `ed25519`, `privateKey`, `sign(`, `createSign`, `createHmac`) y `src/receipt.js:3`, `:38`; `src/delegation.js:12`, `:53`, `:243` | **Confirmado.** El único uso de `node:crypto` en `src/` es `createHash('sha256')` (`receipt.js:3,38`; `delegation.js:12,53,243`). No hay firma ni clave. El comentario de `receipt.js` lo dice: el digest es SHA-256 sin clave y «says nothing about **who** wrote it» (justo encima de `verifyReceipt`). |
| **Ninguna cadena:** nada liga el recibo N con el N−1; una corrección no es una escritura y no hay anulación | `src/receipt.js`, `src/continuity.js`, `src/operation.js` (búsqueda de `prev`, `parent`, `chain`) | **Confirmado.** No hay campo que apunte al recibo anterior en el cuerpo del recibo (`receipt.js:301-322`). Lo más cercano es `anchor.digest`, que liga un anclaje al digest de su propio recibo (`receipt.js:69-85`), no a otro recibo. `resumeFromReceipts` (`continuity.js:46`) recibe una lista de recibos sueltos y descarta los que no verifican; no los ordena por enlace. |
| **Ninguna regla de «no se cuenta dos veces»:** la idempotencia del ejemplo es un conjunto en memoria, acotado, que no sobrevive a una caída ni sirve entre procesos | `demo/x402/idempotency.js:3-4`, `:6-14`; `demo/x402/capability.js:20`, `:129-134`, `:213-216` | **Confirmado.** `seenPayments` es un `Set` de módulo con tope `MAX_PAYMENT_KEYS = 10_000`; al llegar al tope devuelve `capacity` (`idempotency.js:3-4,11`). `consumedTransactions` es otro `Set` de módulo (`capability.js:20`) que `claimTransaction` consulta y rellena (`:129-134`). Ninguno escribe a disco. |
| **Ninguna continuidad durable:** el bloqueo de operaciones vive en memoria | `src/operation.js:307`, `:394`, `:429-434`; `src/*.js` (búsqueda de `writeFile`, `appendFile`, `fs.`) | **Confirmado.** La exclusión es la bandera `op.inFlight` sobre el objeto en memoria (`:307,394,429-434`). `src/` no escribe archivos: la búsqueda de `fs.`, `writeFile` y `appendFile` no devuelve ninguna coincidencia. La continuidad por recibos es una función pura sobre una lista que el llamante conserva (`continuity.js:46`). |

## Dos hallazgos que el whitepaper no trae

1. **La forma canónica del kernel no es la forma canónica de TEMIS.** El §4.1 pide JSON con claves ordenadas por sus bytes en UTF-8, sin claves duplicadas, texto en NFC, números en punto fijo. `canonicalize` del kernel (`src/receipt.js:21-29`) ordena con `Array.prototype.sort()` sin comparador, que compara por unidades de código UTF-16, y no normaliza a NFC ni fija una escala numérica. UTF-16 y UTF-8 ordenan distinto cuando hay caracteres fuera del plano básico frente a otros sobre U+E000. TEMIS no puede reutilizar `computeDigest` para su expediente sin escribir su propia forma canónica; esto confirma la ley 1 de TEMIS y es la razón de la prueba 1 del §17.
2. **El kernel ya trae piezas que el §4.5 no menciona y que TEMIS puede consumir sin tocarlo:** autoridad de varias personas (`authority.signers`, `src/operation.js:322-340`, usado en `:507`), quién puede pausar (`authority.pausers`, `:311`), un anclaje atado al digest de su recibo y con tres estados (`src/receipt.js:69-90`, `:158-215`) y una continuidad con compuerta de revalidación (`src/continuity.js:22-45`). Ninguno firma ni encadena.

## Veredicto

Las cuatro capacidades y las cuatro ausencias del §4.5 coinciden con el árbol al commit `581a65c`. El §4.5 deja de ser un reporte de otro agente. No se leyó nada fuera del kernel, y la ausencia de firma se afirma sobre `src/` y sobre el código citado de `demo/x402`; no se auditó `node_modules` ni otros directorios.
