'use strict';

// Pago real en mainnet con Pollar bajo el kernel de Vespi.
//   node run.cjs            -> abre el servidor local y espera
// Una persona abre http://127.0.0.1:3790, entra con Pollar, y aquí en la terminal abre la puerta.
// Nada se paga hasta que la puerta se aprueba. Solo se escribe el recibo en receipts/.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { runPollarPayment } = require('./flow.cjs');

const DESTINATION = 'GDS6AO6UEHXO6SFG7R4HQS5KN7RMFUPMAQLHJA7CD7ZFNELWACINCO36';
const AMOUNT_STROOPS = '1000'; // 0.0001 XLM
const AMOUNT_XLM = '0.0001';
const PORT = 3790;
const WAIT_MS = 15 * 60 * 1000;

const state = { approved: false, reported: null };
let resolveReport;
let reportPromise;
function newAttempt() {
  state.approved = false;
  state.reported = null;
  reportPromise = new Promise((resolve) => { resolveReport = resolve; });
}
newAttempt();

// La pagina vive en https://vespi.xyz/pollar (origen aprobado en Pollar) y habla con este proceso local.
const ALLOWED_ORIGINS = new Set(['https://vespi.xyz', 'https://www.vespi.xyz']);
let gateOpenedAt = 0;
const seenOrigins = new Set();

async function findHash(wallet) {
  const r = await fetch(`https://horizon.stellar.org/accounts/${wallet}/payments?order=desc&limit=5`);
  if (!r.ok) return '';
  const recs = (await r.json())._embedded.records;
  const hit = recs.find((o) => o.type === 'payment' && o.to === DESTINATION && o.asset_type === 'native'
    && o.amount === '0.0001000' && Date.parse(o.created_at) >= gateOpenedAt - 5000);
  return hit ? hit.transaction_hash : '';
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  const ua = String(req.headers['user-agent'] || '').slice(-60);
  if (!seenOrigins.has(`${req.method} ${origin} ${ua}`)) { seenOrigins.add(`${req.method} ${origin} ${ua}`); console.log(`[pedido] ${req.method} ${req.url} desde ${origin || '(sin origin)'} | ${ua}`); }
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    res.setHeader('access-control-allow-private-network', 'true');
    res.setHeader('vary', 'origin');
  }
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Vespi kernel (Pollar demo). The payment page is https://vespi.xyz/pollar; keep this process running and open that page in your browser.');
  }
  if (req.method === 'GET' && req.url === '/state') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ approved: state.approved, destination: DESTINATION, amount: AMOUNT_XLM }));
  }
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
    req.on('end', async () => {
      try {
        if (!state.approved) throw new Error('the gate is not open');
        const data = JSON.parse(body);
        let hash = String(data.hash || '');
        if (!/^[0-9a-f]{64}$/.test(hash) && /^G[A-Z2-7]{55}$/.test(String(data.wallet || ''))) hash = await findHash(data.wallet);
        state.reported = { hash, status: String(data.status || '') };
        resolveReport(state.reported);
        res.writeHead(200).end('ok');
      } catch (e) { res.writeHead(400).end('bad request'); }
    });
    return;
  }
  res.writeHead(404).end();
});

// Sin terminal interactiva (corrida en segundo plano), la respuesta de la puerta se lee de gate.in:
// una persona, o quien opera por ella, escribe y/n en ese archivo. Sin respuesta, la puerta sigue cerrada.
function ask(question) {
  if (!process.stdin.isTTY) {
    const file = path.join(__dirname, 'gate.in');
    try { fs.unlinkSync(file); } catch {}
    console.log(question + '(esperando y/n en gate.in)');
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        let text = '';
        try { text = fs.readFileSync(file, 'utf8').trim(); } catch { return; }
        if (!text) return;
        clearInterval(timer);
        resolve(text);
      }, 500);
    });
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

async function attempt() {
  newAttempt();
  const res = await runPollarPayment({
    destination: DESTINATION,
    amountStroops: AMOUNT_STROOPS,
    ask: async (reqs) => {
      const need = reqs.map((r) => `${r.amount} stroops (${AMOUNT_XLM} XLM) de ${r.asset} a ${r.to}`).join(', ');
      const a = await ask(`PUERTA DE VESPI. Autorizar en MAINNET el pago de ${need}? [y/N] `);
      if (a.trim().toLowerCase() !== 'y') return { approved: false };
      state.approved = true;
      gateOpenedAt = Date.now();
      console.log('Puerta abierta. En el navegador, pulsa "Pagar".');
      return { approved: true, by: 'andres' };
    },
    waitForPayment: () => Promise.race([
      reportPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout waiting for the browser')), WAIT_MS)),
    ]),
  });
  fs.mkdirSync(path.join(__dirname, 'receipts'), { recursive: true });
  const file = path.join(__dirname, 'receipts', `pollar-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify({ status: res.status, output: res.output, receipt: res.receipt }, null, 2));
  console.log(JSON.stringify({ status: res.status, output: res.output }, null, 2));
  console.log(`Recibo guardado en ${file}`);
  return res;
}

// El servidor sigue vivo entre intentos: cada intento es una operacion nueva con su propia puerta,
// y solo se detiene cuando una operacion termina verificada o tras una puerta rechazada.
async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  console.log(`Servidor local en http://127.0.0.1:${PORT} (la pagina esta en https://vespi.xyz/pollar).`);
  for (;;) {
    const res = await attempt();
    if (res.status === 'verified') break;
    console.log('Intento sin pago verificado; se abre una operacion nueva con la puerta cerrada.');
  }
  server.close();
}

if (require.main === module) main().catch((e) => { console.error('FALLO: ' + e.message); process.exit(1); });
