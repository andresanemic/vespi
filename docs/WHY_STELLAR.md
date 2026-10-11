# Why Stellar

> What the chain adds to a receipt, and what it does not. Español: [Por qué Stellar](#por-qué-stellar).

**The problem.** A receipt that lives only in the operator's database proves what the operator says it proved. A judge, an auditor or a counterparty cannot tell whether it was edited or backdated.

**What Stellar adds.** The SHA-256 digest of a receipt can be written to a public ledger. Anyone can then check that this exact receipt existed at that ledger close and has not changed, without trusting the operator. Stellar makes that cheap and quick enough to do for every operation: a base fee of 100 stroops (0.00001 XLM) and a ledger close of about five seconds, according to the Stellar documentation. It is also where agent payments settle (x402, USDC).

**What exists today.** The kernel receipt carries an anchor slot, and it declares `external anchor` in `notCovered` until one is made. Fifty transactions on Stellar testnet are saved and were read back from Horizon with zero discrepancies, and TEMIS anchors on testnet. The x402 payment contract is tested with synthetic ports; the bridge that uses the real Stellar SDK is deferred. Everything is testnet with fictional data and no real money.

**What the chain does not verify.** That the content of a receipt is true, who approved it, or that the effect really happened. The chain proves existence and integrity at a moment in time, not truth. Those stay with the host and the separate verifier.

**Next.** Completing the external anchor for kernel receipts is the first thing this cut leaves for later.

---

# Por qué Stellar

> Qué le suma la cadena a un recibo y qué no.

**El problema.** Un recibo que vive solo en la base de datos de quien opera prueba lo que ese operador dice que probó. Un juez, un auditor o la contraparte no pueden saber si fue editado o fechado hacia atrás.

**Qué suma Stellar.** El digest SHA-256 de un recibo se puede escribir en un libro mayor público. Cualquiera puede entonces comprobar que ese recibo exacto existía en ese cierre de ledger y no ha cambiado, sin confiar en quien opera. Stellar lo hace lo bastante barato y rápido para hacerlo en cada operación: una comisión base de 100 stroops (0,00001 XLM) y un cierre de ledger de unos cinco segundos, según la documentación de Stellar. También es donde se liquidan los pagos de agentes (x402, USDC).

**Qué existe hoy.** El recibo del kernel lleva un espacio para el ancla y declara `external anchor` en `notCovered` hasta que se haga una. Hay cincuenta transacciones en la testnet de Stellar guardadas y releídas desde Horizon con cero discrepancias, y TEMIS ancla en testnet. El contrato de pago x402 está probado con puertos sintéticos; el puente que usa el SDK real de Stellar está diferido. Todo es testnet con datos ficticios y sin dinero real.

**Qué no verifica la cadena.** Que el contenido de un recibo sea verdadero, quién lo aprobó o que el efecto haya ocurrido de verdad. La cadena prueba existencia e integridad en un momento, no verdad. Eso sigue en manos del host y del verificador separado.

**Lo siguiente.** Completar el ancla externa de los recibos del kernel es lo primero que este corte deja para después.
