# Blind read after fix — lector nuevo de la superficie pública

## Prompt exacto recibido

> Eres un lector completamente nuevo del objeto público C:\Vespi. Tu superficie permitida es la que vería una persona que llega al repo: README.md, README_es.md, CHANGELOG.md, docs/GENESIS.md, src/ y tests públicos, demo/x402/README.md, package.json, server.js, run.js, capability.js y capability.adversarial.mjs, y experimentos 001/002 públicos si los necesitas. Puedes listar nombres de archivos. NO abras experiments/005/, PROTOCOL, RUN 05, C:\Claude, Cuaderno del Professor, teoría privada LUS/Lore/Vespi, mensajes de otras tareas, 'ese Vespi' ni Ditto. No recibes expectativas sobre respuesta ni hagas cambios al producto. Responde como visitante: qué entiendes que es Vespi y qué hace hoy, papel de Lore Plugin/Stellar/x402/experimentos, qué pudiste reproducir, claims no verificables, errores factuales, confusiones, punto de abandono y dirección futura. Examina si lo documentado sobre authority/gate/pago/verification se sostiene en código, pero no presupongas problema ni solución. Declara exactamente qué archivos abriste y qué ejecutaste. Guarda el prompt exacto, frontera y reporte completo en C:\Vespi\experiments\005\BLIND-READ-AFTER-FIX.md; esta única escritura de evidencia no te autoriza a leer esa carpeta. No uses fondos ni credenciales operativas. Este es el único blind final tras estabilizar código y docs.

## Frontera de lectura y acción

Solo leí la superficie pública permitida. Listé nombres de archivos del repositorio; ese listado mostró nombres dentro de `experiments/005`, pero no abrí ninguno. No abrí PROTOCOL, RUN 05, C:\Claude, Cuaderno del Professor, teoría privada, mensajes de otras tareas, “ese Vespi” ni Ditto. No modifiqué producto. Esta escritura es solo el registro solicitado. No usé fondos, cuentas, credenciales ni la ruta de pago en vivo.

**Archivos abiertos, exactamente:**

- `C:\Vespi\README.md`
- `C:\Vespi\README_es.md`
- `C:\Vespi\CHANGELOG.md`
- `C:\Vespi\docs\GENESIS.md`
- `C:\Vespi\src\authority.js`
- `C:\Vespi\src\operation.js`
- `C:\Vespi\src\receipt.js`
- `C:\Vespi\test\operation.test.js`
- `C:\Vespi\demo\x402\README.md`
- `C:\Vespi\demo\x402\package.json`
- `C:\Vespi\demo\x402\server.js`
- `C:\Vespi\demo\x402\run.js`
- `C:\Vespi\demo\x402\capability.js`
- `C:\Vespi\demo\x402\capability.adversarial.mjs`
- `C:\Vespi\experiments\001-operator-professor-loop\RUN.md`
- `C:\Vespi\experiments\002-x402-slice1\RUN.md`
- `C:\Vespi\experiments\002-x402-slice1\receipt-success.json`
- `C:\Vespi\experiments\002-x402-slice1\receipt-settlement-unverified-FIRST-ATTEMPT.json`
- `C:\Vespi\experiments\002-x402-slice1\receipt-rejected-policy.json`
- `C:\Vespi\experiments\002-x402-slice1\receipt-rejected-human.json`

**Comandos ejecutados, exactamente:**

1. `Get-ChildItem -LiteralPath C:\Vespi -Name; Get-ChildItem -LiteralPath C:\Vespi\src -Name; Get-ChildItem -LiteralPath C:\Vespi\tests -Name`. El último componente falló porque la carpeta pública se llama `test`, no `tests`.
2. `rg --files -g '!experiments/005/**' -g '!**/PROTOCOL*' -g '!**/RUN 05*' C:\Vespi`. Por la forma en que `rg` interpretó el patrón desde una ruta absoluta, el listado sí mostró nombres de `experiments/005`; no abrió su contenido.
3. `Get-Content -LiteralPath <ruta> -Raw` para cada uno de los 20 archivos declarados arriba. Fueron lecturas individuales agrupadas en dos lotes y uno posterior de cuatro recibos; no se leyó `package-lock.json`.
4. `node --version; node --test` en `C:\Vespi`: Node `v24.15.0`, 16/16 tests aprobados.
5. `Test-Path -LiteralPath C:\Vespi\demo\x402\node_modules; Test-Path -LiteralPath C:\Vespi\demo\x402\package-lock.json`: ambas rutas existen.
6. `node --test capability.adversarial.mjs` en `C:\Vespi\demo\x402`: 1/1 test aprobado.
7. `node -e 'const {createOperation,runOperation}=require("./src/operation.js"); const cap={id:"probe",required:()=>({spend:[{asset:"A",amount:"1",to:"B"}]}),perform:async()=>({ok:true,evidence:{}})}; runOperation(createOperation({goal:"probe"}),cap,{}).then(r=>console.log(JSON.stringify({status:r.status,approval:r.receipt.authority.approval})))'` en `C:\Vespi`: `{"status":"needs_human_decision","approval":"human_gate_rejected"}`.

