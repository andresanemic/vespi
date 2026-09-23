# Lectura ciega final de la superficie pública de Vespi

## Prompt literal recibido

> Eres un lector nuevo del repositorio público C:\Vespi. Lee solo lo que razonablemente vería una persona visitante: README.md, README_es.md, CHANGELOG.md, docs/GENESIS.md, demo/x402/README.md, src/ y demo/x402 código si necesitas contrastar claims, experiments/001 y 002 públicos si los consultas. Puedes listar nombres de carpetas. No abras experiments/005/, ningún protocolo experimental, C:\Claude, Cuaderno de Professor, teoría privada LUS/Lore/Vespi, ni archivos de otras tareas. No uses internet salvo links públicos de este repositorio si fuera imprescindible. No recibes expectativas sobre una respuesta. Sin editar nada, entrega un informe completo: qué es Vespi según la superficie, qué puede hacer hoy, papel de Lore Plugin, Stellar/x402 y los experimentos, qué puedes reproducir, qué claims no verificas, qué confunde, dónde abandonarías y qué parece dirección futura. Indica exactamente los archivos abiertos y el límite de inspección. Guarda el prompt literal y el informe íntegro en C:\Vespi\experiments\005\BLIND-READ-FINAL-v2.md; esta escritura de evidencia no cuenta como lectura de experiments/005. Si necesitas permiso de sandbox para escribir, usa la escalación. El informe será la lectura final de la superficie pública corregida.

## Impresión como visitante

Vespi se presenta como un experimento público de coordinación entre personas, modelos y servicios que no comparten automáticamente contexto, permisos ni historia. Su unidad de diseño es la **operación**, no el agente. La pregunta central es cómo realizar trabajo legítimo con autoridad acotada y evidencia suficiente. El repositorio declara explícitamente que todavía no es un runtime terminado ni un protocolo estable. La promesa humana es reducir carga y devolver tiempo y agencia, no maximizar trabajo por sí mismo. La superficie es honesta al separar tesis, código actual y aspiración.

## Qué puede hacer hoy

Hay un kernel JavaScript pequeño en `src/`: crea una operación con meta y autoridad, pide requisitos a una capability, comprueba si la autoridad cubre el gasto, consulta a una persona solo si falta autoridad, ejecuta la capability una vez, pasa la evidencia a un verificador y emite un recibo. Los estados visibles son `needs_human_decision`, `failed`, `not_verified` y `verified`; `running` es transitorio. El recibo incluye meta, capability, grants, gasto ejercido, origen de aprobación, evidencia y resultado de verificación. El kernel no importa Stellar ni x402. `authority.js` agrega consumo por grant y trata por separado grants dirigidos a un destinatario; esto respalda, dentro de ese modelo simple, el endurecimiento de v0.1.1 descrito en el changelog.

Esto es una pieza ejecutable y acotada, no un orquestador general. La función `ask` la suministra el host; no hay interfaz de gestión de políticas, persistencia de presupuestos entre operaciones, integración efectiva con Lore ni trabajo prolongado delegado en el código abierto. `history` existe en el objeto de operación pero no se usa en este flujo. La verificación es una función inyectada: el kernel conserva el resultado, pero no determina por sí solo la verdad de una evidencia. Un error del verificador produce `not_verified` con evidencia conservada; una excepción de `perform` produce `failed` sin evidencia, por lo que el recibo solo puede representar lo que el adaptador haya devuelto.

## Lore Plugin y procedencia

Según la documentación, LUS es el programa de investigación sobre criterio acumulado; Lore Plugin lo hace portable y utilizable; Vespi aborda la composición de cuerpos, operaciones, capacidades y autoridad. La dirección publicada es que Vespi se convierta en una skill first-party de Lore Plugin, marcada expresamente como pendiente. Hoy no veo una importación, dependencia o llamada a Lore Plugin en el kernel ni en el demo. El experimento 002 menciona `bora-lore` y deja `loreDigest: null`; eso documenta linaje o contexto de la corrida, no prueba integración del producto. El proyecto también explicita que trabajo de colaboradores no entra por proximidad y excluye RUC-D y Web3 Trust Native de sus insumos de investigación sin permiso.

