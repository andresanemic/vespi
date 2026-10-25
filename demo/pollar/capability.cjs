'use strict';

// Capacidad de pago con Pollar bajo el kernel de Vespi.
// El kernel decide si hay autoridad y abre la puerta; el pago lo ejecuta Pollar en el navegador
// (su SDK no corre en Node). `waitForPayment` entrega lo que el navegador informó; el kernel no
// le cree: la verificación lee el ledger.

function pollarCapability({ destination, amountStroops, waitForPayment }) {
  return {
    id: 'pollar-payment-xlm',
    required: () => ({ spend: [{ asset: 'XLM', amount: String(amountStroops), to: destination }] }),
    perform: async () => {
      let reported;
      try {
        reported = await waitForPayment();
      } catch (err) {
        return { ok: false, error: 'PAYMENT_NOT_REPORTED', reason: String(err && err.message ? err.message : err) };
      }
      const hash = reported && typeof reported.hash === 'string' ? reported.hash : '';
      if (!/^[0-9a-f]{64}$/.test(hash)) return { ok: false, error: 'NO_TX_HASH', reason: 'the browser reported no transaction hash' };
      return { ok: true, output: { txHash: hash }, evidence: { type: 'pollar', network: 'stellar:pubnet', hash, reportedStatus: reported.status || null } };
    },
  };
}

module.exports = { pollarCapability };