## Lectura como visitante

Entiendo Vespi como un experimento de coordinación por operación: una operación expresa objetivo y efectos requeridos, un grant delimita qué puede ejecutar, y la falta de authority lleva a una decisión humana. Tras una capability, se verifica evidencia y se emite un recibo. El kernel actual es pequeño y ejecutable, no un runtime general de agentes: crea operaciones, compara requisitos de gasto con grants, ejecuta una capability inyectada y clasifica el resultado. La promesa conceptual más amplia —cuerpos heterogéneos, criterio compartido, economía de modelos y autonomía prolongada— está distinguida como dirección.

Lore Plugin aparece como sistema adyacente que transporta criterio y posible hogar futuro de una skill Vespi. No veo integración de Lore en este kernel: no lee lore ni evalúa calidad del plan. Stellar es el riel de settlement de la demo; x402 es el protocolo del intercambio HTTP 402/payload/settlement y vive en `demo/x402`, fuera de `src`. El experimento 001 muestra una revisión entre dos cuerpos, pero sus fuentes primarias no están en esta superficie: puedo leer su arbitraje, no reproducirlo. El 002 conserva recibos de tres rutas y un fallo real de verificación; es evidencia histórica de una corrida de `compose-launch-brief`, distinta de la demo pública actual `obtain-marketing-plan`, que solo entrega el plan. Esta distinción se entiende al leer ambos, pero exige atención.

## Lo que sí pude reproducir

`node --test` valida localmente ausencia de ejecución sin grant, continuidad con grant, separación de destinos y budgets por grant, clasificación `not_verified` si el verificador falla, y procedencia de la aprobación en los escenarios probados. El test adversarial de la demo pasa offline: ofertas 402 con importe, token, receptor, red, esquema, ventana o flujo distintos quedan fuera antes de `createPaymentPayload`; una oferta exacta alcanza ese borde, y una mezcla solo entrega la oferta autorizada al selector. No firma ni liquida: intercepta la creación del payload. El pequeño probe adicional reproduce que una operación sin función `ask` devuelve `needs_human_decision` pero registra `human_gate_rejected`.

El código respalda que el kernel no importa x402 y que `runOperation` llama a `perform` solo tras `sufficient` o aprobación del gate. En la demo, `required()` declara exactamente 0.01 USDC al receptor configurado; la primera solicitud busca un 402; el adaptador filtra sus ofertas contra precio, activo, receptor, red, esquema, tiempo, sponsorship, flujo y grant antes de crear el payload. Tras la segunda solicitud, `run.js` consulta Horizon y busca una transferencia USDC al receptor de al menos 0.01, y calcula un digest del plan recibido. Si `verify` arroja excepción, el kernel conserva la evidencia en un recibo `not_verified`.

## Lo que no pude verificar

No hice un pago en testnet, no consulté Horizon ni stellar.expert, y no comprobé de manera independiente que los hashes del experimento 002 correspondan al settlement descrito. Los JSON publicados son evidencia inspeccionable, pero su existencia y coherencia interna no sustituyen una consulta independiente de la cadena. Tampoco confirmé los releases de GitHub, el estado de HackMeridian, la futura incorporación a Lore Plugin, la autoría o los materiales primarios de 001. No reproduje la aplicación de Lore al trabajo ni una operación autónoma de varios cuerpos a partir del código público.