## Stellar, x402 y los experimentos

El demo `demo/x402` usa paquetes x402 v2 y Stellar testnet para una sola capability: obtener un `marketing-plan` por 0.01 USDC desde un endpoint de referencia local. El servidor protege esa ruta con middleware de pago y devuelve un plan fijo después del settlement. El runner declara un requisito de gasto, hace el primer GET esperando 402, arma la firma, reintenta la solicitud pagada y verifica la transacción por Horizon y cambios de balance de USDC, además de calcular un digest del plan. El ejemplo requiere credenciales, cuentas de testnet, trustlines, fondos, un receptor, facilitator y red; no representa una billetera de producción. La rama de rechazo por falta de autoridad termina antes de acceder al endpoint, aunque el runner exige `CLIENT_SECRET` y receptor configurados incluso para llegar a esa rama.

`experiments/001` registra un intercambio Operator↔Professor en un mismo host y cero intervenciones humanas. El propio registro muestra una corrección: el conteo alegado de 3.804 palabras terminó en 3.822. Las fuentes primarias de ese arbitraje no están dentro de la superficie que inspeccioné; como lector puedo evaluar la transparencia del relato, no repetir el arbitraje. `experiments/002` conserva un recibo exitoso, rechazo de política, rechazo humano, primer settlement no verificado y un brief por plantilla determinista. El recibo exitoso nombra una transacción de testnet y el RUN describe una verificación independiente; sin consultar la cadena no confirmo ese settlement por mi cuenta. El rechazo de política está etiquetado como `self-test: simulated budget_exceeded`, así que no lo leería como una negativa espontánea de un servicio real. El brief publicado es explícitamente una plantilla, no síntesis autoral. El primer fallo conservado ilustra una corrección concreta del verificador: buscaba una operación de pago clásica donde el settlement aparecía como transferencia de token Soroban.

Hay dos artefactos relacionados, pero no idénticos: el RUN 002 describe `compose-launch-brief` y un brief escrito por un runner de esa corrida; el demo incluido actualmente ejecuta `obtain-marketing-plan` y no escribe brief. La documentación del demo ya advierte esta diferencia. El RUN 002 conserva además una ruta absoluta local como procedencia; no sirve como enlace portable al brief.

## Qué pude reproducir

Ejecuté Node `v24.15.0` directamente contra `src/operation.js`, sin red ni archivos escritos. Con una capability de prueba local, observé: sin grant y con respuesta humana negativa, `needs_human_decision` y `exercised: []`; con grant suficiente, `verified` y aprobación `preauthorized`; con un verificador que lanza excepción después de `perform`, `not_verified`, evidencia retenida y razón `verifier error: offline`. Esto comprueba tres transiciones del kernel en esta lectura. No ejecuté `node --test`, porque la selección de archivos autorizados no incluía leer `test/`; por tanto, el dato “16/16 tests” procede del changelog, no de una prueba mía. Tampoco corrí el demo vivo, que exige recursos externos.

## Qué no puedo confirmar y qué examinaría después

No confirmé releases remotas, el resultado 16/16 en el momento de publicación, el settlement en Stellar, la independencia de la verificación de 002, las fuentes primarias de 001, ni que la integración first-party con Lore Plugin exista. Los recibos JSON son evidencia publicada, no una validación criptográfica propia.

La frontera de autoridad económica merece una prueba específica antes de confiar en ella fuera del demo. `x402Capability.required()` declara un precio y `payTo` estáticos para el kernel, mientras `perform()` construye el pago desde los requisitos recibidos en el 402. En el código visible no aparece una comparación explícita de importe, activo, red y destinatario del 402 contra el grant declarado antes de firmar. Quizá las librerías x402 hagan alguna validación, pero no lo establezco a partir de esta lectura. Además, el grant inicial del runner no fija destinatario; la exigencia de destinatario aparece en el requisito estático de la capability. Esta distancia entre requisitos declarados y payload efectivo limita cuánto puedo aceptar el claim de autoridad acotada para el pago real. No afirmo que se haya pagado indebidamente en la corrida publicada.

