# RUN 05 — verificación independiente: provenance y durabilidad del kernel

**Fecha:** 2026-09-23
**Veredicto:** **PASS local del fix focalizado; sin blocker material observado.** Pago y settlement live: **NOT VERIFIED**.

## Encargo y frontera

> Eres verifier independiente de RUN 05 en C:\Vespi, distinto del executor. Usuario autoriza intervención mínima de provenance/durability y pide verificación focalizada, sin otro blind read. No edites código ni docs; no leas Cuaderno privado ni confíes en RUN.md/executor. Inspecciona fuentes directamente: src/operation.js, receipt.js, tests nuevos, README EN/ES, CHANGELOG, demo x402. Reproduce node --test (19 esperados), test adversarial x402, instalación npm ci --offline en temp aislado (no alterar node_modules existente), git diff --check, protocolo SHA-256, tag v0.1.1 histórico intacto; comprueba A sin io.ask => needs_human_decision + human_gate_no_decision, callback indeciso igual, B rechazo explícito => human_gate_rejected, C aprobación explícita persiste hasta terminal; kernel sin persistencia automática. Evalúa si hay blocker material de este fix, separando otros límites conocidos y live NOT VERIFIED. Guarda prompt/frontera, comandos y veredicto completo en C:\Vespi\experiments\005\VERIFIER-KERNEL-PROVENANCE.md (único archivo que puedes escribir); usa escalación sandbox si hace falta. No pagos, claves, red de pagos, push, commit, tag o release.

Leí directamente `src/operation.js`, `src/receipt.js`, `test/operation.test.js`, `README.md`, `README_es.md`, `CHANGELOG.md`, `demo/x402/README.md`, `demo/x402/capability.js`, `demo/x402/run.js`, `demo/x402/server.js`, `demo/x402/capability.adversarial.mjs`, `demo/x402/package.json` y `experiments/005/PROTOCOL.md`. No abrí el Cuaderno privado ni hice otro blind read. No tomé RUN.md ni informes del executor como evidencia. Una búsqueda de rutas/cadenas mostró nombres y fragmentos de archivos en experiments/005; no usé esos fragmentos para el veredicto. No edité código ni documentación. La instalación se hizo y limpió en un directorio temporal aislado; no alteré `demo/x402/node_modules`.

## Reproducción y evidencia

| Comprobación | Resultado |
| --- | --- |
| `node --test` desde `C:\Vespi` con Node v24.15.0 | **PASS**, 19 tests, 19 pass, 0 fail. Incluye los tres tests nuevos de provenance. |
| `node --test capability.adversarial.mjs` desde `demo/x402` | **PASS**, 1 test, 1 pass. El test intercepta `x402Client.prototype.createPaymentPayload`: ofertas desviadas no llegan a ese borde; la oferta declarada llega una vez; en mezcla solo la oferta autorizada llega al selector. Esto no prueba firma ni settlement live. |
| `npm ci --offline --no-audit --no-fund` con package.json y lock copiados a temp | **PASS**, 168 packages añadidos, exit 0. Temp eliminado tras la prueba; node_modules existente no se tocó. |
| `git diff --check` | **PASS**, exit 0. Solo avisos locales LF/CRLF de Git, sin error de whitespace. |
| `Get-FileHash experiments/005/PROTOCOL.md -Algorithm SHA256` | **PASS**, `0D9BA39FA400E78FE0F9142A0CBDAEE70C3906A9F8FFC38D3A162994DA72E318`, igual al SHA-256 declarado en el propio protocolo. |
| `git show-ref --tags v0.1.1-kernel`; `git cat-file -t`; `git rev-parse 'v0.1.1-kernel^{}'`; `git rev-parse HEAD` | **PASS local**. El tag anotado sigue en `3f38ddb4d113f32ba6502e2b1464e7f3fa3a0ec4`, resuelve a `32493e00b592c854ebe844a7bd98e036624f29e9`, igual a HEAD y al baseline del protocolo. No comprobé remoto. |

## Juicio sobre el fix

- **A, sin `io.ask`: PASS.** `runOperation` recibe gate `null`, devuelve `needs_human_decision` con `authority.approval: human_gate_no_decision`, `exercised: []`, y no llama a `perform`. Test específico verde.
- **Callback indeciso: PASS.** `ask` que devuelve `{}` cae en `human_gate_no_decision`; no se confunde con rechazo y no ejecuta la capability. Test específico verde.
- **B, rechazo explícito: PASS.** Solo `approved === false` registra `human_gate_rejected`; estado `needs_human_decision`, `perform` no llamado. Test específico verde.
- **C, aprobación explícita: PASS.** Solo `approved === true` continúa; `human_gate_approved` se conserva en el recibo terminal. El test nuevo cubre terminal `not_verified`; el test previo F3b cubre fallo de capability y excepción, y F3 cubre terminal verificado. La autoridad ejercida conserva destinatario.
- **Durabilidad: PASS semántico.** `buildReceipt` construye y devuelve un objeto; `runOperation` no importa ni llama filesystem/DB. Los comentarios y README EN/ES dicen que el caller debe persistir el recibo si necesita durabilidad. CHANGELOG ubica la corrección en Unreleased y quita la palabra “durable” del histórico v0.1.1. No hay persistencia automática atribuible al kernel.
- **Frontera x402: PASS local.** El kernel sigue sin importar x402/Stellar. El adapter compara los términos efectivos del 402 con su efecto fijo y el grant antes de crear payload. Los README explicitan endpoint, credenciales, trustline, fondos y red para la ruta live.

**No hay blocker material observado para esta corrección de provenance/durability.** El recibo es un valor devuelto: si el caller no lo guarda, no sobrevive al proceso. Eso queda declarado y no constituye promesa de durabilidad. La prueba adversarial solo observa el límite previo a `createPaymentPayload`; firma, facilitador, pago, settlement y verificación Horizon quedan **NOT VERIFIED** en esta pasada. Tampoco comprobé publicación remota ni cambié release/tag.

## Comandos principales

```powershell
node --test
# desde demo/x402:
node --test capability.adversarial.mjs
# en directorio temporal con package.json y package-lock.json copiados:
npm ci --offline --no-audit --no-fund
git diff --check
(Get-FileHash experiments/005/PROTOCOL.md -Algorithm SHA256).Hash
git show-ref --tags v0.1.1-kernel
git cat-file -t 'v0.1.1-kernel'
git rev-parse 'v0.1.1-kernel^{}'
git rev-parse HEAD
```
