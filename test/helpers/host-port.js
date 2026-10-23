'use strict';
// K2 host port: the only way out toward an effect. It refuses a call whose `signal` is already
// aborted, which is the interposition the kernel relies on after `perform` returns by any path.
function createHostPort() {
  const calls = [];
  async function port(ctx) {
    calls.push(ctx);
    if (!ctx || !ctx.signal || ctx.signal.aborted) {
      const error = new Error('effect signal is aborted');
      error.code = 'SIGNAL_ABORTED';
      throw error;
    }
    return { ok: true };
  }
  port.calls = calls;
  return port;
}

module.exports = { createHostPort };
