# RUN 05 — Verificación independiente del candidate de provenance

**Fecha:** 2026-09-23
**Rol:** verifier independiente; no edité kernel, tests, documentación, RUN.md, Lore ni releases.
**Alcance:** `C:\Vespi`, `HEAD` histórico y working tree actual. La única escritura de esta pasada es este artefacto.

## BASELINE REPRO

- `HEAD` y `v0.1.1-kernel` resuelven a `32493e00b592c854ebe844a7bd98e036624f29e9`.
- Cargué `git show HEAD:src/operation.js` en memoria, sin crear checkout ni archivo temporal.
- El código histórico usa `{ approved: false }` cuando no existe `io.ask` y etiqueta el resultado `human_gate_rejected`.
- Probe histórico con `{}` y sin `perform()`:

```json
{"case":"HEAD_no_ask","status":"needs_human_decision","approval":"human_gate_rejected","exercised":[],"performCalls":0}
{"case":"HEAD_empty_ask","status":"needs_human_decision","approval":"human_gate_rejected","performCalls":0}
```

La regresión es reproducible en el baseline y el candidate corrige exactamente esa clasificación.

## CANDIDATE RESULT

El working tree contiene el candidate en `src/operation.js:43-50`:

- `io.ask` debe ser función; si no existe, `gate` queda en `null`.
- Solo `approved === true` continúa.
- Solo `approved === false` produce `human_gate_rejected`.
- Ausencia, `{}` y otros resultados no decisivos producen `human_gate_no_decision`.
- `human_gate_approved` se conserva en los estados terminales.

Probe independiente contra el working tree:

| Caso | Estado | `authority.approval` | `perform()` |
|---|---|---|---:|
| Sin `io.ask` | `needs_human_decision` | `human_gate_no_decision` | 0 |
| `ask() -> {}` | `needs_human_decision` | `human_gate_no_decision` | 0 |
| `ask() -> {approved:false}` | `needs_human_decision` | `human_gate_rejected` | 0 |
| `ask() -> {approved:true}`, verifier falla | `not_verified` | `human_gate_approved` | 1 |
| `ask() -> {approved:true}`, capability falla | `failed` | `human_gate_approved` | 1 |

En el caso de aprobación, `exercised` conserva el requisito declarado, incluido el destinatario. En ausencia de decisor o rechazo explícito, `exercised` queda vacío y `perform()` no se ejecuta.

## TEST RESULTS

- `node --test` desde `C:\Vespi`: **19 tests, 19 pass, 0 fail**.
- `git diff --check`: **PASS**, sin errores de whitespace; solo avisos LF/CRLF.
- El probe baseline/candidate se ejecutó por separado y no dependió de informes previos.
- `PROTOCOL.md` no cambió respecto de `HEAD`; hash observado: `0D9BA39FA400E78FE0F9142A0CBDAEE70C3906A9F8FFC38D3A162994DA72E318`.
- No se usaron claves, fondos, facilitator, RPC ni una ruta de pago live.

## APPROVAL-VALUE COMPATIBILITY

- Búsqueda en `src/`, `test/` y `demo/x402/`: no hay consumidor productivo, schema, validador ni fixture que compare `authority.approval` contra una lista cerrada.
- `src/receipt.js` documenta el nuevo valor; `test/operation.test.js:308-351` cubre los tres casos de procedencia.
- `demo/x402/run.js` solo serializa el receipt; no contiene lógica dependiente de sus valores.
- El changelog y los README actuales describen la ausencia de decisor como ausencia de decisión y la persistencia como responsabilidad del caller.
- Los reportes históricos que mencionan solo tres valores son evidencia de versiones anteriores, no consumidores del código actual.
- No hay evidencia local de ruptura por compatibilidad. Consumidores externos no presentes en el repositorio siguen siendo desconocidos.

## X402 REGRESSION CHECK

- `node --test capability.adversarial.mjs` desde `C:\Vespi\demo\x402`: **1 test, 1 pass, 0 fail**.
- El test sigue interceptando `createPaymentPayload`; las ofertas desviadas no alcanzan ese borde y la oferta exacta sí lo alcanza.
- El candidate de provenance no modifica `demo/x402/capability.js`, `authority.js` ni la frontera de filtrado x402.
- Esta comprobación es local y pre-firma. No certifica firma real, facilitator, settlement, Horizon ni pago live.

## RECEIPT CLAIM CHECK

- `buildReceipt` construye y retorna un objeto en memoria; no importa filesystem, base de datos ni otra persistencia.
- `runOperation` retorna ese objeto al caller. `demo/x402/run.js:55` únicamente lo imprime con `JSON.stringify`.
- `README.md:25` y `README_es.md:25` dicen que el caller debe persistirlo si necesita durabilidad.
- El candidate corrige el comentario de `src/receipt.js:3` y elimina la palabra “durable” del receipt histórico en el changelog de trabajo.
- No se propone ni se necesita crear almacenamiento nuevo para este fix.

## SCOPE CHECK

El diff focalizado de provenance es compatible con el cambio mínimo:

- `src/operation.js`: distinción entre rechazo explícito y ausencia de decisión.
- `src/receipt.js`: descripción del nuevo valor y de la persistencia externa.
- `test/operation.test.js`: tres regresiones de procedencia.
- `CHANGELOG.md`, `README.md` y `README_es.md`: claims y documentación del Unreleased.

El working tree contiene además cambios separados de la operación RUN 05: reparación x402, `server.js`, dependencias/lockfile, quickstart público, nota de provenance de RUN 002, imágenes y artefactos de `experiments/005`. Son cambios previos o de otra subtarea, no parte del diff focalizado de provenance.

El árbol completo está sucio y no representa un candidate limpio: 12 archivos tracked modificados y múltiples archivos untracked. No debe tratarse como un único commit de candidate sin separación explícita.

## BLOCKERS

- **No hay blocker de comportamiento** en el candidate local: baseline RED reproducido, candidate GREEN y regresión x402 PASS.
- **Blocker operativo para commit/cierre:** el working tree mezcla cambios de provenance, reparación x402, superficie pública y artefactos de experimentación; `HEAD` y el tag publicado siguen sin incluir el candidate.
- El candidate no demuestra que un callback externo represente realmente a una persona; solo clasifica fielmente el valor que el caller devuelve.
- La persistencia, el pago live y el settlement siguen siendo responsabilidades del integrator o están fuera de esta verificación.

## VERDICT: PASS

**PASS para el candidate de provenance local.** No se encontró blocker material en sus casos exigidos, ni regresión x402, ni conflicto de consumidores en el repositorio. **No se autoriza commit, cierre, release ni tag desde este artefacto**; el control vuelve a Andrés.
