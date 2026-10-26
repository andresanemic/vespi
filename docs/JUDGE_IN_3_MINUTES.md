# Judge Vespi in 3 minutes

Kernel 0.1.8, published on 2026-10-25 ([release](https://github.com/andresanemic/vespi/releases/tag/v0.1.8-kernel)). The commands below pin the Meridian release, which includes the 26 October payment demo; the original kernel release remains available at its tag. Read the [callback migration contract](./HOST_CALLBACKS.md) when adapting a host that uses `this`.

> Five steps, the last optional, the output you should see, and what to look for. Needs Node.js 24 or later. Cloning requires internet; the walkthrough runs offline, with no real money. The first two take about 15 seconds and need no install. Español: [Juzga Vespi en 3 minutos](#juzga-vespi-en-3-minutos).

```sh
git clone --branch meridian-2026-10-26 --depth 1 https://github.com/andresanemic/vespi.git
cd vespi
```

**1. A person approves (about 10 seconds).**

```sh
echo 'Ada: approve' | node examples/walkthrough.js
```

You should see the gate stop first, then the approval, one effect, a separate check and a receipt that names what it did not cover:

```
gate: needs_human_decision (insufficient permission; no effect ran)
human approval [Name: approve]: approval: approved by Ada
effect: ledger note written
observation: note present (separate verifier)
receipt: {"status":"verified","digest":"…","coverage":["effect_present","recipient_matches"],"notCovered":["network_anchor","external anchor"]}
second process: resumes next action publish_summary
```

The `digest` changes on every run. Read `coverage` and `notCovered`: the receipt says what was checked and what was not.

**2. What an agent is not allowed to do (about 5 seconds).**

```sh
node examples/refusal.js
```

```
operation 1: spend 25 NOTE (granted ceiling: 5)
  gate: needs_human_decision (over the granted ceiling; no effect ran)
  person: declined
  effect: none
  receipt: {"status":"needs_human_decision","digest":"…","coverage":[],"notCovered":["external anchor"]}
operation 2: spend 3 NOTE (granted ceiling: 5)
  effect: ledger entry written (inside the grant, no question asked)
  receipt: {"status":"verified","digest":"…","coverage":["effect_present","recipient_matches"],"notCovered":["network_anchor","external anchor"]}
```

The over-limit request leaves a receipt with `coverage: []`: nothing ran. The in-limit one runs and is checked.

**3. Make a real Stellar payment yourself, behind the human gate (about 1 minute, testnet).** Added during HackMeridian on 26 October 2026 and included in the checkout above. Run from the repository root:

```sh
npm --prefix demo/testnet ci
node demo/testnet/pay.cjs
```

The demo funds two fresh testnet accounts with Friendbot (no account, no real money), builds one 1 XLM payment and stops at the gate, showing you that transaction's hash. Answer `n`: the receipt says `needs_human_decision`, nothing was signed. Run it again and answer `y`: only that transaction is signed and sent, the kernel reads it back from Horizon, checks it is the exact transaction you approved (`approvedTxOnLedger`), and prints the stellar.expert link. See [demo/testnet](../demo/testnet/).

**4. Re-verify the real mainnet payment (about 5 seconds, no install).**

```sh
node demo/testnet/pay.cjs --verify-mainnet
```

It reads Stellar mainnet and checks three real transactions: the 0.0001 XLM payment the demo signing capability signed on 26 October 2026 after the kernel gate received a person’s approval for its hash in this demo (tx [`b402c623…d98f`](https://stellar.expert/explorer/public/tx/b402c62307e0c50fb859969a21a8e1277ed1c29899b19f79ee6f557f9a93d98f): prevention on mainnet), the Pollar payment of 25 October (six checks) and the receipt anchor (digest as hash memo and `manage_data`). Read-only: it does not replay the approval or the payment.

**5. Optional: the whole suite (1 to 2 minutes more).**

```sh
(cd demo/x402 && npm ci)
node --test test/*.test.js
```

The command above passes 1,319 tests, with zero failures, skipped tests or TODOs (rerun on 26 October 2026). The frozen [0.1.8 suite result](./SUITE_RESULT_0.1.8.txt) records the same root-suite count. The 26 October payment demo adds eight offline cases: run `node --test demo/testnet/testnet.test.cjs` from the root, with no install. The combined count is 1,327. The x402 demo records 86 additional cases separately.

**The working pieces.** The kernel is a source library; the offline walkthrough shows its gate and receipts. The Stellar SDK and signing live in the demo adapters, outside `src/`. The Meridian checkout includes the testnet payment demo and three mainnet transactions from 25–26 October: the Pollar payment, a separate receipt anchor, and the payment signed after a person approved its hash. Hive is the future app; its web POC shows fictional data. The host and injected ports remain the trust boundary. See the [threat model](./THREAT_MODEL.md) and [why Stellar](./WHY_STELLAR.md).

---

# Juzga Vespi en 3 minutos

Kernel 0.1.8, publicado el 2026-10-25 ([release](https://github.com/andresanemic/vespi/releases/tag/v0.1.8-kernel)). Los comandos siguientes fijan el release Meridian, que incluye la demo de pago del 26 de octubre; el release original del kernel conserva su tag. Consulta el [contrato de migración de callbacks](./HOST_CALLBACKS.md) si adaptas un host que dependa de `this`.

> Cinco pasos, el último opcional, la salida que deberías ver y qué mirar. Necesita Node.js 24 o posterior. La clonación requiere internet; el recorrido funciona sin red y sin dinero real. Los dos primeros toman unos 15 segundos y no instalan nada.

```sh
git clone --branch meridian-2026-10-26 --depth 1 https://github.com/andresanemic/vespi.git
cd vespi
```

**1. Una persona aprueba (unos 10 segundos).**

```sh
echo 'Ada: approve' | node examples/walkthrough.js
```

Primero la puerta se detiene, luego la aprobación, un efecto, una revisión separada y un recibo que nombra lo que no cubrió (la salida es la de arriba). El `digest` cambia en cada corrida. Lee `coverage` y `notCovered`: el recibo dice qué se comprobó y qué no.

**2. Lo que un agente no puede hacer (unos 5 segundos).**

```sh
node examples/refusal.js
```

La petición fuera del límite deja un recibo con `coverage: []`: no corrió nada. La que está dentro del límite corre y se comprueba (la salida es la de arriba).

**3. Haz tú un pago real en Stellar, detrás de la puerta humana (alrededor de 1 minuto, testnet).** Agregado durante HackMeridian el 26 de octubre de 2026 e incluido en la copia de arriba. Ejecuta desde la raíz del repositorio:

```sh
npm --prefix demo/testnet ci
node demo/testnet/pay.cjs
```

La demo fondea dos cuentas nuevas de testnet con Friendbot (sin cuenta, sin dinero real), arma un pago de 1 XLM y se detiene en la puerta mostrándote el hash de esa transacción. Responde `n`: el recibo dice `needs_human_decision` y no se firmó nada. Vuelve a correrla y responde `y`: solo esa transacción se firma y se envía, el kernel la relee desde Horizon, comprueba que es exactamente la que aprobaste (`approvedTxOnLedger`) e imprime el enlace de stellar.expert. Ver [demo/testnet](../demo/testnet/).

**4. Re-verifica el pago real en mainnet (unos 5 segundos, sin instalar).**

```sh
node demo/testnet/pay.cjs --verify-mainnet
```

Lee Stellar mainnet y comprueba tres transacciones reales: el pago de 0,0001 XLM que la capacidad de firma de la demo firmó el 26 de octubre de 2026 después de que la puerta del kernel recibiera la aprobación de una persona para su hash (tx [`b402c623…d98f`](https://stellar.expert/explorer/public/tx/b402c62307e0c50fb859969a21a8e1277ed1c29899b19f79ee6f557f9a93d98f): prevención en mainnet), el pago Pollar del 25 de octubre (seis comprobaciones) y el ancla del recibo (digest como memo hash y `manage_data`). Solo lectura: no repite la aprobación ni el pago.

**5. Opcional: la suite completa (1 a 2 minutos más).**

```sh
(cd demo/x402 && npm ci)
node --test test/*.test.js
```

El comando de arriba aprueba 1.319 pruebas, sin fallos, omisiones ni TODOs (reejecutado el 26 de octubre de 2026). El [resultado congelado de 0.1.8](./SUITE_RESULT_0.1.8.txt) registra la misma cifra de la suite raíz. La demo de pago del 26 de octubre añade ocho casos offline: ejecuta `node --test demo/testnet/testnet.test.cjs` desde la raíz, sin instalar. La cifra combinada es 1.327. La demo x402 registra otros 86 casos por separado.

**Las piezas que funcionan.** El kernel es una biblioteca fuente; el recorrido offline muestra su puerta y recibos. El SDK de Stellar y la firma viven en los adaptadores de demo, fuera de `src/`. La copia Meridian incluye la demo de pago testnet y tres transacciones mainnet del 25–26 de octubre: el pago Pollar, un ancla de otro recibo y el pago firmado después de que una persona aprobara su hash. Hive es la app futura; su POC web muestra datos ficticios. El host y los puertos inyectados conservan la frontera de confianza. Ver el [modelo de amenazas](./THREAT_MODEL.md#modelo-de-amenazas) y [por qué Stellar](./WHY_STELLAR.md#por-qué-stellar).
