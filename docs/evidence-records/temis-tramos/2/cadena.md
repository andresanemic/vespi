# Tramo 2 — líneas, cadena, first-write-wins y reconstrucción por un tercero

Escrito el 2026-10-02 por el coordinador a partir de los §4.3, §5, §6 y §17 del whitepaper; corregido tras la verificación del coordinador, el segundo punto fijo del Advisor (`advisor-2.md`) y la lectura de un tercero independiente (`tercero/reconstruccion.md`). Diseño del constructor (acuerdo 019, «reserva de sorpresa»); reversible hasta el push. Las pruebas (`test/cadena.test.js`) son la autoridad de los detalles.

## Qué es una línea

Una línea es un cuerpo CF-1 que se ancla. Lleva `forma` (`TEMIS-CF-1`), `tipo` (`expediente` si `hito` es `null`, `hito` si no; es lo que `sobreDeFirma` exige), `expediente_id`, `hito` (cadena no vacía o `null`), `version` (**entero** ≥ 1, nunca una cadena), `evento`, `anterior` (digest de una línea previa del expediente o `null`), `contenido` (objeto en CF-1) y `anula` (digest de la línea que declara anulada o `null`).

Eventos: `acuerdo`, `hito_abierto`, `declaracion`, `contraste`, `cierre`, `anulacion`, `incumplimiento`, `controversia`.

El anclaje de una línea es una transacción clásica con `MEMO_HASH` = su digest. El cuerpo no se publica: vive en el **archivo**. Una entrada del archivo es `{ digest, cuerpo, firmas: [{ clave_publica, firma }] }`; cada firma es sobre `sobreDeFirma(cuerpo)`.

## El acuerdo declara quién ancla

El `acuerdo` trae en `contenido`: las dos `partes` (`{ id, clave_publica }`), el `operador` (clave pública ed25519) y la **`cuenta_ancla`**, la cuenta Stellar (`G…`) desde la que se anclan las líneas del expediente. Como el acuerdo lo firman las dos partes, la cuenta ancla es una decisión de ellas. El libro trae, de cada transacción, su cuenta de origen (`fuente`); una transacción desde otra cuenta no cuenta. Esto dice **qué cuenta vale, no quién la controla**: el vínculo entre el operador y la cuenta sigue sin poder probarse con datos públicos.

## Quién firma cada evento y quién puede anularlo

| Evento | Firma que exige | Quién puede anularlo |
|---|---|---|
| `acuerdo` | las dos partes | nadie |
| `hito_abierto`, `cierre`, `incumplimiento` | el operador | el operador |
| `declaracion` | la parte nombrada en `contenido.parte` | esa parte |
| `contraste` (`contenido.accion` = `aceptar` o `impugnar`, `contenido.declaracion` = digest de la declaración vigente del hito) | la parte nombrada en `contenido.parte`, que debe ser **la otra** que la de la declaración | esa parte |
| `controversia` | una de las partes | la parte que la firmó |
| `anulacion` | **el autor de la línea anulada** (la anulación de una línea de una parte la firma esa parte; la de una línea del operador, el operador) | nadie |

Una anulación solo vale si apunta a una línea **vigente del mismo expediente y hito** que no sea el `acuerdo` ni otra `anulacion`.

## Estatus de una línea: el orden de evaluación es este

Se procesan las transacciones exitosas con memo, ordenadas por `(ledger, indice)`. A cada una se le asigna **el primer** estatus de esta lista que corresponda:

