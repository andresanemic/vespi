# Why Stellar

> What the chain adds to a receipt, and what it does not. Español: [Por qué Stellar](#por-qué-stellar).

**The problem.** A receipt that lives only in the operator's database proves what the operator says it proved. A judge, an auditor or a counterparty cannot tell whether it was edited or backdated.

**What Stellar adds.** The SHA-256 digest of a receipt can be written to a public ledger. Anyone can then check that this exact receipt existed at that ledger close and has not changed, without trusting the operator. Stellar makes that cheap and quick enough to do for every operation: a base fee of 100 stroops (0.00001 XLM) and a ledger close of about five seconds, according to the Stellar documentation. It is also where agent payments settle (x402, USDC).

**What exists today.** Fifty recorded Stellar testnet transactions were read back from Horizon, and the x402 adapter uses the Stellar SDK outside the kernel library. Three real mainnet transactions from 25–26 October 2026 demonstrate the Pollar payment (`52759df5…`), the anchor of a separate receipt (`2ff744c6…`), and the payment signed only after a person approved its hash (`b402c623…`). The Pollar browser flow checks the result after payment; the integrated signing flow controls the signing step. [Run the demo and read all three transactions](../demo/testnet/).

**What the chain does not verify.** That the content of a receipt is true, who approved it, or that the effect really happened. The chain proves existence and integrity at a moment in time, not truth. Those stay with the host and the separate verifier.

**Next.** A proposed Pollar + Vespi pilot for agent-to-agent payments: Pollar agent workflows and builders combining both tools, with approved payments and receipts checked against the ledger.

---

# Por qué Stellar

> Qué le suma la cadena a un recibo y qué no.

**El problema.** Un recibo que vive solo en la base de datos de quien opera prueba lo que ese operador dice que probó. Un juez, un auditor o la contraparte no pueden saber si fue editado o fechado hacia atrás.

**Qué suma Stellar.** El digest SHA-256 de un recibo se puede escribir en un libro mayor público. Cualquiera puede entonces comprobar que ese recibo exacto existía en ese cierre de ledger y no ha cambiado, sin confiar en quien opera. Stellar lo hace lo bastante barato y rápido para hacerlo en cada operación: una comisión base de 100 stroops (0,00001 XLM) y un cierre de ledger de unos cinco segundos, según la documentación de Stellar. También es donde se liquidan los pagos de agentes (x402, USDC).

**Qué existe hoy.** Cincuenta transacciones testnet de Stellar guardadas se releyeron desde Horizon, y el adaptador x402 usa el SDK de Stellar fuera de la biblioteca del kernel. Tres transacciones reales mainnet del 25–26 de octubre de 2026 demuestran el pago Pollar (`52759df5…`), el ancla de otro recibo (`2ff744c6…`) y el pago firmado solo después de que una persona aprobara su hash (`b402c623…`). El flujo Pollar en navegador comprueba el resultado después del pago; el flujo de firma integrada controla el paso de firma. [Ejecuta la demo y relee las tres transacciones](../demo/testnet/).

**Qué no verifica la cadena.** Que el contenido de un recibo sea verdadero, quién lo aprobó o que el efecto haya ocurrido de verdad. La cadena prueba existencia e integridad en un momento, no verdad. Eso sigue en manos del host y del verificador separado.

**Lo siguiente.** Un piloto propuesto Pollar + Vespi para pagos entre agentes: los flujos de agentes de Pollar y quienes combinen ambas herramientas, con pagos aprobados y recibos contrastados con el ledger.