## Qué confunde y dónde abandonaría

El README principal hace razonable empezar por `node --test`, pero “tests green” es una afirmación de release y no una prueba accesible dentro de los archivos que se me permitió leer. La mezcla de español e inglés es comprensible para mí, aunque términos como `authority`, `capability`, `gate`, `receipt`, “cuerpos” y “RC” requieren aprender el vocabulario del proyecto antes de saber qué es ejecutable. “Vespiqueen” aparece como sujeto de una tesis de cuidado del tiempo sin una definición operativa clara en la superficie. La relación LUS → Lore Plugin → Vespi se entiende conceptualmente, pero un visitante que busque una herramienta instalable puede interpretar “skill first-party” como disponibilidad actual si lee rápido; el texto corrige esa posible lectura.

Para evaluar, seguiría el Nivel 1. Para probar el Nivel 2 abandonaría o postergaría en la lista de requisitos externos: necesito crear/fondear cuentas Stellar testnet, configurar trustlines, conseguir USDC de faucet y confiar en facilitator/red. El README del demo da la secuencia, pero no hay un modo local sin pago que reproduzca la transacción. Como adoptante de producción abandonaría antes: el propio proyecto descarta runtime estable, pagos de producción y una billetera o custodia definitiva. Como lector de evidencia, también me detendría al intentar auditar 001 desde primarios que no están en este repositorio público.

## Dirección que se desprende de la superficie

La siguiente dirección parece ser convertir el kernel y las pruebas de capabilities en una operación delegada más larga, con perfiles de usuario, economía de modelos, escalación justificada y batching que pregunte solo en decisiones que requieren criterio humano. En el horizonte de producto, Vespi aspira a ser una skill de Lore Plugin. En el horizonte experimental, parece querer conservar tanto éxitos como fallos y mantener visibles los límites de cada versión. Es una dirección publicada, no una capacidad que yo haya visto funcionar.

## Alcance exacto de la inspección

Abrí y leí íntegros estos **19 archivos**, y ningún otro contenido de archivo:

- `C:\Vespi\README.md`
- `C:\Vespi\README_es.md`
- `C:\Vespi\CHANGELOG.md`
- `C:\Vespi\docs\GENESIS.md`
- `C:\Vespi\demo\x402\README.md`
- `C:\Vespi\demo\x402\run.js`
- `C:\Vespi\demo\x402\server.js`
- `C:\Vespi\demo\x402\capability.js`
- `C:\Vespi\demo\x402\package.json`
- `C:\Vespi\src\authority.js`
- `C:\Vespi\src\operation.js`
- `C:\Vespi\src\receipt.js`
- `C:\Vespi\experiments\001-operator-professor-loop\RUN.md`
- `C:\Vespi\experiments\002-x402-slice1\RUN.md`
- `C:\Vespi\experiments\002-x402-slice1\receipt-success.json`
- `C:\Vespi\experiments\002-x402-slice1\receipt-rejected-policy.json`
- `C:\Vespi\experiments\002-x402-slice1\receipt-rejected-human.json`
- `C:\Vespi\experiments\002-x402-slice1\receipt-settlement-unverified-FIRST-ATTEMPT.json`
- `C:\Vespi\experiments\002-x402-slice1\brief.md`

Listé nombres en la raíz, `docs/`, `demo/x402/`, `experiments/`, y rutas de archivos de `src/`, `experiments/001` y `experiments/002`. No abrí `experiments/005/`, protocolos, archivos privados, `C:\Claude`, otros proyectos, páginas web ni el directorio `test/`. La única ejecución fue el script temporal pasado por stdin a Node, que importó `src/operation.js`; consulté `node --version`. Esta escritura del informe es la única operación sobre `experiments/005`.