1. `sin_cuerpo`: ninguna entrada del archivo declara ese digest.
2. `digest_no_coincide`: una entrada declara ese digest pero el cuerpo que trae da otro digest. (Se busca primero por el digest declarado; un cuerpo que por sí mismo calcule el digest anclado y esté bajo otra declaración no se busca, y esa línea es `sin_cuerpo`.)
3. `cuerpo_invalido`: el cuerpo no es una línea bien formada (forma, tipo coherente con `hito`, evento conocido, `version` entera, `anterior` y `anula` nulos o digests, `contenido` objeto) o su `contenido` no tiene lo que su evento necesita (`declaracion`: `parte`; `contraste`: `parte` y una `accion` de las dos; `cierre`: un `resultado` de los dos), o es un `acuerdo` sin dos partes distintas y sin `cuenta_ancla` válida. Que un `contraste` lleve o no el digest de la declaración no entra aquí: es el estatus 7.
4. `sin_acuerdo`: el expediente no tiene un acuerdo válido anterior (salvo la propia línea `acuerdo`).
5. `cuenta_no_autorizada`: la transacción no salió de la `cuenta_ancla` del acuerdo.
6. `firmas_insuficientes`: faltan las firmas que exige su evento (incluye la firma de un tercero y un `contraste` de quien declaró); `anulacion_no_valida`: una `anulacion` sin firma válida, sin objetivo válido o de quien no es el autor de lo anulado.
7. `contraste_sin_objetivo`: un `contraste` que no apunta, en `contenido.declaracion`, a la declaración vigente del hito.
8. `perdedora`: la clave `(expediente_id, hito, version, evento)` ya la ganó una línea anterior. **Se evalúa antes que la cadena.**
9. `fuera_de_cadena`: su `anterior` no es una línea aceptada de ese expediente (la del `acuerdo` exige `null`).
10. `cierre_sin_respaldo`: un `cierre` de resultado `cumplido` sin una aceptación y con una impugnación vigente a la declaración vigente, o de `cumplido_no_confirmado` con alguna respuesta a ella, o sin declaración vigente.
11. `vigente`: acepta.

Una línea `vigente` pasa a `anulada` si una `anulacion` válida la deja sin efecto. Una línea anulada **sigue siendo línea aceptada** para la cadena: se puede seguir citando como `anterior`.

**La cadena.** Es el conjunto de líneas aceptadas del expediente, y una línea puede citar como `anterior` **cualquiera** de ellas, no necesariamente la última. El operador decide el orden del libro: si cada línea de una parte dependiera de la última de todas, intercalar una línea ajena bastaría para dejarla fuera de cadena. El orden de las escrituras sigue siendo del operador; esa confianza es el riesgo asumido de una sola cuenta ancla (whitepaper §4.3).

**Una línea anulada conserva su clave.** La clave `(expediente_id, hito, version, evento)` sigue ganada por ella, y toda línea posterior con esa clave es `perdedora`. La anulada deja de contar para el estado del hito. Para corregir hay que publicar otra `version`. Una corrección no reabre a la perdedora.

## Estado de un hito

Sobre las líneas vigentes no anuladas del hito: sin `hito_abierto` el hito no existe. El resultado de un `cierre` válido (`cumplido` o `cumplido_no_confirmado`) gana; sin cierre, `incumplido` si hay `incumplimiento` (lo firma solo el operador y por eso no pisa un cierre respaldado por las partes); si no, según la **declaración vigente** (la última no anulada) y las respuestas que apuntan a ella: una impugnación da `impugnado` (gana sobre una aceptación), una aceptación `acordado`, ninguna `declarado_por_una_parte`; sin declaración, `abierto`. Una respuesta a una declaración anulada o reemplazada no cuenta. Si hay dos cierres válidos en un mismo hito (de `version` distinta), cuenta el último del libro.

## Reconstrucción por un tercero

`reconstruir({ libro, archivo })` devuelve `{ expedientes: { [id]: { estado (único valor: `acordado`; un expediente solo existe con un acuerdo válido), partes, operador, hitos: { [hito]: { estado } } } }, lineas: [{ digest, estatus, hash, ledger }] }`. `libro` es la lista de transacciones `{ hash, ledger, indice, exito, memo, fuente }` como las entrega Horizon (el `indice` dentro del ledger no es un campo de Horizon: se deriva del `paging_token` como `(paging_token >> 12) & 0xFFFFF`); no usa nada más que el libro y el archivo, es determinista y no modifica sus entradas.

`compararConCopia(reconstruccion, archivoDeUnaParte)` → `{ coincide, diferencias }`; cada diferencia es `{ digest, tipo }` con `falta_en_la_copia` (la línea está en el historial y su cuerpo no está en la copia, aunque la reconstrucción la haya dejado `sin_cuerpo`), `cuerpo_alterado` (la copia trae, bajo el digest anclado, un cuerpo que da otro digest) o `falta_en_el_historial` (la copia trae un cuerpo cuyo digest no está anclado por la cuenta ancla). Si no coincide, no hay registro confiable y la salida lo dice.

## Alcance

Esto es la capa sin red: el libro es una lista. `scripts/e2e-testnet.cjs` corre lo mismo contra Stellar testnet con una cuenta ancla real, incluidas líneas adversariales, y un tercero reconstruye el resultado (`tramos/3/`).
