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
  const claims = over.claims;
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
        return { status: 402, paymentRequired: paymentRequired() };
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
      return { ok: true, output: body, digest: createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex') };
    },
  };
  if (claims) ports.claims = claims;
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