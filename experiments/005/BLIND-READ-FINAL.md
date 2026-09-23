# Procedencia de lectura ciega

- Fecha: 2026-09-23
- Objeto leído: superficie pública de C:\Vespi permitida por el encargo
- Frontera de contexto: lector nuevo; sin otras fuentes, pruebas ejecutadas ni archivos privados
- Prompt exacto del encargo:

```text
Actúa como lector NUEVO y ciego del repositorio público C:\Vespi. Lee SOLO superficie que una persona visitante podría ver: README.md, README_es.md, CHANGELOG.md, docs/GENESIS.md, demo/x402/README.md, archivos públicos de src/, demo/x402/server.js y run.js si hace falta para contrastar claims, y experiments/001 y 002 si quieres verificar evidencias públicas. Puedes listar nombres de carpetas. PROHIBIDO abrir experiments/005/, cualquier PROTOCOL o RUN 05, C:\Claude, Cuaderno de Professor, teoría privada LUS/Lore/Vespi, esta conversación o artefactos experimentales no publicados. Sin búsquedas externas salvo enlaces oficiales públicos del propio repo si fueran necesarios. No recibes expectativas experimentales. Responde con un informe autónomo y completo: qué entiendes que es Vespi, qué hace hoy, papel de Lore Plugin/Stellar/x402/experimentos, qué puedes reproducir, claims no verificables, confusiones, dónde abandonarías, y qué sigue siendo dirección futura. Indica exactamente qué archivos abriste y los límites de tu inspección. No edites archivos. Tu informe se preservará íntegro como evidencia de lectura ciega.
```

# Lectura ciega de Vespi

## Qué entiendo

Vespi es un experimento público sobre cómo coordinar personas, modelos y servicios mediante **operaciones con autoridad acotada**. Su tesis es que disponer de una capacidad o de contexto no equivale a tener permiso para actuar. El proyecto está en etapa experimental: tiene un kernel ejecutable y una demo de pago, pero no se presenta como runtime completo ni protocolo estable.

Hoy el kernel recibe una operación y una capacidad que declara requisitos. Comprueba si los grants cubren esos requisitos; si no, solicita una decisión humana. Si puede continuar, ejecuta la capacidad una vez, verifica la evidencia y emite un recibo. El código contempla `needs_human_decision`, `failed`, `not_verified` y `verified`. Una excepción del verificador conserva la evidencia en un recibo `not_verified`, sin repetir el posible efecto.

Lore Plugin aparece como el sistema que aporta criterio acumulado sobre qué cuenta como buen trabajo. La dirección publicada es incorporar Vespi como skill propia de Lore Plugin; los README dicen expresamente que esa integración aún no está lanzada. Stellar y x402 son la primera prueba de una capacidad externa pagada: el kernel desconoce ambos; la demo pone el pago en un adaptador y usa Stellar testnet. Los experimentos públicos muestran una coordinación de dos roles (`001`) y una corrida con pago, rechazos y fallo conservado (`002`). Son evidencia de casos concretos, no prueba de orquestación general.

## Qué puedo reproducir o comprobar desde esta superficie

El README ofrece `node --test` con Node 24 para comprobar el kernel sin fondos ni red. El código visible permite seguir la comprobación de autoridad, el gate, la ejecución, la verificación y el recibo. **No ejecuté los tests**, por lo que no confirmo personalmente el resultado anunciado de 16/16.

La demo trae instrucciones para iniciar un endpoint local y ejecutar dos variantes de la misma operación: con máximo de 0 USDC debe pedir decisión; con un grant suficiente puede pagar 0,01 USDC en testnet y producir un recibo verificado. Repetirla exige Node 24, instalación de dependencias de la demo, dos cuentas preparadas, USDC de testnet, clave del pagador, facilitador y red. **No ejecuté la demo ni consulté Stellar**. `run.js` muestra una verificación que consulta Horizon, busca una transferencia USDC al receptor esperado y calcula un digest del plan, pero no inspeccioné el adaptador `capability.js`; por eso no doy por auditado el trayecto completo de x402.

El recibo público de `002` incluye un hash de transacción, importe, receptor y verificaciones registradas; ofrece una ruta concreta para contrastar el settlement fuera del repositorio. El primer intento conserva un fallo de verificación tras un settlement declarado exitoso. El rechazo humano registra ausencia de settlement. El rechazo por política está identificado como **simulación de presupuesto excedido**, no como rechazo real de un pago live.

## Límites y puntos donde me detendría

`001` relata una arbitraje sobre archivos primarios que no están en esta superficie. Puedo leer el resultado y su corrección del conteo de palabras, pero no repetir la comparación de bytes, comprobar la autoría ni verificar de forma independiente sus “cero intervenciones humanas”.

`002` registra `compose-launch-brief` y un brief generado por plantilla; la demo documentada hoy ejecuta `obtain-marketing-plan` y declara que **no escribe un brief**. Un lector puede confundir la corrida histórica con lo que reproduce el runner actual. También puede interpretar “human gate” como aprobación en cada pago: el código lo solicita solo cuando la autoridad es insuficiente, y el comando con `--max-usdc=0.05` preautoriza el coste de 0,01.

Yo abandonaría una evaluación rápida al pasar del kernel local a la demo live si no tuviera cuentas y USDC de testnet preparados. Para evaluar la tesis del kernel no hace falta ese paso. Para evaluar la afirmación de settlement real, sí hace falta verificar la cadena; los JSON por sí solos son registros publicados por el proyecto.

Siguen como dirección futura, según los propios documentos: perfiles operativos de usuario, política de coste y escalación entre modelos, delegación autónoma prolongada, trabajo por lotes, integración publicada en Lore Plugin y capacidades más generales. Tampoco veo en esta superficie una implementación de custodia o pagos de producción.

## Archivos abiertos y alcance

Abrí exactamente estos **17 archivos**:

- `C:\Vespi\README.md`
- `C:\Vespi\README_es.md`
- `C:\Vespi\CHANGELOG.md`
- `C:\Vespi\docs\GENESIS.md`
- `C:\Vespi\demo\x402\README.md`
- `C:\Vespi\src\authority.js`
- `C:\Vespi\src\operation.js`
- `C:\Vespi\src\receipt.js`
- `C:\Vespi\demo\x402\server.js`
- `C:\Vespi\demo\x402\run.js`
- `C:\Vespi\experiments\001-operator-professor-loop\RUN.md`
- `C:\Vespi\experiments\002-x402-slice1\RUN.md`
- `C:\Vespi\experiments\002-x402-slice1\receipt-success.json`
- `C:\Vespi\experiments\002-x402-slice1\receipt-rejected-policy.json`
- `C:\Vespi\experiments\002-x402-slice1\receipt-rejected-human.json`
- `C:\Vespi\experiments\002-x402-slice1\receipt-settlement-unverified-FIRST-ATTEMPT.json`
- `C:\Vespi\experiments\002-x402-slice1\brief.md`

Además listé **solo nombres** en la raíz, `src`, `demo/x402` y las carpetas de `experiments/001` y `002`. No abrí otros archivos, enlaces externos ni fuentes privadas; no ejecuté código y no edité nada.
