# Pollar payment under the Vespi kernel (demo)

A demo, outside the kernel library like `demo/x402`. It shows the pattern the kernel was built for: a payment is **approved by a person before it happens** and **checked against the public ledger after it**, with a receipt that says what was and was not covered.

Evidence from 25 October 2026, on Stellar mainnet: tx `52759df5db949d6bd9b506de0081f7bddb5254bb374de8f682b5a1e507e37bb2`, ledger 65134379, 0.0001 XLM from a Pollar wallet to a LOBSTR wallet. The receipt is in [`receipts/pollar-52759df5.json`](./receipts/pollar-52759df5.json) and at https://vespi.xyz/receipts/pollar-52759df5.json; the evidence page is https://vespi.xyz/pollar.

## How it works

1. `flow.cjs` creates a kernel operation with **no authority to spend**. The kernel stops at the human gate and asks for approval of exactly one amount and destination.
2. `capability.cjs` waits for the payment. **Pollar executes it in the browser** (its SDK runs there), from the button on https://vespi.xyz/pollar, and the browser reports the transaction hash to this local process.
3. `verify.cjs` does not trust that report. It reads the transaction and its operations on Horizon and checks six things: found, successful, a payment operation exists, the destination matches, the amount matches, the asset is native. Only then does the kernel issue a `verified` receipt. The receipt declares what it did not cover: an external anchor.

## Reading the receipt

- **`at` is when the receipt was issued**, after the ledger was read, not when the person approved. The kernel never calls the payment capability before the gate is approved (`flow.test.cjs`: «gate declined -> payment never awaited»), so approval comes first by construction. The receipt carries `approval: human_gate_approved` and `decidedBy`.
- **Amounts in the authority are in stroops**: 1 XLM = 10,000,000 stroops, so the grant `XLM, max 1000` is 0.0001 XLM, the amount that was paid.
- **`anchor: pending, network: stellar:testnet`** is the kernel's default label for an external anchor that has not been made. This receipt was not anchored; the receipt anchored on mainnet is a different one (digest `71f58fc2…`, tx `2ff744c69fc01c0de2016e45c5f157b0434382572f2dfc997e8e1d4e34af09d7`).
- The receipt does not carry the ledger number or the kernel version; they are in the evidence above (ledger 65134379, kernel 0.1.8).

## Limits

- The approval is a prompt. It is not cryptographically bound to the transaction, and the kernel does not control the browser that pays: it **detects** a mismatch afterwards, it does not prevent it.
- It is one small test (0.0001 XLM) between wallets that belong to the team. It is not third-party evidence and not a security audit.
- Pollar is not part of the kernel library. The page is in the `vespi-meridian` repository (`src/app/pollar/KernelRun.tsx`).

## Run the tests

```
node --test demo/pollar/flow.test.cjs
```

Seven tests, no network and no funds: approved payment with a matching ledger, declined gate (the payment is never awaited), a different amount, a different destination, a failed transaction, an invalid hash, and a human who answers after the kernel's 15-second default (the timeouts are set explicitly: 10 minutes for the gate, 16 for the payment, 60 seconds to verify).

To make a real payment you need a Pollar account, the page open at https://vespi.xyz/pollar and `node demo/pollar/run.cjs`; the gate answer is read from the terminal, or from a `gate.in` file when there is no terminal. That spends real XLM; do not run it without meaning to.

---

## Español

Demo fuera de la biblioteca del kernel, como `demo/x402`. Muestra el patrón para el que se hizo el kernel: un pago **aprobado por una persona antes de ocurrir** y **comprobado contra el ledger público después**, con un recibo que dice qué se cubrió y qué no.

Evidencia del 25 de octubre de 2026 en Stellar mainnet: tx `52759df5db949d6bd9b506de0081f7bddb5254bb374de8f682b5a1e507e37bb2`, ledger 65134379, 0,0001 XLM desde una wallet Pollar a una wallet LOBSTR. El recibo está en [`receipts/pollar-52759df5.json`](./receipts/pollar-52759df5.json) y en https://vespi.xyz/receipts/pollar-52759df5.json; la página de evidencia es https://vespi.xyz/pollar.

**Cómo funciona.** (1) `flow.cjs` crea una operación sin autoridad de gasto; el kernel se detiene en la puerta humana y pide aprobar exactamente un monto y un destino. (2) Pollar ejecuta el pago en el navegador desde el botón de https://vespi.xyz/pollar y el navegador informa el hash a este proceso local. (3) `verify.cjs` no confía en ese informe: lee la transacción y sus operaciones en Horizon y comprueba seis cosas (encontrada, exitosa, hay una operación de pago, destino, monto y activo nativo); solo entonces el kernel emite un recibo `verified`, que declara lo que no cubrió: un ancla externa.

**Límites.** La aprobación es un aviso y no está atada criptográficamente a la transacción; el kernel no controla el navegador que paga: **detecta** una discrepancia después, no la previene. Es una prueba pequeña (0,0001 XLM) entre wallets del equipo, no evidencia de terceros ni una auditoría. Pollar no es parte de la biblioteca del kernel; la página está en el repositorio `vespi-meridian`.

**Pruebas.** `node --test demo/pollar/flow.test.cjs`: siete pruebas, sin red ni fondos.
