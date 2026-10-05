# How Vespi is verified

> Español: [más abajo](#cómo-se-verifica-vespi)

A claim without a receipt does not go in. This page says what was applied, where you can open the evidence, what is only simulated so far, and what has not been done. It is not an external audit and nobody certified or endorsed it.

## What has been applied

| Practice | What it means here | Evidence |
|---|---|---|
| **Test first** | Each change starts with a test that is written first and watched failing for the right reason. Only then does the code change. | The [`test/`](../test/) folder (277 tests, `node --test test/*.test.js`). In Lore Plugin, the fix commits carry their red counts: the security fix below had 7 tests failing before it. |
| **The implementer is never the verifier** | One model implements; a different model verifies and tries to break it. Blind readers judge a result without seeing how it was made, and a third agent with no access to the code rebuilds the result. | The verifier reports and blind reads in [`experiments/`](../experiments/), and the independent rebuild of TEMIS from Horizon history alone (22 of 22 statuses): [TESTNET_EVIDENCE.md](./TESTNET_EVIDENCE.md). |
| **Independent verification passes** | Kernel 0.1.4 went through six independent verification passes. Each defect a pass reproduced was closed with a failing test first: eight in the first pass, then more in time handling, in signals of unknown shape and in asynchronous clocks. Those passes recorded 267 tests; the final release prep suite has 277. | The release notes of 0.1.4. |
| **Anthropic's security-review method** | The focused review for high-confidence vulnerabilities, with false positives filtered out, was applied to the Lore Plugin 2.4.9 changes. It found a real flaw: free text in a goal, an owner or a note could forge or shadow an operation block in `FASES.md`. It was fixed test first, and the three trust boundaries are now written down. | The fix and its tests in the Lore Plugin repository (`bench/vespi-forgery.test.mjs`) and the trust boundaries in its reference. |
| **Anti-hacking tests** | Tests that attack the code instead of confirming it: forged records, hostile inputs (`__proto__`, giant values, hostile clocks), a result of uncertain outcome that must never be retried blindly, and a task with no legitimate exit. | [`test/t1-adversarial.test.js`](../test/t1-adversarial.test.js) and the hardening suites in the same folder. |

## What is simulated so far, and what comes next

Anthropic's multi-agent cloud review (the "superreview") has **not** been run on this project. What exists today is a simulation of its shape with other models: three independent passes over the kit and the kernel, each with six specialist reviewers working in parallel (injection, paths, forgery, secrets, agent abuse, regressions) and a verifier that confirms or rejects every finding. The simulation is under way; its reports will be attached to this page when they finish, with their findings and what was corrected. The real superreview comes later, and it is listed here as planned, not as done.

## What this does not show

It does not show that the project is free of defects or ready for production, and a simulated review is not the real one. It shows how the work is done: tests first, someone else verifying, attacks written as tests, and what is found corrected in the open.

---

# Cómo se verifica Vespi

Una afirmación sin recibo no entra. Esta página dice qué se aplicó, dónde puedes abrir la evidencia, qué es solo simulado hasta ahora y qué no se ha hecho. No es una auditoría externa y nadie la certificó ni la avaló.

## Qué se ha aplicado

| Práctica | Qué significa aquí | Evidencia |
|---|---|---|
| **La prueba primero** | Cada cambio empieza con una prueba que se escribe primero y se ve fallar por la razón correcta. Solo después cambia el código. | La carpeta [`test/`](../test/) (277 pruebas, `node --test test/*.test.js`). En Lore Plugin, los commits de corrección llevan sus cifras en rojo: la corrección de seguridad de abajo tuvo 7 pruebas fallando antes de arreglarla. |
| **Quien implementa nunca es quien verifica** | Un modelo implementa; otro distinto verifica e intenta romperlo. Lectores ciegos juzgan un resultado sin ver cómo se hizo y un tercer agente sin acceso al código reconstruye el resultado. | Los informes del verificador y las lecturas ciegas de [`experiments/`](../experiments/), y la reconstrucción independiente de TEMIS solo desde el historial de Horizon (22 de 22 estatus): [TESTNET_EVIDENCE.md](./TESTNET_EVIDENCE.md). |
| **Pasadas de verificación independiente** | El kernel 0.1.4 pasó por seis pasadas de verificación independiente. Cada defecto que una pasada reprodujo se cerró con una prueba que fallaba primero: ocho en la primera, y más después en el manejo del tiempo, en señales de forma desconocida y en relojes asíncronos. Esas pasadas registraron 267 pruebas; la suite final de preparación tiene 277. | Las notas de la versión 0.1.4. |
| **El método de revisión de seguridad de Anthropic** | La revisión enfocada en vulnerabilidades de alta confianza, con filtrado de falsos positivos, se aplicó a los cambios de Lore Plugin 2.4.9. Encontró un fallo real: el texto libre de un objetivo, un responsable o una nota podía falsificar o ensombrecer un bloque de operación en `FASES.md`. Se corrigió con la prueba primero y las tres fronteras de confianza quedaron escritas. | La corrección y sus pruebas en el repositorio de Lore Plugin (`bench/vespi-forgery.test.mjs`) y las fronteras de confianza en su referencia. |
| **Pruebas anti-hacking** | Pruebas que atacan el código en vez de confirmarlo: registros falsificados, entradas hostiles (`__proto__`, valores gigantes, relojes hostiles), un resultado de desenlace incierto que nunca debe reintentarse a ciegas y una tarea sin salida legítima. | [`test/t1-adversarial.test.js`](../test/t1-adversarial.test.js) y las suites de endurecimiento de la misma carpeta. |

## Qué es simulado hasta ahora, y qué viene

El «superreview» multiagente en la nube de Anthropic **no** se ha corrido sobre este proyecto. Lo que existe hoy es una simulación de su forma con otros modelos: tres pasadas independientes sobre el kit y el kernel, cada una con seis revisores especializados trabajando en paralelo (inyección, rutas, falsificación, secretos, abuso de agentes y regresiones) y un verificador que confirma o rechaza cada hallazgo. La simulación está en marcha; sus informes se adjuntarán a esta página cuando terminen, con sus hallazgos y lo que se corrigió. El superreview real viene después y aquí figura como planeado, no como hecho.

## Qué no muestra

No muestra que el proyecto esté libre de defectos ni listo para producción, y una revisión simulada no es la real. Muestra cómo se trabaja: la prueba primero, otro verificando, ataques escritos como pruebas, y lo que se encuentra se corrige a la vista.