La verificación actual acredita la transacción buscada y calcula el digest del plan; no prueba por sí sola calidad, originalidad o utilidad del plan, ni establece criptográficamente que esos bytes concretos fueron causados por ese pago. El servidor devuelve un plan fijo tras el middleware de pago. El README de la demo reconoce que no genera brief.

## Errores, ambigüedades y límites materiales

1. **Etiqueta de gate inexacta sin decisor.** Si `io.ask` no existe, el código toma `{approved:false}` y el recibo dice `human_gate_rejected`. El probe lo reproduce. En ese caso nadie rechazó; el estado `needs_human_decision` es correcto, la procedencia no lo es. Los tests existentes cubren rechazos con callback, no este caso.
2. **“Durable receipt” excede lo que hace el kernel.** `buildReceipt` crea un objeto y `runOperation` lo devuelve; no lo persiste. En caso de caída posterior del proceso, la durabilidad depende del integrador. El comportamiento ante excepción del verificador sí evita un resultado `verified` falso mientras la función logra retornar.
3. **Authority acotada al llamado, con capability confiable.** El kernel toma `capability.required()` como declaración de efectos y confía en que `perform()` respete esa declaración. El adaptador x402 sí añade control sobre los términos 402 efectivos. No hay consumo persistente de budget entre operaciones, idempotencia ni prevención de reruns. Esto es compatible con el alcance experimental declarado, pero “bounded authority” no debe leerse como garantía general de gasto para capabilities arbitrarias.
4. **Entrada monetaria de la demo.** `run.js` convierte `--max-usdc` mediante `parseFloat` y `Math.round`, sin validar explícitamente texto inválido o negativo. Es una CLI de demo, pero el valor es el grant inicial y afecta una frontera de pago. El servidor y adaptador usan precio fijo, así que este límite no contradice el caso feliz probado.
5. **Verificación de pago con alcance estrecho.** `verify` en `run.js` exige transacción exitosa y cambio USDC al receptor por `>= 0.01`, pero no exige igualdad exacta ni comprueba el pagador dentro del cambio encontrado. El filtro previo exige oferta exacta; por eso la verificación es una comprobación posterior complementaria, no una reconstrucción completa del efecto declarado.
6. **El quickstart de rechazo todavía pide `CLIENT_SECRET`.** El runner valida `PAY_TO` y `SECRET` antes de crear la operación, aunque la ruta de gate rechazada no contacte el endpoint ni firme. Una cuenta sin fondos puede probarla; un visitante sin credencial no puede ejecutar literalmente el comando de rechazo. La frase “sin wallet, sin fondos, sin red” aplica al nivel 1, no al nivel 2.
7. **El experimento 001 contiene una contradicción visible y bien declarada.** Su claim inicial de 3.804 palabras aparece refutado por dos conteos de 3.822. Es un hallazgo preservado, no un error oculto del README.
8. **El experimento 002 y la demo pública son artefactos diferentes.** El 002 habla de plan → brief con política y aprobación humana; el runner actual obtiene solo plan y un grant suficiente permite continuar sin gate. No es falsedad porque los documentos lo distinguen, pero la navegación desde “first completed runs” hacia “judge quickstart” puede hacer pensar que el mismo flujo completo es reproducible desde `demo/x402`.

## Punto de abandono y dirección futura desde esta lectura

Para un visitante técnico, el recorrido reproducible termina tras los 16 tests del kernel y el test adversarial offline. El siguiente paso pide instalar dependencias (ya estaban presentes en este checkout), preparar cuenta y trustline, fondos testnet, receptor, secreto y red. Sin esos recursos, no hay reproducción local del settlement ni del experimento 002 completo. El material ofrece los recibos y hashes para inspección, pero no una prueba enteramente autocontenida de la corrida histórica.

La dirección futura que leo en el repo es incorporar Vespi como skill de Lore Plugin, conservar el foco en operaciones con autoridad delimitada, extenderse a perfiles de usuario, selección de modelos y trabajo delegado más largo, y seguir publicando experimentos y rechazos. La prioridad concreta que emerge de esta lectura pública sería mantener separadas las garantías del kernel, del adaptador x402 y de la evidencia histórica; la documentación ya va en esa dirección y los puntos anteriores señalan dónde las palabras todavía exceden o confunden el comportamiento reproducible.
