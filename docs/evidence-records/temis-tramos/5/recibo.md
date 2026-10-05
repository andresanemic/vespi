# Recibo del tramo 5: $TEMIS emitido en testnet (2026-10-03)

Escrito por el coordinador. Instrucción de Andrés que lo origina: «crea el token $TEMIS para el MVP». Es una decisión de Andrés, dueño del proyecto, que cambia lo que dice el whitepaper §15 («no en la primera versión»): el estudio de tokenomics con el marco RUC-D concluyó que hoy el problema económico de TEMIS no está medido, y por eso $TEMIS se emite como **experimento de mecánica**, solo en testnet, sin valor, sin precio, sin liquidez, sin venta y sin promesas. La aceptación de Francisco Toro solo es necesaria para sus tramos reales en mainnet, que no existen.

## Qué se hizo

Activo clásico `TEMIS` en la testnet de Stellar, emisor `GD43YB5NYDRB652XM5XA7CYYUC2FUEAKLOHXZV6CSUQPBXNWMEHKED2S`. Oferta fija de 100.000.000,0000000 TEMIS, emitida una sola vez a una cuenta distribuidora y repartida por cubetas, con la emisora bloqueada al final (peso maestro y umbrales en cero, sin firmantes), sin banderas de autorización ni clawback. Las cubetas viven en cuentas distintas y se pueden leer en Horizon: tesorería 25 %, ecosistema 35 %, liquidez 10 % (reservada, sin pool ni ofertas), asesores 10 %, contingencia 5 % y fundadores 15 %, repartidos 50/50 entre la cuenta de Andrés (7,5 %) y una ranura de prueba para Francisco (7,5 %), cada una con vesting: cliff de 12 meses y 36 tramos mensuales, como balances reclamables con respaldo de la tesorería a 180 días. Una prueba de vesting con desbloqueo a los 4 minutos: el reclamo temprano falló en la red (`claimClaimableBalanceCannotClaim`, transacción `baeda1a2…`) y el reclamo posterior funcionó (`574bbbba…`).

## Evidencia

| Prueba | Resultado |
|---|---|
| Emisión completa en testnet | 101 transacciones más el reclamo de la prueba; manifiesto en `token.json` |
| Verificador independiente (`node scripts/token-verify.mjs`, solo lee Horizon) | verificado: emisora bloqueada, banderas en cero, oferta 100.000.000, saldos por cubeta, 72 balances de vesting, la emisora sin saldo propio |
| Suite del proyecto | 153 tests, 0 fallos (135 anteriores más los del token y sus defectos hallados al ejecutarlo en vivo) |

Defectos que solo aparecieron al ejecutarlo en vivo y se cerraron con la prueba primero: permisos heredables de la carpeta privada en Windows; rename atómico que Windows rechaza un instante; carga de llaves al reanudar; bucle de paginación (Horizon entrega siempre un enlace `next`); decodificación del resultado de una operación fallida desde `result_xdr`; hora de un predicado como la entrega Horizon (`abs_before` ISO y `abs_before_epoch`); registro del activo como página y bandera `auth_clawback_enabled`; y el desbloqueo de la demo contado desde su creación y no desde el inicio del calendario. Un primer intento, con otro emisor, se descartó porque la demo salió con el desbloqueo ya vencido; quedó guardado fuera del repositorio.

## Lo que no dice este recibo

No hay precio, liquidez, venta ni mercado. No se creó un pool ni una oferta. La cuenta `francisco` es una ranura de prueba; los tramos reales de Francisco solo existen en mainnet cuando él los acepte por escrito. La testnet se reinicia unas veces al año (la próxima, según la documentación de Stellar, en diciembre de 2026): este manifiesto y estos hashes son el registro duradero y el script permite volver a emitir. No se publicó ningún `stellar.toml` (solo existe un borrador). Nada de esto se ejecuta en mainnet ni abre una venta pública; eso exige abogado y la palabra de Andrés. Las llaves de las cuentas de prueba viven fuera del repositorio, en la carpeta privada del usuario, y no se publican.
