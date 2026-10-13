# Resolución de pruebas pendientes — referencia actual 2026-10-13

Base: `6035b87`. Encargo de Andrés: resolver las pruebas vigentes y retirar las obsoletas, sin pendientes declarados ni falsos verdes. No mueve versiones, tags, releases ni copias fijadas del kernel.

## Doce pruebas activadas

- N07/N08: rechazar texto UTF-8 con pérdida en la respuesta del resolver y contener contexto anidado ilegible con un recibo `failed`, sin filtrar la excepción.
- H12d/H13d: conservar la solicitud válida rechazada y el instante de verificación de procedencia en decisiones, cargas y recibos. El reloj del proceso es confiado; esta marca no autentica tiempo externo.
- HX-11/HX-12/HX-13: sellar versión y hash de la clave del efecto en recibos x402 y exportar el catálogo congelado de códigos. La clave conserva su formato v2; no se publica la autorización ni el identificador de reintento del proveedor.
- H11: declarar red y recurso en el gate, conservarlos al crear operaciones, aprobar permisos y escribir recibos. Un grant con alcance explícito se compara contra ese alcance; grants antiguos sin esos campos conservan su alcance genérico.
- R2-05: reintentar la misma operación si se detuvo antes de enviar. La prueba antigua usaba dos IDs distintos y no comprobaba su promesa. El almacén en memoria libera la reserva propia antes del envío; custom stores pueden ofrecer `releaseEffect` síncrono, con reservas sin expiración o reasignación. Si no lo ofrecen, conservan la reserva. Después de llamar a `sendPaid`, un resultado incierto jamás libera la reserva.
- R3-05/R3-06/R3-07: comprobar el árbol JSON completo, rechazar getters/proxies/ciclos/huecos/hooks y valores que JSON pierde, recalcular SHA-256 del output y entregar una copia estable. No aplica el límite de ocho niveles de las ofertas. Sin output, el digest sigue siendo el reporte del validador.

## Doce pruebas retiradas con motivo

- G501, G502, G503, G504, G505, G507, G508 (7): exigían resistir código que reemplaza funciones del propio proceso; el kernel confía en su host y no ofrece aislamiento. Se mantienen las defensas activas contra datos hostiles y contaminación de prototipos.
- H21 (1): exigir no leer un accessor contradecía ADV18/ADV18R y la renovación segura que lo lee una vez. Esas regresiones quedan activas.
- HX-09 (1): copiar un nombre arbitrario del puerto al recibo contradice el catálogo cerrado y puede divulgar texto privado. HX-10 mantiene el rechazo y la ausencia de filtración.
- R2-11/R2-12 (2): sus cuerpos actuales no probaban el puente SDK que nombraban. La integración real se comprueba en `demo/x402/bridge.test.mjs`, con SDK y fixtures sin pagos vivos.
- R3-10 (1): exigía exportar el identificador privado usado como hint del proveedor. La conciliación ahora dispone del hash real sellado por HX-12; no requiere ampliar esa superficie.

Los cuerpos y motivos originales se conservan en los archivos `test/` del commit base. Ninguna retirada cuenta como corrección de un defecto.

## Compatibilidad y comprobación

Los recibos antiguos siguen siendo verificables. Los nuevos recibos de procedencia y x402 incorporan campos sellados y cambian su digest; no se reescriben recibos históricos. Los verificadores x402 deben aportar el SHA-256 de `JSON.stringify(output)` cuando entregan un cuerpo; hashes ficticios o ajenos al output se rechazan. El hash público del efecto permite relacionar recibos de un mismo efecto.

Ver `SUITE_RESULT_CURRENT.txt` para la ejecución actual. La suite y el demo se ejecutan sin pagos, credenciales ni ledger vivo. Linux/macOS y CI remota no comprobados. No hay auditoría externa de seguridad.

Referencia comprobada el 2026-10-13: kernel 1.218/1.218, demo x402 86/86, cero fallos, TODO u omitidas. La vara local de documentación pública también pasó sin hallazgos. `node scripts/record-suite.mjs` regenera la referencia actual sin sobrescribir los resultados históricos de las versiones.
