# Tramo 1 — forma canónica y firma de TEMIS (TEMIS-CF-1), versión revisada por el Advisor

Escrita el 2026-10-02 por el coordinador (Sonnet 5.5, Claude Code) a partir del §4.1 y §4.2 del whitepaper y de la revisión del Advisor (Opus, primer punto fijo del acuerdo 019; reporte en `advisor-1.md`). **Los vectores son locales: no se publican, y la forma no es irreversible, hasta que Andrés dé su visto bueno al push.** Hasta entonces cualquier decisión de abajo se puede cambiar sin costo.

## Qué cambió respecto de la propuesta que vio el Advisor

| Hueco o pregunta del Advisor | Qué se hizo |
|---|---|
| El dominio de entrada no estaba definido (`1e3` se vuelve el entero 1000 en Node y un float en Python) | La entrada canónica es **texto JSON leído con un lector propio y estricto**; `1e3`, `1.0` y `1.5` se rechazan en el texto. La API sobre valores ya en memoria solo acepta lo que ese lector produciría. |
| NFC depende de la versión de Unicode | Se rechazan los puntos de código sin asignar (`\p{Cn}`) y la prueba imprime `process.versions.unicode`. Limitación declarada: lo «asignado» es el de la tabla del motor; no se fija una versión de Unicode porque Node no permite fijarla. |
| La firma no fijaba qué se firma | Se firma un **sobre canónico** `{digest, expediente_id, forma, tipo, version}` precedido por la etiqueta `TEMIS-FIRMA-1\0`; así una firma sobre la versión 2 no completa una versión 4 ni otro expediente con el mismo cuerpo. |
| «Dos firmas distintas» no exigía que fueran de las partes | El cuerpo declara las claves públicas de las dos partes; solo cuentan las firmas de esas claves. La firma de un tercero se reporta y no cuenta. |
| ed25519 no se verifica igual en todas las bibliotecas | Verificación **estricta**: `S < L`, `A` y `R` en codificación canónica (`y < p`), `A` de orden no pequeño (`8·A ≠ identidad`). Vectores negativos para cada caso. |
| El vector discriminante tenía caracteres invisibles | Se escribe con escapes `\uXXXX`. |
| El tope 2^53 no cubre los stroops (int64) | El rango de enteros es **int64** `[-9223372036854775808, 9223372036854775807]`; el lector entrega `BigInt`. |
| Sin marcador de forma no se distingue CF-2 de CF-1 | Todo cuerpo de expediente o hito lleva `"forma":"TEMIS-CF-1"` dentro de lo que se hashea (lo exige la capa de firma, no el canonicalizador genérico). |

## Decisiones del coordinador que Andrés puede revertir antes del push

1. **Las claves de firma de las partes no son las de la cuenta Stellar.** La cuenta ancla solo firma la transacción de anclaje. Evita que un digest de 32 bytes se confunda con un hash de transacción y separa la identidad de la parte de la del operador.
2. **Las partes se identifican por la clave pública cruda en hexadecimal** (64 caracteres, minúscula), no por `G…`; una `G…` se deriva de ella.
3. **`escala` y moneda van por importe, dentro del cuerpo** (cada importe es `{ "moneda": …, "escala": …, "unidades": … }` con enteros), no por expediente. Esto lo define la capa de expediente en el tramo siguiente; el canonicalizador no lo impone.

## TEMIS-CF-1

**Entrada.** Texto JSON. El lector es estricto: sin comas finales, sin comentarios, sin BOM, sin texto sobrante, sin caracteres de control sin escapar dentro de cadenas, sin claves duplicadas. Se admite espacio en blanco entre símbolos y se descarta.

**Números.** Solo enteros: `-?(0|[1-9][0-9]*)`. Sin `+`, sin ceros a la izquierda, sin `-0`, sin fracción, sin exponente, sin `NaN` ni `Infinity`. Rango int64; fuera de rango se rechaza. Los importes con decimales se escriben como enteros en la unidad menor de su moneda.

**Cadenas.** Las secuencias `\uXXXX` se decodifican; un sustituto suelto se rechaza; se normaliza a **NFC**; se rechaza un punto de código sin asignar. Salida: entre comillas, con `"` como `\"`, `\` como `\\`, los controles U+0000–U+001F como `\b \t \n \f \r` o `\u00xx` (minúscula) y todo lo demás tal cual en UTF-8 (sin `\/`).

**Objetos.** Las claves se normalizan a NFC y se ordenan **por sus bytes en UTF-8** (orden por punto de código). Dos claves iguales tras normalizar: se rechaza.

**Arreglos.** Conservan su orden. **La salida no lleva espacio en blanco.**

**Digest.** SHA-256 sobre los bytes UTF-8 de la forma canónica; 32 bytes (lo que cabe en `MEMO_HASH`); se escribe en 64 caracteres hexadecimales en minúscula.

Se parece a RFC 8785 (JCS) en escapes y espacios; difiere en que ordena por bytes UTF-8 (JCS usa unidades UTF-16) y en que no admite números no enteros.

## Firma y contrafirma

**Cuerpo.** Todo cuerpo firmable lleva `forma`, `tipo` (`expediente` o `hito`), `expediente_id` (cadena), `version` (entero ≥ 1), `anterior` (digest de la versión previa o `null`) y, el expediente, `partes`: exactamente dos entradas `{ "id", "clave_publica" }` con claves distintas.

**Sobre.** `{ "digest": <hex del cuerpo>, "expediente_id", "forma", "tipo", "version" }`, en CF-1.

**Mensaje firmado.** `"TEMIS-FIRMA-1\0"` (UTF-8 y un byte cero) seguido de los bytes canónicos del sobre. ed25519 puro; clave pública en 64 hex, firma en 128 hex, minúsculas.

**Verificación estricta.** `S < L`; `A` y `R` canónicos; `A` de orden no pequeño; luego `crypto.verify` de Node.

**Estado.** *pendiente* con una firma válida de una de las dos claves declaradas; *acordado* con una firma válida de cada una. La misma clave dos veces es una; una firma de una clave fuera de `partes` se reporta como `no_parte` y no cuenta; una firma que no verifica se reporta con su motivo y no cuenta.

**Qué no es.** No es firma electrónica avanzada de la Ley 19.799 ni un fechado acreditado (whitepaper §4.2).

## Vectores

Viven en `vectores/cf1.json` y los calcula un código independiente del implementado (cadenas literales y `sha256`). Dos positivos —uno básico y uno discriminante (NFD frente a NFC y el orden UTF-8 frente al UTF-16 con `` y `𐀀`)— y negativos para cada rechazo de arriba.
