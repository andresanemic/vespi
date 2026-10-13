# Judge Vespi in 3 minutes

> Three commands, the third optional, the output you should see, and what to look for. Needs Node.js 24 or later. Cloning requires internet; the walkthrough runs offline, with no real money. The first two take about 15 seconds and need no install. Español: [Juzga Vespi en 3 minutos](#juzga-vespi-en-3-minutos).

```sh
git clone --branch v0.1.7-kernel --depth 1 https://github.com/andresanemic/vespi.git
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

**3. Optional: the whole suite (1 to 2 minutes more).**

```sh
(cd demo/x402 && npm ci)
node --test test/*.test.js
```

At this cut: `tests 1224`, `pass 1200`, `fail 0`, `todo 24`. The 24 `todo` are boundaries we declare and do not claim. Without the first line, four tests that need the x402 demo's dependencies fail; that is expected, and it is why that line is there.

**What we trimmed, in one place.** This cut does not include: the installable app (Vespi Hive, shown only as a proof of concept with fictional data), an external anchor for kernel receipts, an independent security audit, real money on mainnet, or the bridge that uses the real Stellar SDK inside the kernel. It has been reviewed with our own Claude Code superreviews, not audited. Vespi Hive will be built with Vespi; this is a development plan, not part of the released kernel. See the [threat model](./THREAT_MODEL.md) and [why Stellar](./WHY_STELLAR.md).

---

# Juzga Vespi en 3 minutos

> Tres comandos, el tercero opcional, la salida que deberías ver y qué mirar. Necesita Node.js 24 o posterior. La clonación requiere internet; el recorrido funciona sin red y sin dinero real. Los dos primeros toman unos 15 segundos y no instalan nada.

```sh
git clone --branch v0.1.7-kernel --depth 1 https://github.com/andresanemic/vespi.git
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

**3. Opcional: la suite completa (1 a 2 minutos más).**

```sh
(cd demo/x402 && npm ci)
node --test test/*.test.js
```

En este corte: `tests 1224`, `pass 1200`, `fail 0`, `todo 24`. Los 24 `todo` son límites que declaramos y no afirmamos. Sin la primera línea, cuatro pruebas que necesitan las dependencias del demo x402 fallan; es lo esperado y por eso está esa línea.

**Lo que recortamos, en un solo lugar.** Este corte no incluye: la app instalable (Vespi Hive, mostrada solo como prueba de concepto con datos ficticios), un ancla externa para los recibos del kernel, una auditoría de seguridad independiente, dinero real en mainnet ni el puente que usa el SDK real de Stellar dentro del kernel. Fue revisado con nuestras propias superreviews de Claude Code, no auditado. Vespi Hive será construida con Vespi; es un plan de desarrollo, no parte del kernel publicado. Ver el [modelo de amenazas](./THREAT_MODEL.md#modelo-de-amenazas) y [por qué Stellar](./WHY_STELLAR.md#por-qué-stellar).
