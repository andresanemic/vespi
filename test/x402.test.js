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