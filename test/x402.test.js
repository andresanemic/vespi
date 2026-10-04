'use strict';
// K4b TDD (RED first): the x402 paid-effect contract promoted into the kernel with injected ports.
// Zero dependencies: node:test + node:assert/strict only. No SDK, no network, no demo import.
// The ports below are simulated fakes with counters; they are not a payment, not a network and
// not evidence about Stellar. Group 24 of the design covers the reference bridge separately.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { createOperation } = require('../src/operation.js');
const { verifyReceipt } = require('../src/receipt.js');
const { resumeFromReceipts } = require('../src/continuity.js');
const { buildReceipt } = require('../src/receipt.js');

const SRC_DIR = path.join(__dirname, '..', 'src');

function loadKernel() {
  return require('../src/x402.js');
}

// --- deterministic vectors (synthetic: an opaque authorization, a declared test hash, 64 "a") ---

const RAW_URL = 'https://example.test/api?service=marketing-plan';
const CANONICAL_URL = new URL(RAW_URL).toString();
const AUTHORIZATION = 'PUBLIC-AUTH';
const AUTH_DIGEST = createHash('sha256').update(AUTHORIZATION, 'utf8').digest('hex');
const TX_HASH = 'a'.repeat(64);
const CLOCK = '2040-01-01T00:00:00.000Z';
const CLOCK_MS = Date.parse(CLOCK);
const BODY = {
  title: 'Queen Marketing Plan',
  summary: 'A 90-day plan.',
  deliverables: ['Landing page variants', 'Outreach sequence'],
  nextSteps: ['Launch week 1 campaign'],
};
const PLAN_DIGEST = createHash('sha256').update(JSON.stringify(BODY), 'utf8').digest('hex');

function spec(over = {}) {
  return {
    id: 'x402-marketing-plan',
    url: RAW_URL,
    method: 'GET',
    network: 'stellar:testnet',
    asset: 'TOKEN',
    grantAsset: 'USDC:TOKEN',
    payer: 'PAYER',
    payTo: 'RECIPIENT',
    amount: '100000',
    maxTimeoutSeconds: 300,
    ...over,
  };
}

function offer(over = {}) {
  return {
    scheme: 'exact',
    network: 'stellar:testnet',
    asset: 'TOKEN',
    payTo: 'RECIPIENT',
    amount: '100000',
    maxTimeoutSeconds: 300,
    extra: { areFeesSponsored: true, paymentFlow: 'authorization' },
    ...over,
  };
}

function paymentRequired(over = {}) {
  return { x402Version: 2, resource: { url: CANONICAL_URL }, accepts: [offer()], ...over };
}

function grant(over = {}) {
  return { asset: 'USDC:TOKEN', maxAmount: '500000', to: 'RECIPIENT', ...over };
}

function authority(over = {}) {
  return { spend: [grant()], ...over };
}

// --- simulated ports: every one counts and records the order it was called in ---

