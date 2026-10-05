# Puente x402 recortado — spec corta (2026-10-05)

## Restricción de diseño

El puente vive en `demo/x402/` (tiene `package.json` con el SDK; `src/` sigue sin dependencias). Nada del puente entra a `src/`. El ejemplo construye una aplicación x402 desde el contrato del kernel y prueba contra el SDK real con red contenida por fixtures (ledger inyectado; la corrida de ejemplo en testnet, sin dinero real, viene después de la revisión).

## Comportamiento (todo con prueba roja primero)

1. Preparar: la oferta exacta se selecciona y solo los campos admitidos entran a los términos; lo demás es `INVALID_SPEC`.
2. Inspeccionar: la autorización se lee una vez en una copia cerrada; lo que se firma es lo leído. Ventana de validez real leída de un lector de ledger inyectable.
3. Enviar una sola vez: concurrentes del mismo efecto pagan una vez; el segundo es duplicado bloqueado, nunca reenvío.
4. Verificar: el veredicto lo da el puerto de liquidación contra el ledger; un verificador hostil, colgado o mentiroso nunca verifica.
5. Claims store explícito del host, sin default silencioso; reservas pendientes que ya no pueden enviarse se eliminan con diseño de caída escrito.
6. Cuerpo del RPC acotado por tamaño y cancelable; el aborto se revalida al regresar y se propaga durante toda la lectura.
7. Recibo sellado sin texto del puerto ni del host; catálogo cerrado de códigos.

## Criterio de entrada (lo revisa Fludge)

Ronda adversarial propia del revisor + repetición de estas pruebas + diff leído arreglo por arreglo. Veredicto: entra / entra con arreglos / no entra. Una vía de elusión de autoridad vigente = no entra, y se entrega la versión recortada que sí pase.
