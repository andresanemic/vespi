# Verify Vespi

This guide checks the kernel tests, the recorded x402 receipt and Stellar testnet transactions. It uses the same commands in Windows PowerShell, Windows Command Prompt, macOS and Linux. Use Node.js 24 or later and Git. The x402 demo declares Node.js `>=24`; the kernel itself has no package installation step.

## 1. Clone and enter the repository

```sh
git clone https://github.com/andresanemic/vespi.git
cd vespi
```

You should now be in the repository root, where `README.md`, `src/`, `test/`, `scripts/` and `docs/` are present.

## 2. Check Node.js and run the kernel suite

```sh
node --version
node --test "test/*.test.js"
```

The first command prints your installed Node.js version, which should be `v24` or later. The second runs the kernel suite without installing packages, a wallet, credentials or network access. A successful run ends with a test summary and `fail 0`.

## 3. Inspect the recorded x402 receipt

Open [`demo/x402/receipts/live-testnet-2026-10-02.json`](../demo/x402/receipts/live-testnet-2026-10-02.json) in any text editor. Check `status: "verified"`, `verification.verified: true`, `coverage`, `notCovered: ["external anchor"]`, `anchor.status: "pending"`, and the `digest`. This is the saved receipt for the payment below; it does not claim an external anchor.

## 4. Re-check all listed testnet transactions

This step requires an internet connection. It only reads Horizon; it does not sign, submit or change transactions.

```sh
node scripts/verify-testnet-evidence.mjs
```

When all listed transactions are still available and successful, the final count is `50 of 50 listed transactions are successful on Horizon testnet`. A smaller count or request error means Horizon did not confirm every item during this check. Stellar testnet can reset; the saved receipts and hashes in this repository remain available as the historical record.

## 5. Open example transactions on Horizon

Open these links in a browser. Horizon shows the transaction record, including its success status and ledger. The first two are complementary examples from the evidence set.

- [x402 payment, 0.01 USDC, ledger 4988161](https://horizon-testnet.stellar.org/transactions/abb968e86d8997f6f555c4efe50dd5a70671dc5064b8220a7f2ea221de7650d5)
- [TEMIS agreement record, hash memo, ledger 4988781](https://horizon-testnet.stellar.org/transactions/bd459ea5fea594db726f9ac3728807f3de29779a711f131a9819c32c85f1edd4)
- [Classic payment operation-type probe, ledger 4995969](https://horizon-testnet.stellar.org/transactions/a7b8393c5295acfc445b857a026c016646f56ceb53193ece2ce09eebbf40830f)
- [Soroban asset-contract transfer operation-type probe, ledger 4995970](https://horizon-testnet.stellar.org/transactions/44e0f75295004850dee7f6894d2111124d4c1a4d4e528bb777122878937a7542)

The payment receipt identifies the asset contract as `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`. The demo adapter checks the testnet issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.

The recorded testnet payment and receipt can be checked without running the paid demo. The live demo is a separate testnet exercise that requires a funded testnet account, a trustline, a receiver, credentials and a reachable facilitator. It is not needed to verify the saved evidence.

---

# Verificar Vespi

Esta guía comprueba las pruebas del kernel, el recibo x402 guardado y las transacciones registradas en Stellar testnet. Usa los mismos comandos en Windows PowerShell, Windows Command Prompt, macOS y Linux. Necesitas Node.js 24 o posterior y Git. La demo x402 declara Node.js `>=24`; el kernel no requiere instalar paquetes.

## 1. Clona el repositorio y entra en la carpeta

```sh
git clone https://github.com/andresanemic/vespi.git
cd vespi
```

Debes quedar en la raíz del repositorio, donde están `README.md`, `src/`, `test/`, `scripts/` y `docs/`.

## 2. Comprueba Node.js y corre la suite del kernel

```sh
node --version
node --test "test/*.test.js"
```

El primer comando muestra la versión instalada de Node.js, que debe ser `v24` o posterior. El segundo corre la suite del kernel sin instalar paquetes y sin wallet, credenciales ni conexión a internet. Si termina bien, muestra un resumen con `fail 0`.

## 3. Abre el recibo x402 guardado

Abre [`demo/x402/receipts/live-testnet-2026-10-02.json`](../demo/x402/receipts/live-testnet-2026-10-02.json) en cualquier editor de texto. Comprueba `status: "verified"`, `verification.verified: true`, `coverage`, `notCovered: ["external anchor"]`, `anchor.status: "pending"` y `digest`. Este es el recibo guardado del pago que aparece abajo; no afirma que haya un anclaje externo.

## 4. Vuelve a comprobar las transacciones de testnet

Este paso necesita conexión a internet. Solo lee Horizon; no firma, envía ni cambia transacciones.

```sh
node scripts/verify-testnet-evidence.mjs
```

Si todas las transacciones siguen disponibles y son exitosas, el conteo final será `50 of 50 listed transactions are successful on Horizon testnet`. Un conteo menor o un error de consulta significa que Horizon no confirmó todos los elementos durante esta comprobación. Stellar puede reiniciar la testnet; los recibos y hashes guardados en este repositorio siguen disponibles como registro histórico.

## 5. Abre transacciones de ejemplo en Horizon

Abre estos enlaces en el navegador. Horizon muestra el registro de cada transacción, incluido su estado de éxito y ledger. Las dos primeras son ejemplos complementarios del conjunto de evidencia.

- [Pago x402 de 0,01 USDC, ledger 4988161](https://horizon-testnet.stellar.org/transactions/abb968e86d8997f6f555c4efe50dd5a70671dc5064b8220a7f2ea221de7650d5)
- [Registro de acuerdo de TEMIS con memo de hash, ledger 4988781](https://horizon-testnet.stellar.org/transactions/bd459ea5fea594db726f9ac3728807f3de29779a711f131a9819c32c85f1edd4)
- [Prueba de tipo de operación con pago clásico, ledger 4995969](https://horizon-testnet.stellar.org/transactions/a7b8393c5295acfc445b857a026c016646f56ceb53193ece2ce09eebbf40830f)
- [Prueba de tipo de operación con transferencia de contrato de activo Soroban, ledger 4995970](https://horizon-testnet.stellar.org/transactions/44e0f75295004850dee7f6894d2111124d4c1a4d4e528bb777122878937a7542)

El recibo del pago identifica el contrato del activo como `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`. El adaptador de la demo comprueba el emisor de testnet `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`.

Puedes comprobar el pago registrado y su recibo sin correr la demo pagada. La demo en vivo es una prueba aparte en testnet que requiere una cuenta financiada de testnet, trustline, receptor, credenciales y un facilitador accesible. No hace falta para verificar la evidencia guardada.