function fakePorts(over = {}) {
  const trace = [];
  const calls = {
    discover: 0, prepare: 0, inspect: 0, send: 0, readBody: 0,
    validateOutput: 0, verifySettlement: 0, reserveEffect: 0, claimTransaction: 0,
  };
  const seen = [];
  const ports = {
    trace,
    calls,
    seenRequests: seen,
    http: {
      async discover(request) {
        calls.discover += 1;
        trace.push('discover');
        seen.push(request);
        if (over.discover) return over.discover(request);
        return { status: 402, paymentRequired: paymentRequired({ resource: { url: request.url } }) };
      },
      async sendPaid(request) {
        calls.send += 1;
        trace.push('send');
        seen.push(request);
        if (over.sendPaid) return over.sendPaid(request);
        return {
          status: 200,
          settlement: { success: true, transaction: TX_HASH, payer: 'PAYER', network: 'stellar:testnet', amount: '100000' },
          readBody: async () => {
            calls.readBody += 1;
            trace.push('body');
            if (over.readBody) return over.readBody();
            return BODY;
          },
        };
      },
    },
    signer: {
      async prepare(request) {
        calls.prepare += 1;
        trace.push('prepare');
        seen.push(request);
        if (over.prepare) return over.prepare(request);
        return { authorization: AUTHORIZATION };
      },
    },
    async inspectPrepared(authorization, request) {
      calls.inspect += 1;
      trace.push('inspect');
      seen.push({ authorization, ...request });
      if (over.inspectPrepared) return over.inspectPrepared(authorization, request);
      return {
        verified: true,
        authDigest: AUTH_DIGEST,
        effect: { network: 'stellar:testnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000' },
        checks: { prepared: true, invocation: true, authorization: true },
        reason: 'prepared transaction matches declared effect',
      };
    },
    async verifySettlement(evidence, request) {
      calls.verifySettlement += 1;
      trace.push('verifySettlement');
      seen.push({ evidence, ...request });
      if (over.verifySettlement) return over.verifySettlement(evidence, request);
      return {
        verified: true,
        checks: { invocation: true, transfer: true, payer: true, source: true, exactAmount: true },
        reason: 'settlement matches exact declared effect',
      };
    },
    validateOutput(body) {
      calls.validateOutput += 1;
      trace.push('validateOutput');
      if (over.validateOutput) return over.validateOutput(body);
      // The same shape the reference bridge checks: a marketing plan, not any JSON at all.
      const shaped = body !== null && typeof body === 'object' && !Array.isArray(body)
        && typeof body.title === 'string' && body.title.length > 0
        && typeof body.summary === 'string' && body.summary.length > 0
        && Array.isArray(body.deliverables) && body.deliverables.every((item) => typeof item === 'string')
        && Array.isArray(body.nextSteps) && body.nextSteps.every((item) => typeof item === 'string');
      if (!shaped) return { ok: false };
      return { ok: true, output: body, digest: createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex') };
    },
  };
  // A simulated claims store, always present and always fresh, so each test starts with empty
  // sets. Its counters and order are observable like every other port.
  const inner = over.claims || null;
  ports.claims = {
    reserveEffect(key) {
      calls.reserveEffect += 1;
      trace.push('reserve');
      seen.push({ reserveEffect: key });
      if (inner) return inner.reserveEffect(key);
      return over.reserveEffect ? over.reserveEffect(key) : 'claimed';
    },
    claimTransaction(network, txHash) {
      calls.claimTransaction += 1;
      trace.push('claimTransaction');
      seen.push({ claimTransaction: { network, txHash } });
      if (inner) return inner.claimTransaction(network, txHash);
      return over.claimTransaction ? over.claimTransaction(network, txHash) : 'claimed';
    },
  };
  return ports;
}

function runIo(over = {}) {
  return { now: () => CLOCK_MS, ...over };
}

// =====================================================================================
// Group A — exports, spec validation, port validation, import hygiene (cases 1 and 2)
// =====================================================================================

test('K4-A1 the contract exports exactly createX402Payment, selectX402Terms and createMemoryPaymentClaims', () => {
  const kernel = loadKernel();
  assert.deepEqual(Object.keys(kernel).sort(), ['createMemoryPaymentClaims', 'createX402Payment', 'selectX402Terms']);
});

test('K4-A2 a payment keeps the declared effect, returns fresh spend copies and refuses to widen them', () => {
  const payment = loadKernel().createX402Payment(spec(), fakePorts());
  assert.equal(typeof payment.id, 'string');
  assert.ok(payment.id.length > 0);
  const first = payment.required();
  const second = payment.required();
  assert.deepEqual(first, { spend: [{ asset: 'USDC:TOKEN', amount: '100000', to: 'RECIPIENT' }] });
  assert.notEqual(first.spend[0], second.spend[0], 'required() must not hand out a shared object');
  first.spend[0].amount = '999999999';
  assert.equal(payment.required().spend[0].amount, '100000');
  assert.equal(typeof payment.run, 'function');
});

test('K4-A3 a spec that is not a plain declared shape is refused with a fixed code and no I/O', () => {
  const { createX402Payment } = loadKernel();
  const ports = fakePorts();
  const cases = {
    'not an object': null,
    'missing id': spec({ id: undefined }),
    'empty id': spec({ id: '' }),
    'long id': spec({ id: 'x'.repeat(513) }),
    'missing url': spec({ url: undefined }),
    'unparseable url': spec({ url: 'not-a-url' }),
    'url over 512': spec({ url: `https://example.test/${'a'.repeat(520)}` }),
    'url with credentials': spec({ url: 'https://user:pass@example.test/api' }),
    'url with fragment': spec({ url: 'https://example.test/api#frag' }),
    'plain http off localhost': spec({ url: 'http://example.test/api' }),
    'method not GET': spec({ method: 'POST' }),
    'missing network': spec({ network: '' }),
    'missing asset': spec({ asset: undefined }),
    'missing grantAsset': spec({ grantAsset: '' }),
    'missing payer': spec({ payer: '' }),
    'missing payTo': spec({ payTo: '' }),
    'missing window': spec({ maxTimeoutSeconds: undefined }),
    'window 0': spec({ maxTimeoutSeconds: 0 }),
    'window negative': spec({ maxTimeoutSeconds: -1 }),
    'window fraction': spec({ maxTimeoutSeconds: 1.5 }),
    'window as string': spec({ maxTimeoutSeconds: '300' }),
    'window 301': spec({ maxTimeoutSeconds: 301 }),
  };
  for (const [label, bad] of Object.entries(cases)) {
    assert.throws(
      () => createX402Payment(bad, ports),
      (err) => err instanceof Error && err.code === 'VESPI_X402_INVALID_SPEC' && !/undefined|null/.test(err.message),
      label,
    );
  }
  assert.equal(ports.calls.discover, 0);
  assert.equal(ports.calls.prepare, 0);
  assert.equal(ports.calls.send, 0);
});

test('K4-A4 an amount that is not one positive canonical decimal is refused, and BigInt or cyclic input never reaches a port', () => {
  const { createX402Payment } = loadKernel();
  const ports = fakePorts();
  const cyclic = spec();
  cyclic.loop = cyclic;
  const throwing = spec();
  Object.defineProperty(throwing, 'amount', { get() { throw new Error('secret-value-marker'); }, enumerable: true });
  const cases = {
    'zero': '0',
    'negative': '-1',
    'exponent': '1e5',
    'decimal': '100.000',
    'leading zero': '0100000',
    'blank': '',
    'number': 100000,
    'bigint': 100000n,
    '79 digits': '9'.repeat(79),
    '78 digits ok control': null,
    'cyclic': cyclic,
    'getter that throws': throwing,
  };
  for (const [label, bad] of Object.entries(cases)) {
    if (bad === null) continue;
    assert.throws(() => createX402Payment(bad, ports), (err) => {
      if (!(err instanceof Error) || err.code !== 'VESPI_X402_INVALID_SPEC') return false;
      if (/secret-value-marker|9{10}/.test(err.message)) return false;
      return true;
    }, label);
  }
  const widest = createX402Payment(spec({ amount: '9'.repeat(78) }), ports);
  assert.equal(widest.required().spend[0].amount, '9'.repeat(78));
  assert.equal(ports.calls.discover, 0);
  assert.equal(ports.calls.send, 0);
});

test('K4-A5 an http url on localhost is accepted and canonicalized once, and the spec is frozen against later mutation', () => {
  const payment = loadKernel().createX402Payment(spec({ url: 'http://localhost:3777/api?service=marketing-plan' }), fakePorts());
  assert.equal(payment.required().spend[0].to, 'RECIPIENT');
  const declared = spec();
  const frozen = loadKernel().createX402Payment(declared, fakePorts());
  declared.amount = '999999999';
  declared.payTo = 'SOMEONE-ELSE';
  assert.deepEqual(frozen.required(), { spend: [{ asset: 'USDC:TOKEN', amount: '100000', to: 'RECIPIENT' }] });
});

test('K4-A6 a missing or malformed port is refused with a fixed code and never falls back to a default', () => {
  const { createX402Payment } = loadKernel();
  const good = fakePorts();
  assert.throws(() => createX402Payment(spec()), (err) => err.code === 'VESPI_X402_INVALID_PORT');
  const broken = {
    'no ports': undefined,
    'no http': { ...good, http: undefined },
    'http without discover': { ...good, http: { sendPaid: good.http.sendPaid } },
    'http without sendPaid': { ...good, http: { discover: good.http.discover } },
    'no signer': { ...good, signer: undefined },
    'signer without prepare': { ...good, signer: {} },
    'no inspectPrepared': { ...good, inspectPrepared: undefined },
    'inspectPrepared not callable': { ...good, inspectPrepared: 'nope' },
    'no verifySettlement': { ...good, verifySettlement: undefined },
    'no validateOutput': { ...good, validateOutput: null },
    'claims without reserveEffect': { ...good, claims: { claimTransaction: () => 'claimed' } },
    'claims without claimTransaction': { ...good, claims: { reserveEffect: () => 'claimed' } },
    'claims not an object': { ...good, claims: 'shared' },
  };
  for (const [label, bad] of Object.entries(broken)) {
    assert.throws(() => createX402Payment(spec(), bad), (err) => err instanceof Error && err.code === 'VESPI_X402_INVALID_PORT', label);
  }
  assert.equal(good.calls.discover, 0);
  assert.equal(good.calls.send, 0);
});

test('K4-A7 importing the contract performs no I/O: no port is called before run, and required() is pure', async () => {
  const ports = fakePorts();
  const payment = loadKernel().createX402Payment(spec(), ports);
  assert.deepEqual(ports.trace, []);
  payment.required();
  payment.required();
  assert.deepEqual(ports.calls, {
    discover: 0, prepare: 0, inspect: 0, send: 0, readBody: 0,
    validateOutput: 0, verifySettlement: 0, reserveEffect: 0, claimTransaction: 0,
  });
});

test('K4-A8 src/ imports only node: builtins and relative files: no SDK, no fetch, no http/https, no processes, no credentials', () => {
  const files = fs.readdirSync(SRC_DIR).filter((name) => name.endsWith('.js'));
  assert.ok(files.length >= 6, 'the kernel source files are the object of this check');
  const forbidden = [
    /require\(\s*['"](https?|net|tls|dgram|fs|child_process|worker_threads|dns)['"]\s*\)/,
    /from\s+['"](https?|net|tls|fs|child_process)['"]/,
    /@stellar\//,
    /@x402\//,
    /\bfetch\s*\(/,
    /child_process/,
    /process\.env/,
    /XMLHttpRequest/,
  ];
  for (const name of files) {
    const source = fs.readFileSync(path.join(SRC_DIR, name), 'utf8');
    for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const target = match[1];
      const allowed = target.startsWith('node:') || target.startsWith('.');
      assert.ok(allowed, `${name} requires ${target}`);
    }
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${name} matches ${pattern}`);
    }
  }
});

test('K4-A9 every module the contract loads is itself free of network and process imports', () => {
  const kernel = loadKernel();
  const loaded = Object.keys(require.cache).filter((file) => file.includes(`${path.sep}src${path.sep}`) && file.endsWith('.js'));
  assert.ok(loaded.length > 0);
  for (const file of loaded) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert.ok(match[1].startsWith('node:') || match[1].startsWith('.'), `${file} requires ${match[1]}`);
    }
  }
  assert.equal(typeof kernel.createX402Payment, 'function');
});
// =====================================================================================
// Group B — selectX402Terms: pure selection of authorized terms (cases 6, 7, 8, 9)
// =====================================================================================

test('K4-B1 the exact offer is selected and only admitted fields are copied into the terms', () => {
  const { selectX402Terms } = loadKernel();
  const chosen = selectX402Terms(paymentRequired(), spec(), authority(), CLOCK_MS);
  assert.equal(chosen.ok, true);
  assert.deepEqual(chosen.terms, {
    scheme: 'exact',
    network: 'stellar:testnet',
    asset: 'TOKEN',
    payTo: 'RECIPIENT',
    amount: '100000',
    maxTimeoutSeconds: 300,
    extra: { areFeesSponsored: true, paymentFlow: 'authorization' },
  });
  const selective = selectX402Terms(
    paymentRequired({ accepts: [offer({ extra: { areFeesSponsored: true }, facilitator: 'https://facilitator.test' })] }),
    spec(), authority(), CLOCK_MS,
  );
  assert.deepEqual(selective.terms.extra, { areFeesSponsored: true });
});

test('K4-B2 an amount under the ceiling is still refused: the declared amount is exact, not a bound', () => {
  const { selectX402Terms } = loadKernel();
  assert.equal(selectX402Terms(paymentRequired(), spec(), authority(), CLOCK_MS).ok, true);
  for (const amount of ['400000', '5000000', '1', '99999']) {
    const chosen = selectX402Terms(paymentRequired({ accepts: [offer({ amount })] }), spec(), authority(), CLOCK_MS);
    assert.deepEqual(chosen, { ok: false, code: 'TERMS_REJECTED' }, amount);
  }
});

test('K4-B3 network, asset, payTo, scheme, version, resource, sponsorship, flow and unknown economics each refuse on their own', () => {
  const { selectX402Terms } = loadKernel();
  const refusals = {
    network: paymentRequired({ accepts: [offer({ network: 'stellar:pubnet' })] }),
    asset: paymentRequired({ accepts: [offer({ asset: 'OTHER' })] }),
    payTo: paymentRequired({ accepts: [offer({ payTo: 'SOMEONE-ELSE' })] }),
    scheme: paymentRequired({ accepts: [offer({ scheme: 'upto' })] }),
    version: paymentRequired({ x402Version: 1, accepts: [offer()] }),
    'version as string': paymentRequired({ x402Version: '2', accepts: [offer()] }),
    resource: paymentRequired({ resource: { url: 'https://example.test/other' }, accepts: [offer()] }),
    'resource missing': { x402Version: 2, accepts: [offer()] },
    'resource uncanonical': paymentRequired({ resource: { url: 'https://example.test:443/api?service=marketing-plan' }, accepts: [offer()] }),
    'not sponsored': paymentRequired({ accepts: [offer({ extra: { areFeesSponsored: false } })] }),
    'no extra': paymentRequired({ accepts: [offer({ extra: undefined })] }),
    'unknown flow': paymentRequired({ accepts: [offer({ extra: { areFeesSponsored: true, paymentFlow: 'optimistic' } })] }),
    'unknown economic field': paymentRequired({ accepts: [offer({ extra: { areFeesSponsored: true, feeMultiplier: '2' } })] }),
    'no offer matches': paymentRequired({ accepts: [offer({ payTo: 'SOMEONE-ELSE' })] }),
  };
  for (const [label, required] of Object.entries(refusals)) {
    assert.deepEqual(selectX402Terms(required, spec(), authority(), CLOCK_MS), { ok: false, code: 'TERMS_REJECTED' }, label);
  }
});

test('K4-B4 the signature window is checked on its own boundaries and accepts is bounded', () => {
  const { selectX402Terms } = loadKernel();
  for (const window of [0, -1, 1.5, '300', 301, 1000]) {
    assert.deepEqual(
      selectX402Terms(paymentRequired({ accepts: [offer({ maxTimeoutSeconds: window })] }), spec(), authority(), CLOCK_MS),
      { ok: false, code: 'TERMS_REJECTED' }, String(window),
    );
  }
  for (const window of [1, 300]) {
    assert.equal(selectX402Terms(paymentRequired({ accepts: [offer({ maxTimeoutSeconds: window })] }), spec(), authority(), CLOCK_MS).ok, true, String(window));
  }
  const bounded = { ok: false, code: 'TERMS_REJECTED' };
  assert.deepEqual(selectX402Terms(paymentRequired({ accepts: [] }), spec(), authority(), CLOCK_MS), bounded);
  assert.deepEqual(selectX402Terms(paymentRequired({ accepts: 'exact' }), spec(), authority(), CLOCK_MS), bounded);
  assert.deepEqual(selectX402Terms(paymentRequired({ accepts: Array.from({ length: 65 }, () => offer()) }), spec(), authority(), CLOCK_MS), bounded);
  assert.equal(selectX402Terms(paymentRequired({ accepts: Array.from({ length: 64 }, () => offer()) }), spec(), authority(), CLOCK_MS).ok, true);
});

test('K4-B5 a hostile first offer is never selected: the first acceptable offer in order wins', () => {
  const { selectX402Terms } = loadKernel();
  const hostile = { hostile: true };
  const second = offer({ extra: { areFeesSponsored: true, paymentFlow: undefined } });
  const chosen = selectX402Terms(paymentRequired({ accepts: [hostile, second] }), spec(), authority(), CLOCK_MS);
  assert.equal(chosen.ok, true);
  assert.deepEqual(chosen.terms.extra, { areFeesSponsored: true });
  const first = offer({ maxTimeoutSeconds: 120 });
  const picked = selectX402Terms(paymentRequired({ accepts: [first, second] }), spec(), authority(), CLOCK_MS);
  assert.equal(picked.terms.maxTimeoutSeconds, 120);
  assert.equal(Object.isFrozen(chosen.terms), true);
});

test('K4-B6 a wildcard grant does not authorize this payment and an expired grant says so', () => {
  const { selectX402Terms } = loadKernel();
  const wildcard = { spend: [{ asset: 'USDC:TOKEN', maxAmount: '500000' }] };
  assert.deepEqual(selectX402Terms(paymentRequired(), spec(), wildcard, CLOCK_MS), { ok: false, code: 'TERMS_REJECTED' });
  const other = { spend: [{ asset: 'USDC:TOKEN', maxAmount: '500000', to: 'SOMEONE-ELSE' }] };
  assert.deepEqual(selectX402Terms(paymentRequired(), spec(), other, CLOCK_MS), { ok: false, code: 'TERMS_REJECTED' });
  const expired = { spend: [grant({ expiresAt: CLOCK })] };
  assert.deepEqual(selectX402Terms(paymentRequired(), spec(), expired, CLOCK_MS), { ok: false, code: 'AUTHORITY_EXPIRED' });
  const stale = { spend: [grant({ expiresAt: '2040-06-30T00:00:00.000Z' })] };
  assert.equal(selectX402Terms(paymentRequired(), spec(), stale, CLOCK_MS).ok, true);
  assert.deepEqual(selectX402Terms(paymentRequired(), spec(), authority({ spend: [] }), CLOCK_MS), { ok: false, code: 'TERMS_REJECTED' });
  assert.deepEqual(selectX402Terms(paymentRequired(), spec(), authority({ spend: [grant({ maxAmount: '99999' })] }), CLOCK_MS), { ok: false, code: 'TERMS_REJECTED' });
  assert.deepEqual(selectX402Terms(paymentRequired(), spec(), authority({ spend: [grant({ asset: 'USDC:OTHER', maxAmount: '500000' })] }), CLOCK_MS), { ok: false, code: 'TERMS_REJECTED' });
});

test('K4-B7 selection reads a malformed declaration or requirement as INVALID_SPEC and never throws at the caller', () => {
  const { selectX402Terms } = loadKernel();
  const throwing = paymentRequired();
  Object.defineProperty(throwing, 'accepts', { get() { throw new Error('marker-secret'); } });
  const circular = paymentRequired();
  circular.accepts = [circular];
  // A payload that is not an object, cycles, or throws on read is malformed. A well-formed object
  // that speaks another version, names another resource or offers nothing acceptable is a refusal.
  for (const [label, required] of Object.entries({
    'null': null, 'array': [], 'getter that throws': throwing,
  })) {
    assert.deepEqual(selectX402Terms(required, spec(), authority(), CLOCK_MS), { ok: false, code: 'INVALID_SPEC' }, label);
  }
  assert.deepEqual(selectX402Terms({ accepts: [offer()] }, spec(), authority(), CLOCK_MS), { ok: false, code: 'TERMS_REJECTED' });
  assert.deepEqual(selectX402Terms(circular, spec(), authority(), CLOCK_MS), { ok: false, code: 'TERMS_REJECTED' });
  assert.deepEqual(selectX402Terms(paymentRequired(), spec(), authority(), 'not-a-clock'), { ok: false, code: 'INVALID_CLOCK' });
  assert.deepEqual(selectX402Terms(paymentRequired(), spec({ amount: '0' }), authority(), CLOCK_MS), { ok: false, code: 'INVALID_SPEC' });
  assert.deepEqual(selectX402Terms(paymentRequired(), null, authority(), CLOCK_MS), { ok: false, code: 'INVALID_SPEC' });
});

test('K4-B8 selection never mutates what the server sent and never widens the requirement', () => {
  const { selectX402Terms } = loadKernel();
  const required = paymentRequired();
  const before = JSON.stringify(required);
  const chosen = selectX402Terms(required, spec(), authority(), CLOCK_MS);
  assert.equal(chosen.ok, true);
  assert.equal(JSON.stringify(required), before);
  assert.equal(Object.isFrozen(chosen.terms.extra), true);
  assert.equal(chosen.terms.grantAsset, undefined);
  assert.equal(chosen.terms.payer, undefined);
});
// =====================================================================================
// Group C — composition with authority: the gate, the named recipient, the clock (cases 3, 4, 5)
// =====================================================================================

function opWith(authority, over = {}) {
  return createOperation({ goal: 'obtain-marketing-plan', action: 'pay', authority, agent: 'agent-1', ...over });
}

test('K4-C1 an authority that does not cover the effect returns needs_human_decision with zero ports', async () => {
  const ports = fakePorts();
  const payment = loadKernel().createX402Payment(spec(), ports);
  const op = opWith({ spend: [] });
  const res = await payment.run(op, { now: () => CLOCK_MS, ask: async () => ({ approved: false, by: 'ana' }) });
  assert.equal(res.status, 'needs_human_decision');
  assert.equal(res.receipt.status, 'needs_human_decision');
  assert.equal(ports.calls.discover, 0);
  assert.equal(ports.calls.prepare, 0);
  assert.equal(ports.calls.send, 0);
  assert.deepEqual(res.receipt.authority.exercised, []);
});

test('K4-C2 an approval by the agent is not an approval: the gate returns and no port is called', async () => {
  const ports = fakePorts();
  const payment = loadKernel().createX402Payment(spec(), ports);
  const op = opWith({ spend: [] });
  const res = await payment.run(op, { now: () => CLOCK_MS, ask: async () => ({ approved: true, by: 'agent-1' }) });
  assert.equal(res.status, 'needs_human_decision');
  assert.match(res.receipt.detail, /agent/i);
  assert.equal(ports.calls.discover, 0);
  assert.equal(ports.calls.send, 0);
});

test('K4-C3 a quorum that repeats one identity or names nobody allowed opens no port', async () => {
  const ports = fakePorts();
  const payment = loadKernel().createX402Payment(spec(), ports);
  const quorum = { signers: { required: 2, allowed: ['ana', 'beto'] }, spend: [grant({ maxAmount: '1' })] };
  const repeated = await payment.run(opWith(quorum), {
    now: () => CLOCK_MS,
    ask: async () => ({ approvals: [{ by: 'ana' }, { by: 'ana' }] }),
  });
  assert.equal(repeated.status, 'needs_human_decision');
  const outsider = await payment.run(opWith(quorum), {
    now: () => CLOCK_MS,
    ask: async () => ({ approvals: [{ by: 'ana' }, { by: 'mallory' }] }),
  });
  assert.equal(outsider.status, 'needs_human_decision');
  assert.equal(ports.calls.discover, 0);
  assert.equal(ports.calls.send, 0);
});

test('K4-C4 a wildcard grant or a grant to another recipient blocks before any port runs', async () => {
  // A grant that mentions this asset but never this recipient is a payment this agreement cannot
  // make. A grant for another asset says nothing about this one, so the person still gets the gate.
  for (const [label, granted] of Object.entries({
    wildcard: [{ asset: 'USDC:TOKEN', maxAmount: '500000' }],
    'another recipient': [{ asset: 'USDC:TOKEN', maxAmount: '500000', to: 'SOMEONE-ELSE' }],
  })) {
    const ports = fakePorts();
    const payment = loadKernel().createX402Payment(spec(), ports);
    const res = await payment.run(opWith({ spend: granted }), { now: () => CLOCK_MS });
    assert.equal(res.status, 'blocked', label);
    assert.equal(res.receipt.status, 'blocked');
    assert.equal(res.receipt.reason, 'TERMS_REJECTED', label);
    assert.equal(res.receipt.exit, 'return to the person: change the agreement or cancel', label);
    assert.deepEqual(res.receipt.authority.exercised, [], label);
    assert.equal(ports.calls.discover, 0, label);
    assert.equal(ports.calls.prepare, 0, label);
    assert.equal(ports.calls.send, 0, label);
  }
});

test('K4-C4b a grant for another asset opens the gate instead of blocking, with zero ports', async () => {
  const ports = fakePorts();
  const payment = loadKernel().createX402Payment(spec(), ports);
  const res = await payment.run(opWith({ spend: [{ asset: 'USDC:OTHER', maxAmount: '500000', to: 'RECIPIENT' }] }), {
    now: () => CLOCK_MS,
    ask: async () => ({ approved: false, by: 'ana' }),
  });
  assert.equal(res.status, 'needs_human_decision');
  assert.equal(ports.calls.discover, 0);
  assert.equal(ports.calls.send, 0);
});

test('K4-C5 a grant naming this recipient reaches discovery exactly once', async () => {
  const ports = fakePorts();
  const payment = loadKernel().createX402Payment(spec(), ports);
  const res = await payment.run(opWith(authority()), { now: () => CLOCK_MS });
  assert.equal(ports.calls.discover, 1);
  assert.notEqual(res.status, 'blocked');
  assert.deepEqual(ports.seenRequests[0], {
    url: CANONICAL_URL, method: 'GET', redirect: 'error', signal: ports.seenRequests[0].signal,
  });
  assert.equal(ports.seenRequests[0].signal.aborted, false);
});

test('K4-C6 an invalid or asynchronous injected clock sends nothing and leaves the state honest', async () => {
  for (const [label, now] of Object.entries({
    garbage: () => 'not-a-clock',
    null: () => null,
    promise: async () => CLOCK_MS,
    throws: () => { throw new Error('clock down'); },
  })) {
    const ports = fakePorts();
    const payment = loadKernel().createX402Payment(spec(), ports);
    const res = await payment.run(opWith(authority()), { now });
    assert.equal(ports.calls.discover, 0, label);
    assert.equal(ports.calls.prepare, 0, label);
    assert.equal(ports.calls.send, 0, label);
    assert.equal(res.status, 'failed', label);
    assert.equal(res.output, null, label);
  }
});

test('K4-C7 an approval at the gate never takes away who can pause or who can sign', async () => {
  const ports = fakePorts();
  const payment = loadKernel().createX402Payment(spec(), ports);
  const op = opWith({
    spend: [],
    pausers: ['ana'],
    signers: { required: 1, allowed: ['ana'] },
  });
  const res = await payment.run(op, { now: () => CLOCK_MS, ask: async () => ({ approved: true, by: 'ana' }) });
  assert.equal(ports.calls.discover, 1);
  assert.deepEqual(op.authority.pausers, ['ana']);
  assert.deepEqual(op.authority.signers, { required: 1, allowed: ['ana'] });
  assert.equal(res.receipt.authority.approval, 'human_gate_approved');
  assert.equal(res.receipt.decidedBy, 'ana');
});

test('K4-C8 the gate receives the declared effect, and a person who says no stops the run', async () => {
  const ports = fakePorts();
  const payment = loadKernel().createX402Payment(spec(), ports);
  let seen = null;
  const op = opWith({ spend: [] });
  const res = await payment.run(op, {
    now: () => CLOCK_MS,
    ask: async (payload) => { seen = payload; return { approved: false, by: 'beto' }; },
  });
  assert.equal(res.status, 'needs_human_decision');
  assert.equal(ports.calls.discover, 0);
  assert.deepEqual(seen.map((r) => `${r.amount} of ${r.asset} to ${r.to}`), ['100000 of USDC:TOKEN to RECIPIENT']);
  assert.equal(seen.publicByDefault, false);
});
// =====================================================================================
// Group D — preparation and independent inspection (cases 10 and 11, and the mid-run clock of 5)
// =====================================================================================

function runOnce(ports, io = {}, declared = spec(), granted = authority()) {
  const payment = loadKernel().createX402Payment(declared, ports);
  return payment.run(opWith(granted), { now: () => CLOCK_MS, ...io });
}

test('K4-D1 a signer that returns no authorization string fails before any inspection and never sends', async () => {
  for (const [label, prepare] of Object.entries({
    'no authorization': async () => ({}),
    'blank authorization': async () => ({ authorization: '   ' }),
    'authorization as object': async () => ({ authorization: { x: 1 } }),
    'not an object': async () => 'PUBLIC-AUTH',
  })) {
    const ports = fakePorts({ prepare });
    const res = await runOnce(ports);
    assert.equal(res.status, 'failed', label);
    assert.equal(res.receipt.detail, 'PREPARE_FAILED', label);
    assert.deepEqual(res.receipt.authority.exercised, [], label);
    assert.equal(ports.calls.inspect, 0, label);
    assert.equal(ports.calls.send, 0, label);
  }
});

test('K4-D2 a signer that throws fails with PREPARE_FAILED and zero sends', async () => {
  const ports = fakePorts({ prepare: async () => { throw new Error('keypair unavailable: SECRET-marker'); } });
  const res = await runOnce(ports);
  assert.equal(res.status, 'failed');
  assert.equal(res.receipt.detail, 'PREPARE_FAILED');
  assert.doesNotMatch(JSON.stringify(res.receipt), /SECRET-marker/);
  assert.equal(ports.calls.inspect, 0);
  assert.equal(ports.calls.send, 0);
});

test('K4-D3 an inspection that does not verify, or that is malformed, blocks before sending', async () => {
  const refusals = {
    'not verified': { verified: false, checks: { prepared: true }, reason: 'no', authDigest: AUTH_DIGEST },
    'prepared missing': { verified: true, checks: {}, reason: 'ok', authDigest: AUTH_DIGEST },
    'prepared false': { verified: true, checks: { prepared: false }, reason: 'ok', authDigest: AUTH_DIGEST },
    'empty reason': { verified: true, checks: { prepared: true }, reason: '', authDigest: AUTH_DIGEST },
    'empty digest': { verified: true, checks: { prepared: true }, reason: 'ok', authDigest: '' },
    'digest not hex': { verified: true, checks: { prepared: true }, reason: 'ok', authDigest: 'zz' },
    'non boolean check': { verified: true, checks: { prepared: true, fee: '1' }, reason: 'ok', authDigest: AUTH_DIGEST },
    'checks not an object': { verified: true, checks: 'prepared', reason: 'ok', authDigest: AUTH_DIGEST },
    'truthy verified': { verified: 'yes', checks: { prepared: true }, reason: 'ok', authDigest: AUTH_DIGEST },
  };
  for (const [label, result] of Object.entries(refusals)) {
    const ports = fakePorts({ inspectPrepared: async () => result });
    const res = await runOnce(ports);
    assert.equal(res.status, 'blocked', label);
    assert.equal(res.receipt.reason, 'PREPARED_REJECTED', label);
    assert.deepEqual(res.receipt.authority.exercised, [], label);
    assert.equal(ports.calls.send, 0, label);
  }
});

test('K4-D4 a prepared effect that differs from the declaration in any single field is refused', async () => {
  const base = {
    verified: true,
    authDigest: AUTH_DIGEST,
    checks: { prepared: true },
    reason: 'prepared transaction matches declared effect',
  };
  const effects = {
    network: 'stellar:pubnet',
    asset: 'OTHER',
    payer: 'SOMEONE-ELSE',
    payTo: 'SOMEONE-ELSE',
    amount: '400000',
    'amount as number': 100000,
  };
  for (const [field, value] of Object.entries(effects)) {
    const key = field === 'amount as number' ? 'amount' : field;
    const ports = fakePorts({
      inspectPrepared: async () => ({ ...base, effect: { network: 'stellar:testnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000', [key]: value } }),
    });
    const res = await runOnce(ports);
    assert.equal(res.status, 'blocked', field);
    assert.equal(res.receipt.reason, 'PREPARED_REJECTED', field);
    assert.equal(ports.calls.send, 0, field);
  }
  // The control: the exact declared effect passes inspection. The send itself is asserted by the
  // group that builds it, so here the control only has to get past the inspection.
  const control = fakePorts({ inspectPrepared: async () => ({ ...base, effect: { network: 'stellar:testnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000' } }) });
  await runOnce(control);
  assert.equal(control.calls.prepare, 1);
  assert.equal(control.calls.inspect, 1);
});

test('K4-D5 an inspector that throws is a failure, not a block, and nothing is sent', async () => {
  const ports = fakePorts({ inspectPrepared: async () => { throw new Error('envelope decode failed: marker'); } });
  const res = await runOnce(ports);
  assert.equal(res.status, 'failed');
  assert.equal(res.receipt.detail, 'PREPARED_REJECTED');
  assert.deepEqual(res.receipt.authority.exercised, []);
  assert.equal(ports.calls.send, 0);
  assert.doesNotMatch(JSON.stringify(res.receipt), /marker/);
});

test('K4-D6 the signer receives the terms and the expected effect, and never a widened one', async () => {
  const ports = fakePorts();
  await runOnce(ports, {}, spec({ amount: '100000' }), authority({ spend: [grant({ maxAmount: '500000' })] }));
  const prepareRequest = ports.seenRequests.find((r) => r && r.terms);
  assert.deepEqual(prepareRequest.terms, {
    scheme: 'exact', network: 'stellar:testnet', asset: 'TOKEN', payTo: 'RECIPIENT',
    amount: '100000', maxTimeoutSeconds: 300, extra: { areFeesSponsored: true, paymentFlow: 'authorization' },
  });
  assert.deepEqual(prepareRequest.expected, {
    network: 'stellar:testnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000',
  });
  assert.equal(Object.isFrozen(prepareRequest.terms), true);
  const inspectRequest = ports.seenRequests.find((r) => r && r.authorization !== undefined);
  assert.equal(inspectRequest.authorization, 'PUBLIC-AUTH');
  assert.equal(inspectRequest.expected.amount, '100000');
});

test('K4-D7 mutating the authority or the offer during the awaits cannot widen the declared effect', async () => {
  const op = opWith(authority());
  const grantRef = op.authority.spend[0];
  const ports = fakePorts({
    discover: async () => {
      grantRef.maxAmount = '999999999';
      return { status: 402, paymentRequired: paymentRequired({ accepts: [offer({ amount: '100000' })] }) };
    },
    inspectPrepared: async () => {
      grantRef.maxAmount = '999999999';
      return {
        verified: true,
        authDigest: AUTH_DIGEST,
        effect: { network: 'stellar:testnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000' },
        checks: { prepared: true },
        reason: 'prepared transaction matches declared effect',
      };
    },
  });
  const payment = loadKernel().createX402Payment(spec(), ports);
  await payment.run(op, { now: () => CLOCK_MS });
  const prepareRequest = ports.seenRequests.find((r) => r && r.terms);
  assert.equal(prepareRequest.terms.amount, '100000');
  assert.equal(prepareRequest.expected.amount, '100000');
  assert.equal(prepareRequest.expected.asset, 'TOKEN');
});

test('K4-D7c a grant reassigned to another asset during the run blocks before preparing', async () => {
  const op = opWith(authority());
  const grantRef = op.authority.spend[0];
  const ports = fakePorts({
    discover: async () => {
      grantRef.asset = 'USDC:ANYTHING';
      return { status: 402, paymentRequired: paymentRequired() };
    },
  });
  const payment = loadKernel().createX402Payment(spec(), ports);
  const res = await payment.run(op, { now: () => CLOCK_MS });
  assert.equal(res.status, 'blocked');
  assert.equal(res.receipt.reason, 'TERMS_REJECTED');
  assert.equal(ports.calls.prepare, 0);
  assert.equal(ports.calls.send, 0);
});

test('K4-D7b a ceiling narrowed during the run blocks before sending, and the gate payload never widens', async () => {
  const op = opWith(authority());
  const grantRef = op.authority.spend[0];
  const narrowed = fakePorts({
    discover: async () => {
      grantRef.maxAmount = '99999';
      return { status: 402, paymentRequired: paymentRequired() };
    },
  });
  const payment = loadKernel().createX402Payment(spec(), narrowed);
  const res = await payment.run(op, { now: () => CLOCK_MS });
  assert.equal(res.status, 'blocked');
  assert.equal(res.receipt.reason, 'TERMS_REJECTED');
  assert.equal(narrowed.calls.prepare, 0);
  assert.equal(narrowed.calls.send, 0);
  assert.deepEqual(res.receipt.authority.exercised, []);

  let payload = null;
  const gatePorts = fakePorts();
  const gatePayment = loadKernel().createX402Payment(spec(), gatePorts);
  await gatePayment.run(opWith({ spend: [] }), {
    now: () => CLOCK_MS,
    ask: async (seen) => { payload = seen; return { approved: false, by: 'ana' }; },
  });
  assert.deepEqual(payload.map((r) => `${r.amount} of ${r.asset} to ${r.to}`), ['100000 of USDC:TOKEN to RECIPIENT']);
  assert.equal(gatePorts.calls.discover, 0);
});

test('K4-D8 a grant that expires while the run is in flight blocks before sending, and the gate keeps its people', async () => {
  const op = opWith(authority({ pausers: ['ana'], signers: { required: 1, allowed: ['ana'] } }));
  const grantRef = op.authority.spend[0];
  const ports = fakePorts({
    inspectPrepared: async () => {
      grantRef.expiresAt = '2000-01-01T00:00:00.000Z';
      return {
        verified: true,
        authDigest: AUTH_DIGEST,
        effect: { network: 'stellar:testnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000' },
        checks: { prepared: true },
        reason: 'prepared transaction matches declared effect',
      };
    },
  });
  const payment = loadKernel().createX402Payment(spec(), ports);
  const res = await payment.run(op, {
    now: () => CLOCK_MS,
    ask: async () => ({ approvals: [{ by: 'ana' }] }),
  });
  assert.equal(res.status, 'blocked');
  assert.equal(res.receipt.reason, 'AUTHORITY_EXPIRED');
  assert.equal(ports.calls.prepare, 1);
  assert.equal(ports.calls.send, 0);
  assert.deepEqual(op.authority.pausers, ['ana']);
  assert.deepEqual(op.authority.signers, { required: 1, allowed: ['ana'] });
});
// =====================================================================================
// Group E — send, delivery, settlement verification, evidence and receipt verdict
// (cases 12, 13, 17, 18, 19, 20, 21)
// =====================================================================================

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function paidResponse(over = {}) {
  return {
    status: 200,
    settlement: { success: true, transaction: TX_HASH, payer: 'PAYER', network: 'stellar:testnet', amount: '100000' },
    readBody: async () => BODY,
    ...over,
  };
}

test('K4-E1 the paid effect is verified, the output stays out of the receipt and the anchor is still pending', async () => {
  const ports = fakePorts({ sendPaid: async () => paidResponse() });
  const res = await runOnce(ports);
  assert.equal(res.status, 'verified');
  assert.equal(res.receipt.status, 'verified');
  assert.deepEqual(res.output, BODY);
  assert.equal(res.receipt.evidence.planDigest, PLAN_DIGEST);
  assert.equal(res.receipt.evidence.authDigest, AUTH_DIGEST);
  assert.equal(res.receipt.evidence.txHash, TX_HASH);
  assert.equal(res.receipt.evidence.payer, 'PAYER');
  assert.equal(res.receipt.evidence.network, 'stellar:testnet');
  assert.equal(res.receipt.evidence.amount, '100000');
  assert.equal(JSON.stringify(res.receipt).includes(res.output.title), false, 'the body never travels in the receipt');
  assert.equal(verifyReceipt(res.receipt).ok, true);
  for (const [key, value] of Object.entries(res.receipt.verification.checks)) {
    assert.equal(typeof value, 'boolean', key);
    assert.equal(value, true, key);
  }
  assert.equal(res.receipt.anchor.status, 'pending');
  assert.ok(res.receipt.notCovered.includes('external anchor'));
  assert.equal(res.receipt.coverage.includes('external anchor'), false);
  assert.deepEqual(res.receipt.authority.exercised, [{ asset: 'USDC:TOKEN', maxAmount: '100000', to: 'RECIPIENT' }]);
});

test('K4-E2 the ports are called in the declared order and the digest exists before the send', async () => {
  const ports = fakePorts();
  await runOnce(ports, {}, spec(), authority());
  const order = ports.trace;
  const at = (label) => order.indexOf(label);
  assert.ok(at('discover') < at('reserve'), 'discover before reserve');
  assert.ok(at('reserve') < at('prepare'), 'reserve before prepare');
  assert.ok(at('prepare') < at('inspect'), 'prepare before inspect');
  assert.ok(at('inspect') < at('send'), 'inspect before send');
  assert.ok(at('send') < at('body'), 'send before the body is read');
  assert.ok(at('body') < at('validateOutput'), 'the body is validated');
  assert.ok(at('validateOutput') < at('verifySettlement'), 'delivery is judged before the settlement');
  const inspectIndex = ports.seenRequests.findIndex((r) => r && r.authorization !== undefined);
  const sendIndex = ports.seenRequests.findIndex((r) => r && r.terms && r.authorization !== undefined);
  assert.ok(inspectIndex >= 0 && sendIndex > inspectIndex, 'the authorization is inspected before it is sent');
  const sendRequest = ports.seenRequests[sendIndex];
  assert.equal(sendRequest.redirect, 'error');
  assert.equal(sendRequest.idempotencyKey.length, 64);
  assert.match(sendRequest.idempotencyKey, /^[0-9a-f]{64}$/);
});

test('K4-E3 a host verifier is ignored: only the settlement port can verify this payment', async () => {
  const trusting = fakePorts({ sendPaid: async () => paidResponse(), verifySettlement: async () => ({ verified: false, checks: { invocation: false }, reason: 'settlement does not match' }) });
  const res = await runOnce(trusting, { verify: () => ({ verified: true, checks: { host: true }, reason: 'the host says yes' }) });
  assert.equal(res.status, 'not_verified');
  assert.equal(res.output, null);
  assert.equal(res.receipt.verification.checks.settlement, false);
  assert.equal(res.receipt.verification.checks.host, undefined);
  assert.ok(res.receipt.notCovered.includes('settlement'));
});

test('K4-E4 after the send starts, a failure is not_verified and there is never a second send', async () => {
  const cases = {
    'the port throws': async () => { throw new Error('facilitator exploded: SECRET-marker'); },
    'not an object': async () => 'ok',
    'no settlement': async () => ({ status: 200, readBody: async () => BODY }),
    'paid again with 402': async () => paidResponse({ status: 402, settlement: undefined }),
    'redirected': async () => paidResponse({ status: 302 }),
    'settlement without hash': async () => paidResponse({ settlement: { success: true, payer: 'PAYER', network: 'stellar:testnet' } }),
    'settlement not successful': async () => paidResponse({ settlement: { success: false, transaction: TX_HASH } }),
    'payer differs': async () => paidResponse({ settlement: { success: true, transaction: TX_HASH, payer: 'SOMEONE-ELSE', network: 'stellar:testnet', amount: '100000' } }),
    'network differs': async () => paidResponse({ settlement: { success: true, transaction: TX_HASH, payer: 'PAYER', network: 'stellar:pubnet', amount: '100000' } }),
    'amount differs': async () => paidResponse({ settlement: { success: true, transaction: TX_HASH, payer: 'PAYER', network: 'stellar:testnet', amount: '400000' } }),
    'hash not a hash': async () => paidResponse({ settlement: { success: true, transaction: 'not-a-hash', payer: 'PAYER', network: 'stellar:testnet', amount: '100000' } }),
  };
  for (const [label, sendPaid] of Object.entries(cases)) {
    const ports = fakePorts({ sendPaid });
    const res = await runOnce(ports);
    assert.equal(res.status, 'not_verified', label);
    assert.equal(res.output, null, label);
    assert.equal(res.receipt.status, 'not_verified', label);
    assert.equal(ports.calls.send, 1, label);
    assert.doesNotMatch(JSON.stringify(res.receipt), /SECRET-marker/, label);
    assert.equal(res.receipt.evidence.authDigest, AUTH_DIGEST, `${label} keeps the digest`);
    assert.equal(ports.calls.verifySettlement <= 1, true, label);
  }
});

test('K4-E5 a settlement without a usable hash is not verified and the engine is told the outcome is unknown', async () => {
  for (const [label, sendPaid] of Object.entries({
    'throws': async () => { throw new Error('timeout after 15000ms'); },
    'unusable': async () => ({ status: 500 }),
  })) {
    const ports = fakePorts({ sendPaid });
    const res = await runOnce(ports);
    assert.equal(res.status, 'not_verified', label);
    assert.equal(res.receipt.evidence.settlementUnknown, true, label);
    assert.equal(res.receipt.detail, 'SEND_UNKNOWN', label);
    assert.equal(res.receipt.verification.verified, false, label);
    assert.deepEqual(res.receipt.authority.exercised, [{ asset: 'USDC:TOKEN', maxAmount: '100000', to: 'RECIPIENT' }], label);
    assert.equal(ports.calls.send, 1, label);
  }
});

test('K4-E6 a verifier that throws, hangs, lies or returns an empty reason never verifies', async () => {
  const outcomes = {
    throws: async () => { throw new Error('horizon down: SECRET-marker'); },
    truthy: async () => 'verified',
    'empty reason': async () => ({ verified: true, checks: { invocation: true }, reason: '' }),
    'a false check': async () => ({ verified: true, checks: { invocation: true, transfer: false }, reason: 'looks fine' }),
    'not an object': async () => 42,
    'no verified': async () => ({ checks: { invocation: true }, reason: 'forgot the verdict' }),
  };
  for (const [label, verifySettlement] of Object.entries(outcomes)) {
    const ports = fakePorts({ sendPaid: async () => paidResponse(), verifySettlement });
    const res = await runOnce(ports);
    assert.equal(res.status, 'not_verified', label);
    assert.equal(res.output, null, label);
    assert.equal(res.receipt.verification.verified, false, label);
    assert.doesNotMatch(JSON.stringify(res.receipt), /SECRET-marker/, label);
  }
});

test('K4-E7 a verifier that hangs is cut off with its own signal, and the payment stays not verified', async () => {
  let observed = null;
  const ports = fakePorts({
    sendPaid: async () => paidResponse(),
    verifySettlement: async (evidence, request) => new Promise((resolve) => {
      observed = request.signal;
    }),
  });
  const res = await runOnce(ports, { verifyTimeoutMs: 40 });
  assert.equal(res.status, 'not_verified');
  assert.equal(res.output, null);
  await delay(120);
  assert.ok(observed, 'the port received a signal it could honour');
  assert.equal(observed.aborted, true, 'the signal was cancelled when the budget ran out');
});

test('K4-E8 a broken body, an oversized body or a status other than 200 still leaves the payment verifiable', async () => {
  const cases = {
    'body throws': { response: paidResponse({ readBody: async () => { throw new Error('stream closed: SECRET-marker'); } }) },
    'body is not json': { response: paidResponse({ readBody: async () => 'not json at all' }) },
    'no readBody': { response: paidResponse({ readBody: undefined }) },
    'oversized': { response: paidResponse({ readBody: async () => ({ title: 'x'.repeat(1_100_000), summary: 's', deliverables: [], nextSteps: [] }) }) },
    'wrong schema': { response: paidResponse({ readBody: async () => ({ title: 'only a title' }) }) },
    'status 500': { response: paidResponse({ status: 500 }) },
  };
  for (const [label, { response }] of Object.entries(cases)) {
    const ports = fakePorts({ sendPaid: async () => response });
    const res = await runOnce(ports);
    assert.equal(ports.calls.verifySettlement, 1, `${label}: the settlement is still verified`);
    assert.equal(res.status, 'not_verified', label);
    assert.equal(res.output, null, label);
    assert.equal(res.receipt.verification.checks.delivery, false, label);
    assert.equal(res.receipt.verification.checks.settlement, true, `${label}: the payment itself may be covered`);
    assert.equal(res.receipt.evidence.txHash, TX_HASH, label);
    assert.equal(res.receipt.evidence.planDigest, undefined, label);
    assert.doesNotMatch(JSON.stringify(res.receipt), /SECRET-marker/, label);
    assert.ok(res.receipt.notCovered.includes('delivery'), label);
  }
});

test('K4-E9 an abort before the send sends nothing, and an abort after it never resends', async () => {
  const beforeSend = fakePorts({
    prepare: async (request) => {
      request.signal.dispatchEvent(new Event('abort'));
      return { authorization: 'PUBLIC-AUTH' };
    },
  });
  const early = await runOnce(beforeSend);
  assert.equal(early.status, 'failed');
  assert.equal(early.receipt.detail, 'ABORTED');
  assert.equal(beforeSend.calls.send, 0);
  assert.deepEqual(early.receipt.authority.exercised, []);

  // A signer that answers late, after the run was cancelled, still never reaches inspection or send.
  const latePrepare = fakePorts({
    prepare: async (request) => new Promise((resolve) => {
      request.signal.dispatchEvent(new Event('abort'));
      setTimeout(() => resolve({ authorization: 'PUBLIC-AUTH' }), 5);
    }),
    inspectPrepared: async () => {
      throw new Error('the inspection must not be reached after an abort');
    },
  });
  const late = await runOnce(latePrepare);
  assert.equal(late.status, 'failed');
  assert.equal(late.receipt.detail, 'ABORTED');
  assert.equal(latePrepare.calls.inspect, 0);
  assert.equal(latePrepare.calls.send, 0);

  const afterSend = fakePorts({
    sendPaid: async (request) => {
      request.signal.dispatchEvent(new Event('abort'));
      return paidResponse();
    },
  });
  const post = await runOnce(afterSend);
  assert.equal(post.status, 'not_verified');
  assert.equal(afterSend.calls.send, 1);
  assert.equal(post.output, null);
});

test('K4-E10 the evidence carries only admitted keys and never the body, the authorization or headers', async () => {
  const ports = fakePorts({
    sendPaid: async () => paidResponse({
      headers: { authorization: 'Bearer SECRET-header-marker' },
      body: 'SECRET-body-marker',
      settlement: { success: true, transaction: TX_HASH, payer: 'PAYER', network: 'stellar:testnet', amount: '100000', facilitator: 'SECRET-facilitator-marker' },
    }),
    validateOutput: (body) => ({ ok: true, output: body, digest: PLAN_DIGEST, secret: 'SECRET-validate-marker' }),
  });
  const res = await runOnce(ports);
  assert.equal(res.status, 'verified');
  const json = JSON.stringify(res.receipt);
  for (const marker of ['SECRET-header-marker', 'SECRET-body-marker', 'SECRET-facilitator-marker', 'SECRET-validate-marker', AUTHORIZATION]) {
    assert.equal(json.includes(marker), false, marker);
  }
  assert.deepEqual(Object.keys(res.receipt.evidence).sort(), ['amount', 'authDigest', 'network', 'payer', 'planDigest', 'txHash'].sort());
});
// =====================================================================================
// Group F — concurrent claims and deduplication (cases 14, 15 and 16)
// =====================================================================================

const VECTOR_OPERATION_KEY = '01e6c8504077a1e7171b0609218eb120ecfea1e92df9a216a960aab6354af446';
// Computed by a second implementation (python json.dumps with sorted keys, then sha256), not by the
// function under test: {"expected":{...},"operationKey":...,"request":{...},"version":1}
const VECTOR_EFFECT_KEY = '28b7c11ae51042db176f979f961c6890cd915970ca9f2d2d1948acb9490bc07b';

function portsWithoutClaims(over = {}) {
  const ports = fakePorts(over);
  delete ports.claims;
  return ports;
}

test('K4-F1 two concurrent runs of the same effect pay once: one sends and the other is blocked as a duplicate', async () => {
  const shared = portsWithoutClaims();
  const other = portsWithoutClaims();
  const first = loadKernel().createX402Payment(spec(), shared);
  const second = loadKernel().createX402Payment(spec(), other);
  const [a, b] = await Promise.all([first.run(opWith(authority()), runIo()), second.run(opWith(authority()), runIo())]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ['blocked', 'verified']);
  const blocked = a.status === 'blocked' ? a : b;
  assert.equal(blocked.receipt.reason, 'DUPLICATE_EFFECT');
  assert.deepEqual(blocked.receipt.authority.exercised, []);
  assert.equal(shared.calls.send + other.calls.send, 1, 'exactly one send');
  assert.equal(shared.calls.prepare + other.calls.prepare, 1, 'exactly one preparation');
});

test('K4-F1b the same operation run twice at once keeps the engine refusal instead of paying twice', async () => {
  const ports = fakePorts();
  const payment = loadKernel().createX402Payment(spec(), ports);
  const op = opWith(authority());
  const results = await Promise.allSettled([payment.run(op, runIo()), payment.run(op, runIo())]);
  const refused = results.filter((r) => r.status === 'rejected');
  assert.equal(refused.length, 1);
  assert.match(refused[0].reason.message, /already running/);
  assert.equal(ports.calls.send, 1);
});

test('K4-F2 a renewed grant or a fresh operation id is still the same effect, and other networks are not', async () => {
  const store = loadKernel().createMemoryPaymentClaims();
  const ports = fakePorts({ claims: store });
  const payment = loadKernel().createX402Payment(spec(), ports);
  const first = await payment.run(opWith(authority()), runIo());
  assert.equal(first.status, 'verified');
  const renewed = await payment.run(opWith(authority({ spend: [grant({ expiresAt: '2040-06-30T00:00:00.000Z' })] })), runIo());
  assert.equal(renewed.status, 'blocked');
  assert.equal(renewed.receipt.reason, 'DUPLICATE_EFFECT');
  const freshOperation = await payment.run(opWith(authority(), { goal: 'obtain-marketing-plan', action: 'pay' }), runIo());
  assert.equal(freshOperation.status, 'blocked');
  assert.equal(ports.calls.send, 1);

  // A different resource is a different effect, and it settles with its own transaction.
  const elsewhere = fakePorts({
    claims: store,
    sendPaid: async () => paidResponse({ settlement: { success: true, transaction: 'c'.repeat(64), payer: 'PAYER', network: 'stellar:testnet', amount: '100000' } }),
  });
  const otherUrl = loadKernel().createX402Payment(spec({ url: 'https://example.test/api?service=other-plan' }), elsewhere);
  const differentUrl = await otherUrl.run(opWith(authority()), runIo());
  assert.equal(differentUrl.status, 'verified');
  // The same spend on another network is another effect and another transaction: it is neither a
  // duplicate of the first payment nor blocked by its transaction.
  const pubnetPorts = fakePorts({
    claims: store,
    discover: async (request) => ({
      status: 402,
      paymentRequired: paymentRequired({
        resource: { url: request.url },
        accepts: [offer({ network: 'stellar:pubnet' })],
      }),
    }),
    sendPaid: async () => paidResponse({ settlement: { success: true, transaction: 'a'.repeat(64), payer: 'PAYER', network: 'stellar:pubnet', amount: '100000' } }),
    inspectPrepared: async () => ({
      verified: true,
      authDigest: AUTH_DIGEST,
      effect: { network: 'stellar:pubnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000' },
      checks: { prepared: true },
      reason: 'prepared transaction matches declared effect',
    }),
  });
  const differentNetwork = await loadKernel().createX402Payment(spec({ network: 'stellar:pubnet' }), pubnetPorts).run(opWith(authority()), runIo());
  assert.equal(differentNetwork.status, 'verified', differentNetwork.receipt.reason || differentNetwork.receipt.detail);
  assert.equal(pubnetPorts.calls.claimTransaction, 1, JSON.stringify(pubnetPorts.trace));
});

test('K4-F3 the effect key is a hash of the canonical effect, and a full store blocks instead of evicting', async () => {
  const seenKeys = [];
  const one = loadKernel().createMemoryPaymentClaims({ capacity: 1 });
  const ports = fakePorts({ claims: { reserveEffect: (key) => { seenKeys.push(key); return one.reserveEffect(key); }, claimTransaction: (n, t) => one.claimTransaction(n, t) } });
  const payment = loadKernel().createX402Payment(spec(), ports);
  const first = await payment.run(opWith(authority()), runIo());
  assert.equal(first.status, 'verified');
  assert.equal(seenKeys.length, 1);
  assert.equal(seenKeys[0], VECTOR_EFFECT_KEY, 'the key is the canonical effect hash, verified by a second implementation');
  const second = await payment.run(opWith(authority()), runIo());
  assert.equal(second.status, 'blocked');
  const third = await payment.run(opWith(authority()), runIo());
  assert.equal(third.status, 'blocked', 'nothing is evicted to make room');
  assert.equal(one.reserveEffect('b'.repeat(64)), 'capacity');
});

test('K4-F4 a settled transaction already claimed is not exposed twice, and a hash is never claimed empty', async () => {
  const store = loadKernel().createMemoryPaymentClaims();
  const noisy = '  AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA  ';
  const first = fakePorts({ claims: store, sendPaid: async () => paidResponse({ settlement: { success: true, transaction: noisy, payer: 'PAYER', network: 'stellar:testnet', amount: '100000' } }) });
  const one = await loadKernel().createX402Payment(spec({ url: 'https://example.test/api?service=first-plan' }), first).run(opWith(authority()), runIo());
  assert.equal(one.status, 'verified');
  assert.equal(one.receipt.evidence.txHash, 'a'.repeat(64), 'the hash is normalized once');

  const second = fakePorts({ claims: store, sendPaid: async () => paidResponse({ settlement: { success: true, transaction: 'A'.repeat(64), payer: 'PAYER', network: 'stellar:testnet', amount: '100000' } }) });
  const twice = await loadKernel().createX402Payment(spec({ url: 'https://example.test/api?service=second-plan' }), second).run(opWith(authority()), runIo());
  assert.equal(twice.status, 'not_verified');
  assert.equal(twice.output, null);
  assert.equal(twice.receipt.verification.checks.transactionUnique, false);
  assert.ok(twice.receipt.notCovered.includes('transactionUnique'));

  const noHash = fakePorts({
    claims: store,
    sendPaid: async () => paidResponse({ settlement: { success: true, payer: 'PAYER', network: 'stellar:testnet', amount: '100000' } }),
  });
  const silent = await loadKernel().createX402Payment(spec({ url: 'https://example.test/api?service=third-plan' }), noHash).run(opWith(authority()), runIo());
  assert.equal(silent.status, 'not_verified');
  assert.equal(noHash.calls.claimTransaction, 0, 'no hash, nothing claimed');
});

test('K4-F5 the in-memory claims store refuses what it cannot identify and separates networks', async () => {
  const store = loadKernel().createMemoryPaymentClaims();
  assert.equal(store.claimTransaction('stellar:testnet', 'a'.repeat(64)), 'claimed');
  assert.equal(store.claimTransaction('stellar:testnet', 'A'.repeat(64)), 'duplicate');
  assert.equal(store.claimTransaction('stellar:pubnet', 'a'.repeat(64)), 'claimed', 'another network is another transaction');
  for (const bad of ['', '   ', 'not-a-hash', null, 42, undefined]) {
    assert.equal(store.claimTransaction('stellar:testnet', bad), 'capacity', String(bad));
  }
  assert.equal(store.reserveEffect('c'.repeat(64)), 'claimed');
  assert.equal(store.reserveEffect('C'.repeat(64)), 'duplicate');
  for (const bad of ['', 'zz', null, {}, 7]) {
    assert.equal(store.reserveEffect(bad), 'capacity', String(bad));
  }
});

test('K4-F6 the claims capacity is an integer within bounds and anything else falls back to the default', () => {
  const { createMemoryPaymentClaims } = loadKernel();
  for (const [label, options] of Object.entries({
    'zero': { capacity: 0 },
    negative: { capacity: -1 },
    fraction: { capacity: 1.5 },
    'as string': { capacity: '1' },
    'over the bound': { capacity: 10001 },
    'not an object': 'capacity',
    'no options': undefined,
  })) {
    const store = createMemoryPaymentClaims(options);
    assert.equal(store.reserveEffect('d'.repeat(64)), 'claimed', label);
    for (let i = 0; i < 9999; i += 1) store.reserveEffect(String(i).padStart(64, '0'));
    assert.equal(store.reserveEffect('e'.repeat(64)), 'capacity', `${label}: the default holds ten thousand`);
  }
  const small = createMemoryPaymentClaims({ capacity: 1 });
  assert.equal(small.reserveEffect('f'.repeat(64)), 'claimed');
  assert.equal(small.reserveEffect('0'.repeat(64)), 'capacity');
});
// =====================================================================================
// Group G — compatibility, continuity and the settlement verdict over a synthetic readback
// (cases 22, 23 and 24)
// =====================================================================================

const SEALED_RECEIPT = path.join(__dirname, '..', 'demo', 'x402', 'receipts', 'live-testnet-2026-10-02.json');
const SEALED_DIGEST = '0276794d68e0eb0fc25f4db3ed3991252c59d29c317277067e75cc02df8c4265';
const SEALED_TX = 'abb968e86d8997f6f555c4efe50dd5a70671dc5064b8220a7f2ea221de7650d5';
const USDC = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

test('K4-G1 the sealed live receipt keeps its digest, and a receipt rebuilt from it has the same one', () => {
  const sealed = JSON.parse(fs.readFileSync(SEALED_RECEIPT, 'utf8'));
  assert.equal(sealed.digest, SEALED_DIGEST);
  assert.equal(sealed.evidence.txHash, SEALED_TX);
  assert.equal(verifyReceipt(sealed).ok, true);
  assert.equal(sealed.anchor.status, 'pending');
  assert.deepEqual(sealed.notCovered, ['external anchor']);
  const rebuilt = buildReceipt({
    operation: { id: 'op-mur9yczl-0', goal: 'obtain-marketing-plan (demo)' },
    capabilityId: 'x402-marketing-plan',
    authority: {
      spend: [{ asset: `USDC:${USDC}`, maxAmount: '500000', to: 'GD7MPNDYJO6YOQJ2NTSWDN2QDPZWORG2J7L7SCVIXU3IGVOMJNGZUV6J' }],
      approval: 'preauthorized',
    },
    outcome: {
      status: 'verified',
      exercised: [{ asset: `USDC:${USDC}`, amount: '100000', to: 'GD7MPNDYJO6YOQJ2NTSWDN2QDPZWORG2J7L7SCVIXU3IGVOMJNGZUV6J' }],
    },
    evidence: sealed.evidence,
    verification: sealed.verification,
    at: sealed.at,
  });
  assert.equal(rebuilt.digest, SEALED_DIGEST, 'a receipt built without the new module keeps its previous digest');
  assert.deepEqual(rebuilt, sealed);
});

test('K4-G2 no public export was removed or renamed by the new module', () => {
  const operation = require('../src/operation.js');
  const authority = require('../src/authority.js');
  const receipt = require('../src/receipt.js');
  const continuity = require('../src/continuity.js');
  const time = require('../src/time.js');
  const delegation = require('../src/delegation.js');
  assert.deepEqual(Object.keys(operation).sort(), ['DEFAULT_EXIT', 'STATES', 'createOperation', 'pauseOperation', 'resumeOperation', 'runOperation']);
  assert.deepEqual(Object.keys(authority).sort(), ['grantSpend', 'sufficient']);
  assert.deepEqual(Object.keys(receipt).sort(), ['anchorReceipt', 'anchorReceiptAsync', 'buildReceipt', 'verifyReceipt']);
  assert.deepEqual(Object.keys(continuity), ['resumeFromReceipts']);
  assert.deepEqual(Object.keys(time), ['parseTime']);
  assert.ok(Object.keys(delegation).length > 0);
  assert.deepEqual(Object.keys(require('../src/x402.js')).sort(), ['createMemoryPaymentClaims', 'createX402Payment', 'selectX402Terms']);
});

test('K4-G3 continuity: an exercised not_verified asks for reconciliation and an unanchored verified is not resumable', async () => {
  const uncertainPorts = fakePorts({
    sendPaid: async () => paidResponse({ settlement: { success: false, transaction: TX_HASH, payer: 'PAYER', network: 'stellar:testnet', amount: '100000' } }),
  });
  const uncertain = await runOnce(uncertainPorts);
  assert.equal(uncertain.status, 'not_verified');
  assert.equal(uncertainPorts.calls.claimTransaction, 1);
  const agreement = { approved: [{ action: 'pay', maxAttempts: 3 }] };
  const pending = resumeFromReceipts([uncertain.receipt], agreement, { verifyExternal: () => true });
  assert.equal(pending.needsPerson, true);
  assert.equal(pending.reason, 'reconciliation_required');
  assert.equal(pending.nextAction, null);

  const settled = await runOnce(fakePorts());
  assert.equal(settled.status, 'verified');
  assert.equal(settled.receipt.anchor.status, 'pending');
  const withoutAnchor = resumeFromReceipts([settled.receipt], agreement, { verifyExternal: () => true });
  assert.equal(withoutAnchor.needsPerson, true, 'a verified payment with no external anchor does not continue by itself');
  assert.match(withoutAnchor.reason, /returns to the person/);
  const local = resumeFromReceipts([settled.receipt], { approved: [{ action: 'pay', localReversible: true }] }, { verifyLocal: () => true });
  assert.equal(local.needsPerson, false, 'only an explicitly local, reversible action may use the local receipt');
});

// A synthetic readback with the shape the reference bridge reads: an invocation, its authorization
// entry, the ledger sequence and the balance changes. Synthetic on purpose — no envelope, no XDR and
// no historical transaction is reproduced here, and nothing in this file proves a live payment.
function readback(over = {}) {
  const entry = {
    payer: over.payer || 'PAYER',
    expiration: over.expiration === undefined ? 1010 : over.expiration,
    signature: over.signature === undefined ? ['sig'] : over.signature,
    subInvocations: over.subInvocations || [],
    assetContract: over.assetContract || 'TOKEN',
    payTo: over.payTo || 'RECIPIENT',
    amount: over.amount || '100000',
  };
  return {
    successful: over.successful === undefined ? true : over.successful,
    ledger: over.ledger === undefined ? 1000 : over.ledger,
    hash: over.hash === undefined ? TX_HASH : over.hash,
    entry,
    changes: over.changes === undefined ? [{
      asset_code: 'USDC', asset_issuer: ISSUER, from: 'TOKEN', to: entry.payTo, amount: '0.0100000',
    }] : over.changes,
    pageIncomplete: over.pageIncomplete === true,
  };
}

// The rules the reference settlement verification applies, expressed without any SDK: an invocation
// of `transfer` on the asset contract, an authorization entry for the payer with a signature and no
// sub-invocations inside the window, an exactly one balance change to the recipient, and a complete
// page. The contract has to carry this verdict and nothing else.
function simulatedSettlementPort(data, expected) {
  return async (evidence, request) => {
    const want = request.expected || expected;
    const fail = (reason, checks = {}) => ({ verified: false, checks, reason });
    if (data.hash !== evidence.txHash) return fail('Horizon transaction hash does not match requested hash');
    if (data.successful !== true) return fail('transaction not successful');
    if (!Number.isSafeInteger(data.ledger) || data.ledger < 0) return fail('transaction ledger is missing or invalid');
    if (data.pageIncomplete) return fail('Horizon operation page is not complete');
    const entry = data.entry;
    if (entry.expiration <= data.ledger) return fail('payer authorization expiration is outside the permitted window');
    if (entry.subInvocations.length !== 0) return fail('payer authorization contains sub-invocations');
    if (entry.signature.length === 0) return fail('authorization signature is missing or unsupported');
    if (entry.payer !== want.payer) return fail('payer authorization entry is missing', { authorization: false });
    if (entry.assetContract !== want.asset) return fail('invocation contract does not match the asset contract', { invocation: false });
    if (entry.payTo !== want.payTo || entry.amount !== want.amount) return fail('payer authorization does not match the transfer', { invocation: false });
    if (request.authDigest !== AUTH_DIGEST) return fail('authorization digest does not match the current payload', { authorization: false });
    const changes = data.changes.filter((change) => change.asset_code === 'USDC' && change.asset_issuer === ISSUER && change.to === want.payTo);
    if (changes.length !== 1) return fail('expected exactly one USDC transfer to recipient', { transfer: false });
    const atomic = BigInt(changes[0].amount.replace('.', '').padEnd(7, '0').replace(/(\d+)0*$/, '$1'));
    if (atomic !== BigInt(want.amount)) return fail('transfer amount does not match exact amount', { exactAmount: false });
    return {
      verified: true,
      checks: { invocation: true, authorization: true, transfer: true, payer: true, source: true, exactAmount: true },
      reason: 'settlement matches exact declared effect',
    };
  };
}

test('K4-G4 the settlement verdict decides the receipt, and a negative readback is never a verified payment', async () => {
  const refusals = {
    'classic invocation with an equal event on another payer': readback({ payer: 'SOMEONE-ELSE' }),
    'a sub-invocation inside the authorization': readback({ subInvocations: ['transfer'] }),
    'a pending signature': readback({ signature: [] }),
    'a different payer': readback({ payer: 'OTHER' }),
    'a different asset contract': readback({ assetContract: 'OTHER' }),
    'a different recipient': readback({ payTo: 'OTHER' }),
    'a different amount': readback({ amount: '400000' }),
    'a different hash': readback({ hash: 'b'.repeat(64) }),
    'an unsuccessful transaction': readback({ successful: false }),
    'an incomplete operation page': readback({ pageIncomplete: true }),
    'no ledger sequence': readback({ ledger: null }),
    'no transfer to the recipient': readback({ changes: [] }),
    'two transfers to the recipient': readback({ changes: [
      { asset_code: 'USDC', asset_issuer: ISSUER, from: 'TOKEN', to: 'RECIPIENT', amount: '0.0100000' },
      { asset_code: 'USDC', asset_issuer: ISSUER, from: 'TOKEN', to: 'RECIPIENT', amount: '0.0100000' },
    ] }),
  };
  for (const [label, data] of Object.entries(refusals)) {
    const ports = fakePorts({ sendPaid: async () => paidResponse(), verifySettlement: simulatedSettlementPort(data) });
    const res = await runOnce(ports);
    assert.equal(res.status, 'not_verified', label);
    assert.equal(res.output, null, label);
    assert.equal(res.receipt.verification.checks.settlement, false, label);
    assert.ok(res.receipt.notCovered.some((name) => name.startsWith('settlement')), label);
  }
  const positive = fakePorts({ sendPaid: async () => paidResponse(), verifySettlement: simulatedSettlementPort(readback()) });
  const res = await runOnce(positive);
  assert.equal(res.status, 'verified');
  assert.equal(res.receipt.verification.checks.settlement, true);
  assert.equal(res.receipt.verification.checks.settlement_invocation, true);
  assert.equal(res.receipt.verification.checks.settlement_exactAmount, true);
  assert.deepEqual(res.receipt.coverage.sort(), [
    'delivery', 'prepared', 'settlement', 'settlement_authorization', 'settlement_exactAmount',
    'settlement_invocation', 'settlement_payer', 'settlement_source', 'settlement_transfer',
    'terms', 'transactionUnique',
  ]);
});

test('K4-G5 the settlement port is asked about the declared effect, never about what the answer said', async () => {
  let seen = null;
  const ports = fakePorts({
    sendPaid: async () => paidResponse(),
    verifySettlement: async (evidence, request) => {
      seen = request;
      return { verified: true, checks: { invocation: true }, reason: 'settlement matches exact declared effect' };
    },
  });
  await runOnce(ports);
  assert.deepEqual(seen.expected, { network: 'stellar:testnet', asset: 'TOKEN', payer: 'PAYER', payTo: 'RECIPIENT', amount: '100000' });
  assert.equal(seen.authDigest, AUTH_DIGEST);
  assert.equal(typeof seen.signal.aborted, 'boolean');
  assert.equal(seen.expected.grantAsset, undefined, 'the grant asset is not part of the protocol effect');
});
// =====================================================================================
// Group H — hardening: the reasons name a public code, the engine's budget stops the run, and
// two runs of the same payment never share private state (cases 12, 17 and the limits)
// =====================================================================================

test('K4-H1 every refusal on a receipt names a code from the catalog and no text written by a port', async () => {
  const seen = [];
  const refusals = {
    SETTLEMENT_REJECTED: fakePorts({
      sendPaid: async () => paidResponse({ settlement: { success: true, transaction: TX_HASH, payer: 'SOMEONE-ELSE', network: 'stellar:testnet', amount: '100000' } }),
    }),
    DELIVERY_REJECTED: fakePorts({ sendPaid: async () => paidResponse({ readBody: async () => ({ title: 'only a title' }) }) }),
    VERIFIER_FAILED: fakePorts({ sendPaid: async () => paidResponse(), verifySettlement: async () => ({ verified: true, checks: { invocation: false }, reason: '' }) }),
  };
  // The transaction case needs two runs: the first claims it, the second finds it claimed.
  const store = loadKernel().createMemoryPaymentClaims();
  const claimedOnce = fakePorts({ claims: store, sendPaid: async () => paidResponse({ settlement: { success: true, transaction: 'd'.repeat(64), payer: 'PAYER', network: 'stellar:testnet', amount: '100000' } }) });
  assert.equal((await runOnce(claimedOnce)).status, 'verified');
  for (const [code, ports] of Object.entries(refusals)) {
    const res = await runOnce(ports);
    assert.equal(res.status, 'not_verified', code);
    const reason = res.receipt.verification.reason;
    seen.push(reason);
    assert.match(reason, new RegExp(code), `${code} is named in the reason`);
    assert.equal(/facilitator|horizon|https?:|PUBLIC-AUTH/.test(reason), false, reason);
  }
  assert.equal(store.claimTransaction('stellar:testnet', 'd'.repeat(64)), 'duplicate');
  const repeated = fakePorts({ claims: store, sendPaid: async () => paidResponse({ settlement: { success: true, transaction: 'd'.repeat(64), payer: 'PAYER', network: 'stellar:testnet', amount: '100000' } }) });
  const again = await loadKernel().createX402Payment(spec({ url: 'https://example.test/api?service=twice' }), repeated).run(opWith(authority()), runIo());
  assert.equal(again.status, 'not_verified');
  assert.match(again.receipt.verification.reason, /DUPLICATE_TRANSACTION/);
});

test('K4-H2 the engine budget stops the run, the signal is cancelled and nothing is sent twice', async () => {
  let signal = null;
  let sends = 0;
  const ports = fakePorts({
    sendPaid: async (request) => {
      sends += 1;
      signal = request.signal;
      return new Promise(() => {});
    },
  });
  const res = await runOnce(ports, { performTimeoutMs: 40 });
  assert.equal(sends, 1);
  assert.equal(res.status, 'not_verified');
  assert.equal(res.receipt.verification.verified, false);
  assert.deepEqual(res.receipt.authority.exercised, [{ asset: 'USDC:TOKEN', maxAmount: '100000', to: 'RECIPIENT' }]);
  await delay(80);
  assert.equal(signal.aborted, true, 'the engine cancelled the signal it owns');
  assert.equal(sends, 1, 'a cancelled run is never retried by this module');
});

test('K4-H3 a port that ignores cancellation cannot turn a stopped run into a verified one', async () => {
  let late = null;
  const ports = fakePorts({
    sendPaid: async (request) => new Promise((resolve) => {
      request.signal.addEventListener('abort', () => {
        // The host keeps acting after the contract gave up: it answers anyway, late.
        setTimeout(() => { late = 'answered'; resolve(paidResponse()); }, 60);
      }, { once: true });
    }),
  });
  const res = await runOnce(ports, { performTimeoutMs: 30 });
  assert.equal(res.status, 'not_verified');
  await delay(140);
  assert.equal(late, 'answered', 'the port really did answer after the abort');
  assert.equal(res.output, null, 'the receipt written before the answer is not upgraded');
  assert.equal(res.receipt.verification.verified, false);
});

test('K4-H4 run refuses a malformed operation and leaves the engine states it owns alone', async () => {
  const { createX402Payment } = loadKernel();
  const ports = fakePorts();
  const payment = createX402Payment(spec(), ports);
  for (const bad of [null, undefined, 'op', 42, []]) {
    await assert.rejects(() => payment.run(bad, runIo()), (err) => err.code === 'VESPI_X402_INVALID_SPEC', String(bad));
  }
  assert.equal(ports.calls.discover, 0);

  // paused stays the engine's own state: a paused operation is not run, and nobody else may resume it
  const paused = opWith(authority({ pausers: ['ana'] }));
  const { pauseOperation } = require('../src/operation.js');
  pauseOperation(paused, 'ana');
  const stopped = await payment.run(paused, runIo());
  assert.equal(stopped.status, 'paused');
  assert.equal(ports.calls.discover, 0, 'a paused operation never reaches a port');
  assert.throws(() => pauseOperation(paused, 'mallory'), /not authorized to pause/);
});

test('K4-H5 two runs of the same payment at once keep their own private context', async () => {
  const first = fakePorts({ sendPaid: async () => paidResponse({ settlement: { success: true, transaction: '1'.repeat(64), payer: 'PAYER', network: 'stellar:testnet', amount: '100000' } }) });
  const second = fakePorts({ sendPaid: async () => paidResponse({ settlement: { success: true, transaction: '2'.repeat(64), payer: 'PAYER', network: 'stellar:testnet', amount: '100000' } }) });
  const payment = loadKernel().createX402Payment(spec(), first);
  const other = loadKernel().createX402Payment(spec(), second);
  const [a, b] = await Promise.all([payment.run(opWith(authority()), runIo()), other.run(opWith(authority()), runIo())]);
  assert.equal(a.status, 'verified');
  assert.equal(b.status, 'verified');
  assert.equal(a.receipt.evidence.txHash, '1'.repeat(64));
  assert.equal(b.receipt.evidence.txHash, '2'.repeat(64));
  assert.equal(a.receipt.digest, a.receipt.digest);
  assert.notEqual(a.receipt.digest, b.receipt.digest);
  assert.equal(verifyReceipt(a.receipt).ok, true);
  assert.equal(verifyReceipt(b.receipt).ok, true);
});
// =====================================================================================
// Group I — the shape of the reference bridge, checked without running it
// (the demo package has its own dependencies and they are not installed in this checkout)
// =====================================================================================

const DEMO = path.join(__dirname, '..', 'demo', 'x402');

function readDemo(name) {
  return fs.readFileSync(path.join(DEMO, name), 'utf8');
}

test('K4-I1 the bridge implements the six ports the contract asks for and imports the kernel only through the contract', () => {
  const ports = readDemo('ports.js');
  for (const port of ['discover', 'sendPaid', 'prepare', 'inspectPrepared', 'verifySettlement', 'validateOutput']) {
    assert.match(ports, new RegExp(`\\b${port}\\b`), `ports.js declares ${port}`);
  }
  assert.match(ports, /createRequire\(import\.meta\.url\)/);
  assert.match(ports, /require\('\.\.\/\.\.\/src\/x402\.js'\)/, 'the bridge reaches the kernel through x402.js');
  for (const forbidden of [/require\('\.\.\/\.\.\/src\/(operation|receipt|authority|continuity)\.js'\)/, /from '\.\.\/\.\.\/src\//]) {
    assert.doesNotMatch(ports, forbidden, 'the bridge does not reach into kernel internals');
  }
  // It carries the network, the SDK and the horizon: that is what stayed outside the kernel.
  assert.match(ports, /@stellar\/stellar-sdk/);
  assert.match(ports, /@x402\/fetch/);
  assert.match(ports, /verifySettlement/);
  assert.match(ports, /isMarketingPlan/, 'the body is validated against the marketing-plan schema');
  assert.match(ports, /MAX_BODY_BYTES/, 'the body is bounded before it is parsed');
});

test('K4-I2 the demo runner consumes the contract and the historical adapter stays where its own tests find it', () => {
  const runner = readDemo('run.js');
  assert.match(runner, /createMarketingPlanPayment/);
  assert.match(runner, /payment\.run\(/);
  assert.doesNotMatch(runner, /x402Capability/, 'the runner no longer drives the adapter capability directly');
  assert.doesNotMatch(runner, /verifySettlement/, 'the runner no longer supplies its own verifier');
  const adapter = readDemo('capability.js');
  assert.match(adapter, /export function x402Capability/, 'the historical adapter is untouched');
  assert.match(adapter, /export \{ claimSettlement, claimTransaction/);
  const manifest = JSON.parse(readDemo('package.json'));
  for (const suite of ['capability.adversarial.mjs', 'verify.test.mjs', 'settlement-finalization.test.mjs', 'settlement-response.test.mjs', 'idempotency.test.mjs']) {
    assert.ok(manifest.scripts.test.includes(suite), `${suite} is still in the demo suite`);
  }
  assert.equal(manifest.dependencies['@stellar/stellar-sdk'].startsWith('^'), true);
  assert.equal(Object.keys(manifest.dependencies).length, 6, 'the six demo dependencies are untouched');
});

test('K4-I3 the kernel package gains no dependency and no export surface', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(manifest.private, true);
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.exports, undefined);
  assert.equal(manifest.version, '0.1.4');
  const lockfile = path.join(DEMO, 'package-lock.json');
  assert.equal(fs.existsSync(lockfile), true, 'the demo lockfile is in place');
  assert.match(fs.readFileSync(lockfile, 'utf8'), /@stellar\/stellar-sdk/);
});