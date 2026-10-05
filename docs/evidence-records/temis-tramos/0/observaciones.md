# Tramo 0 — observaciones de la operación

## Disponibilidad de Bunny y Fledge en el primer minuto (2026-10-02)

Medida desde Claude Code (Sonnet 5.5, esfuerzo bajo), con `opencode 1.18.34`, `--pure`, permisos `*: deny` y una consigna de una palabra, lanzada desprendida del proceso del coordinador.

| Modelo | Resultado |
|---|---|
| `opencode/space-bunny-free` | Respondió «listo», salida 0. Disponible. |
| `opencode/fledge-alpha-free` | Primer intento, lanzado a la vez que el de Bunny: salida 1, `database is locked` (dos procesos de opencode a la vez sobre la misma base). Segundo intento, solo: sin salida en 100 s, cortado por el límite. No respondió. |

Lectura del coordinador: Fledge **no disponible** en el primer minuto. No se puede decir si es indisponibilidad del modelo o lentitud; el primer fallo tiene causa conocida (concurrencia) y el segundo no. Cambio de hipótesis aplicado: los despachos de opencode se lanzan de a uno, y el trabajo de investigación del tramo 0 pasó a subagentes de Claude Code con acceso web, cada uno con su permiso; la lectura del kernel la hizo el coordinador.

Esto es el relevo que el acuerdo pide demostrar «con una indisponibilidad real». Queda registrado como **observado, con una causa no resuelta**. No se simula y no se declara demostrado hasta que el recibo de cierre del tramo diga qué pasó con Fledge cuando se reintente.

Qué no se probó: que Fledge esté caído; solo que no respondió en dos intentos.

## Cuánto de la RC7 se vendoriza con el kernel 0.1.3 (comparación por hash, 2026-10-02)

Pregunta abierta del acuerdo 019: «se compara por hash antes del lunes». Resultado: `skills/vespi/core/kernel/SOURCE.md` de Lore Plugin fija los cinco módulos de `src/` al commit `892bd91`, y los SHA-256 de esa tabla coinciden con los de `git show 892bd91:src/<módulo>` y con los de `git show HEAD:src/<módulo>` del kernel (commit `581a65c`) para `authority`, `continuity`, `delegation`, `operation` y `receipt`. Entre `892bd91` y `581a65c` **`src/` no cambió ni un byte**; los cambios posteriores son del adaptador `demo/x402`, de pruebas y de documentos. Por tanto, el kernel 0.1.3 no obliga a re-vendorizar ningún módulo: la copia que lleva el kit ya es el `src/` del 0.1.3.

Salvedad de lectura: en disco, `src/operation.js` del kernel tiene finales de línea CRLF (`git ls-files --eol`: `i/lf w/crlf`), y su hash en disco difiere del registrado; quitado el `\r` coincide con el commit. Git lo normaliza y no aparece como cambio. Si se vuelve a comparar con `sha256sum` sobre el árbol, hay que hacerlo sobre `git show`, no sobre el archivo en disco.
