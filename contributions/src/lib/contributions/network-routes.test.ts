import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Horizon } from '@stellar/stellar-sdk';
import { Account, FeeBumpTransaction, Keypair, Memo, Networks, Operation, Transaction, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { canonicalBytes } from './kernel/contributions.js';
import type { ContributionNetwork } from './network';
import './test-imports.mjs';

const { assignmentMessage }: typeof import('./contribution-assignment') = await import(new URL('contribution-assignment.ts', import.meta.url).href);
const { onboardingToken }: typeof import('./stellar-server') = await import(new URL('stellar-server.ts', import.meta.url).href);
const { encounterAnchorMessage, encounterFingerprintStatement, proposalMessage, sessionMessage }: typeof import('./encounters') =
  await import(new URL('encounters.ts', import.meta.url).href);
const { PER_IP }: typeof import('./rate-limit') = await import(new URL('rate-limit.ts', import.meta.url).href);

const routes = [
  ['account', 'POST'], ['activity/[account]', 'GET'], ['chains/[digest]', 'GET'],
  ['encounters', 'POST'], ['encounters', 'GET'], ['feebump', 'POST'], ['photos', 'POST'], ['photos/[digest]', 'GET'],
  ['profiles', 'POST'], ['profiles', 'GET'], ['profiles/[account]', 'GET'],
  ['receipts/[digest]', 'GET'], ['receipts/anchor', 'POST'], ['receipts/index', 'GET'], ['receipts/prepare', 'POST'],
  ['survey', 'POST'], ['survey/report', 'POST'], ['team/survey', 'POST'],
] as const;
type Route = typeof routes[number][0];
type Method = typeof routes[number][1];
type RouteHandler = (request: Request, context: { params: Promise<{ digest: string; account: string }> }) => Promise<Response>;
const handlers = new Map<string, RouteHandler>();
for (const [route, method] of routes) {
  const routeModule = await import(new URL('../../app/api/contributions/' + route + '/route.ts', import.meta.url).href);
  handlers.set(method + route, routeModule[method]);
}

const keys = [1, 2, 3, 4, 5, 6].map(n => Keypair.fromRawEd25519Seed(Buffer.alloc(32, n)));
const [actor, contributor, outsider, testSponsor, mainSponsor, channel] = keys;
const actorId = actor.publicKey();
const digest = 'a'.repeat(64);
const tokenTest = 't'.repeat(32);
const tokenMain = 'm'.repeat(32);
const required = {
  CONTRIB_SPONSOR_SECRET_MAINNET: mainSponsor.secret(),
  CONTRIB_CHANNEL_SECRETS_MAINNET: channel.secret(),
  CONTRIB_SPONSOR_BUDGET_STROOPS_MAINNET: '200000000',
  CONTRIB_SPONSOR_MAX_FEE_MAINNET: '2000',
  CONTRIB_SPONSOR_MAX_RESERVE_MAINNET: '10000000',
  CONTRIB_SPONSOR_EXPIRES_AT_MAINNET: '2099-01-01T00:00:00Z',
  CONTRIB_ALLOWED_ACCOUNTS_MAINNET: [actorId, contributor.publicKey()].join(','),
  CONTRIB_KV_MAINNET_REST_API_URL: 'https://main-store.invalid',
  CONTRIB_KV_MAINNET_REST_API_TOKEN: 'main-redis',
  CONTRIB_TOKEN_KEY_MAINNET: tokenMain,
};

let fixtureTime = Date.now();
function configure(t: TestContext) {
  fixtureTime += 61_000;
  t.mock.timers.enable({ apis: ['Date'], now: fixtureTime });
  const env = {
    ...required,
    CONTRIB_SPONSOR_SECRET: testSponsor.secret(), CONTRIB_CHANNEL_SECRETS: channel.secret(),
    CONTRIB_SPONSOR_BUDGET_STROOPS: '100000000', CONTRIB_SPONSOR_MAX_FEE: '1000',
    CONTRIB_SPONSOR_MAX_RESERVE: '10000000', CONTRIB_SPONSOR_EXPIRES_AT: '2099-01-01T00:00:00Z',
    CONTRIB_ALLOWED_ACCOUNTS: actorId, CONTRIB_TOKEN_KEY: tokenTest,
    CONTRIB_KV_REST_API_URL: 'https://test-store.invalid', CONTRIB_KV_REST_API_TOKEN: 'test-redis',
  };
  const previous = Object.keys(env).map(name => [name, process.env[name]] as const);
  Object.assign(process.env, env);
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

let requestId = 0;
function invoke(route: Route, method: Method, body?: Record<string, unknown>, query = '', headers?: HeadersInit) {
  const handler = handlers.get(method + route);
  assert.ok(handler);
  const path = route.replace('[digest]', digest).replace('[account]', actorId);
  const requestHeaders = new Headers(headers);
  requestHeaders.set('x-forwarded-for', 'test-' + requestId++);
  return handler(new Request('https://example.invalid/api/contributions/' + path + query, {
    method, body: body === undefined ? undefined : JSON.stringify(body), headers: requestHeaders,
  }), { params: Promise.resolve({ digest, account: actorId }) });
}

async function assertFailure(response: Response, status: number, reason: string) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { ok: false, reason });
}

function blockServices(t: TestContext) {
  const unexpected = () => { throw new Error('Unexpected service call'); };
  const calls = [
    t.mock.method(globalThis, 'fetch', unexpected),
    t.mock.method(Horizon.Server.prototype, 'loadAccount', unexpected),
    t.mock.method(Horizon.Server.prototype, 'transactions', unexpected),
    t.mock.method(Horizon.Server.prototype, 'feeStats', unexpected),
    t.mock.method(Horizon.Server.prototype, 'ledgers', unexpected),
    t.mock.method(Horizon.Server.prototype, 'submitTransaction', unexpected),
  ];
  t.after(() => {
    for (const mock of calls) assert.equal(mock.mock.callCount(), 0);
  });
}

test('network discovery returns only mainnet eligibility without connecting to services', async t => {
  configure(t);
  blockServices(t);
  const { GET } = await import(new URL('../../app/api/contributions/network/route.ts', import.meta.url).href);
  const check = async (query: string, mainnet: boolean) => {
    const response = await GET(new Request('https://example.invalid/api/contributions/network' + query));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await response.json(), { mainnet });
  };
  await check('?account=' + actorId, true);
  await check('?account=' + outsider.publicKey(), false);
  await check('?account=invalid', false);
  await check('', false);
  await check('?account=' + actorId + '&account=' + outsider.publicKey(), false);
  delete process.env.CONTRIB_TOKEN_KEY_MAINNET;
  await check('?account=' + actorId, false);
});

test('network discovery limits lookups by IP, including invalid accounts', async t => {
  configure(t);
  blockServices(t);
  const { GET } = await import(new URL('../../app/api/contributions/network/route.ts', import.meta.url).href);
  const lookup = (ip: string, account: string) => GET(new Request(
    'https://example.invalid/api/contributions/network?account=' + account,
    { headers: { 'x-forwarded-for': ip } },
  ));
  for (let index = 0; index < PER_IP; index++) {
    assert.equal((await lookup('192.0.2.77', 'invalid')).status, 200);
  }
  const limited = await lookup('192.0.2.77, 192.0.2.99', actorId);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  assert.deepEqual(await limited.json(), { ok: false, reason: 'rate_limited' });
  const other = await lookup('192.0.2.78', actorId);
  assert.equal(other.status, 200);
  assert.deepEqual(await other.json(), { mainnet: true });
});

const receiptFields = {
  kind: 'REQUEST', role: 'requester', actor: actorId, statement: 'Revisa el documento', comment: null,
  chain: null, prev: null, subject: null, evidence: null, createdAt: '2026-11-17T03:00:00.000Z',
};
function signedReceipt(passphrase: string, overrides: Record<string, unknown> = {}, signer = actor) {
  const bytes = canonicalBytes({ ...receiptFields, ...overrides, actor: signer.publicKey() });
  const hash = createHash('sha256').update(bytes).digest();
  const tx = new TransactionBuilder(new Account(signer.publicKey(), '1'), { fee: '100', networkPassphrase: passphrase })
    .addMemo(Memo.hash(hash)).addOperation(Operation.bumpSequence({ bumpTo: '2' })).setTimeout(180).build();
  tx.sign(signer);
  return { bytes, xdr: tx.toXDR(), digest: hash.toString('hex') };
}

test('every mainnet entry point fails closed on incomplete configuration before Redis, Horizon or budget', async t => {
  configure(t);
  blockServices(t);
  delete process.env.CONTRIB_SPONSOR_SECRET_MAINNET;
  for (const [route, method] of routes) {
    await assertFailure(await invoke(route, method, method === 'POST' ? {} : undefined, '?network=mainnet'), 503, 'mainnet-unavailable');
  }
  process.env.CONTRIB_SPONSOR_SECRET_MAINNET = required.CONTRIB_SPONSOR_SECRET_MAINNET;
  for (const [key, value] of Object.entries(required)) {
    delete process.env[key];
    await assertFailure(await invoke('account', 'POST', { network: 'mainnet', action: 'prepare', publicKey: actorId }), 503, 'mainnet-unavailable');
    process.env[key] = value;
  }
  for (const empty of ['', '   ', ' , ,, ', 'not-a-public-key']) {
    process.env.CONTRIB_ALLOWED_ACCOUNTS_MAINNET = empty;
    await assertFailure(await invoke('receipts/index', 'GET', undefined, '?network=mainnet'), 503, 'mainnet-unavailable');
  }
});

test('unknown, repeated, conflicting and non-string network selectors are rejected before services', async t => {
  configure(t);
  blockServices(t);
  for (const query of ['?network=stellar:pubnet', '?network=', '?network=testnet&network=testnet', '?network=other']) {
    await assertFailure(await invoke('receipts/index', 'GET', undefined, query), 400, 'invalid-network');
  }
  for (const network of ['private', null, 1, true, ['mainnet'], { name: 'mainnet' }]) {
    await assertFailure(await invoke('account', 'POST', { network, action: 'prepare', publicKey: actorId }), 400, 'invalid-network');
  }
  await assertFailure(await invoke('account', 'POST', { network: 'mainnet' }, '?network=testnet'), 400, 'invalid-network');
});

test('mainnet denies accounts outside its list before any service', async t => {
  configure(t);
  blockServices(t);
  const account = outsider.publicKey();
  const mainnet = { network: 'mainnet' };
  const xdr = new TransactionBuilder(new Account(channel.publicKey(), '1'), { fee: '100', networkPassphrase: Networks.PUBLIC })
    .addOperation(Operation.beginSponsoringFutureReserves({ source: mainSponsor.publicKey(), sponsoredId: account }))
    .addOperation(Operation.createAccount({ source: mainSponsor.publicKey(), destination: account, startingBalance: '0' }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: account }))
    .setTimeout(60).build();
  xdr.sign(outsider);
  const token = onboardingToken(xdr.toXDR(), Buffer.from(tokenMain), 'mainnet');
  const draft = {
    type: 'charla', title: 'Charla', date: '2026-11-19', where: '', summary: '',
    a: { account, displayName: 'Otra persona' }, b: null, contributions: [{ from: 'a', text: 'Idea', url: '' }],
  };
  const requests = [
    invoke('account', 'POST', { ...mainnet, action: 'prepare', publicKey: account }),
    invoke('account', 'POST', { ...mainnet, action: 'complete', xdr: xdr.toXDR(), token }),
    invoke('receipts/prepare', 'POST', { ...receiptFields, ...mainnet, actor: account }),
    invoke('receipts/anchor', 'POST', { ...signedReceipt(Networks.PUBLIC, {}, outsider), ...mainnet }),
    invoke('profiles', 'POST', { account, ...mainnet }),
    invoke('encounters', 'POST', { id: digest.slice(0, 32), action: 'publish', draft, ...mainnet }),
    invoke('encounters', 'POST', { id: digest.slice(0, 32), action: 'respond', account, ...mainnet }),
  ];
  for (const response of await Promise.all(requests)) await assertFailure(response, 403, 'account-not-allowed');
});

test('mainnet rejects ATTEST, SURVEY, REPORT and photo evidence on prepare, anchor and the fee-bump alias', async t => {
  configure(t);
  blockServices(t);
  const cases = [
    { kind: 'ATTEST', role: 'observer', chain: digest, subject: 'b'.repeat(64) },
    { kind: 'SURVEY', role: 'respondent', evidence: { commitment: digest } },
    { kind: 'REPORT', role: 'organizer', evidence: { surveys: [], commitments: [],
      counts: { withAccount: 0, withoutAccount: 0, fallbackForm: 0 }, aggregate: { metricsWithheld: true } } },
    { evidence: { sha256: digest, uri: 'https://vespi.xyz/api/contributions/photos/' + digest } },
  ];
  for (const fields of cases) {
    const receipt = signedReceipt(Networks.PUBLIC, fields);
    await assertFailure(await invoke('receipts/prepare', 'POST', { ...receiptFields, ...fields, network: 'mainnet' }), 400, 'mainnet-not-supported');
    await assertFailure(await invoke('receipts/anchor', 'POST', { ...receipt, network: 'mainnet' }), 400, 'mainnet-not-supported');
    await assertFailure(await invoke('feebump', 'POST', receipt, '?network=mainnet'), 400, 'mainnet-not-supported');
  }
  for (const route of ['photos', 'survey', 'survey/report', 'team/survey'] as const) {
    await assertFailure(await invoke(route, 'POST', { network: 'mainnet' }), 400, 'mainnet-not-supported');
  }
  await assertFailure(await invoke('photos/[digest]', 'GET', undefined, '?network=mainnet'), 400, 'mainnet-not-supported');
});

test('each network rejects XDR signed for the other in receipt anchoring and account completion', async t => {
  configure(t);
  blockServices(t);
  for (const [target, source, sponsor, tokenKey] of [
    ['testnet', Networks.PUBLIC, testSponsor, tokenTest], ['mainnet', Networks.TESTNET, mainSponsor, tokenMain],
  ] as const) {
    await assertFailure(await invoke('receipts/anchor', 'POST', { ...signedReceipt(source), network: target }), 400, 'commitment-mismatch');
    const tx = new TransactionBuilder(new Account(channel.publicKey(), '1'), { fee: '100', networkPassphrase: source })
      .addOperation(Operation.beginSponsoringFutureReserves({ source: sponsor.publicKey(), sponsoredId: actorId }))
      .addOperation(Operation.createAccount({ source: sponsor.publicKey(), destination: actorId, startingBalance: '0' }))
      .addOperation(Operation.endSponsoringFutureReserves({ source: actorId }))
      .setTimeout(60).build();
    tx.sign(actor);
    const xdr = tx.toXDR();
    await assertFailure(await invoke('account', 'POST', { network: target, action: 'complete', xdr,
      token: onboardingToken(xdr, Buffer.from(tokenKey), target) }), 400, 'missing-participant-signature');
  }
});


const horizonNames = { testnet: 'https://horizon-testnet.stellar.org', mainnet: 'https://horizon.stellar.org' };
const passphrases = { testnet: Networks.TESTNET, mainnet: Networks.PUBLIC };
const sponsors = { testnet: testSponsor, mainnet: mainSponsor };
type HorizonInstance = InstanceType<typeof Horizon.Server>;
function horizonNetwork(server: HorizonInstance) {
  if (server.serverURL.origin === horizonNames.testnet) return 'testnet';
  assert.equal(server.serverURL.origin, horizonNames.mainnet);
  return 'mainnet';
}

test('concurrent anchors isolate Redis, sponsor budget and Horizon and send the exact hash they record', { timeout: 10000 }, async t => {
  configure(t);
  const states = {
    testnet: { records: new Map<string, string>(), hashes: new Map<string, FeeBumpTransaction>(), feeBid: 180, ledger: 101 },
    mainnet: { records: new Map<string, string>(), hashes: new Map<string, FeeBumpTransaction>(), feeBid: 350, ledger: 202 },
  };
  const bothAtHorizon = Promise.withResolvers<void>();
  const clients = new Map<ContributionNetwork, HorizonInstance>();
  t.mock.method(Horizon.Server.prototype, 'feeStats', async function (this: HorizonInstance) {
    const network = horizonNetwork(this);
    clients.set(network, this);
    if (clients.size === 2) bothAtHorizon.resolve();
    await bothAtHorizon.promise;
    return { fee_charged: { p90: String(states[network].feeBid) } };
  });
  t.mock.method(Horizon.Server.prototype, 'submitTransaction', async function (this: HorizonInstance, tx: FeeBumpTransaction) {
    assert.ok(tx instanceof FeeBumpTransaction);
    const network = horizonNetwork(this);
    const sponsor = sponsors[network];
    assert.equal(tx.feeSource, sponsor.publicKey());
    assert.equal(tx.networkPassphrase, passphrases[network]);
    assert.equal(Number(tx.fee), states[network].feeBid * 2);
    assert.ok(sponsor.verify(tx.hash(), tx.signatures[0].signature()));
    const hash = tx.hash().toString('hex');
    states[network].hashes.set(hash, tx);
    return { hash, ledger: states[network].ledger };
  });
  t.mock.method(Horizon.Server.prototype, 'transactions', function (this: HorizonInstance) {
    const state = states[horizonNetwork(this)];
    return { transaction: (hash: string) => ({ call: async () => {
      const tx = state.hashes.get(hash);
      assert.ok(tx, 'Horizon reconciliation must use the submitted hash on the same network');
      return { successful: true, ledger_attr: state.ledger, envelope_xdr: tx.toXDR(), created_at: new Date().toISOString() };
    } }) };
  });
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const network = url === 'https://main-store.invalid' ? 'mainnet' : 'testnet';
    const store = network === 'mainnet' ? 'main' : 'test';
    assert.equal(url, 'https://' + store + '-store.invalid');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + store + '-redis');
    const state = states[network];
    const args = JSON.parse(String(init.body));
    const receiptKey = 'contributions:' + network + ':receipts';
    if (args[0] === 'HGET') {
      assert.equal(args[1], receiptKey);
      return Response.json({ result: state.records.get(args[2]) ?? null });
    }
    assert.equal(args[0], 'EVAL');
    const key = args[3];
    const sponsor = sponsors[network].publicKey();
    if (key === 'contributions:' + network + ':sponsor-budget:' + sponsor) {
      assert.equal(args[6], network === 'mainnet' ? 200000000 : 100000000);
      assert.equal(args[5], state.feeBid * 2);
      assert.ok(Array.from(state.records.values()).some(row => JSON.parse(row).intent.hash === args[7]));
      return Response.json({ result: 'reserved' });
    }
    assert.equal(key, receiptKey);
    assert.ok(args[4] === 'reserve' || args[4] === 'confirm');
    state.records.set('receipt:' + args[5], args[9]);
    if (args[4] === 'confirm') {
      assert.ok(state.hashes.has(args[6]));
      return Response.json({ result: 1 });
    }
    return Response.json({ result: 'reserved' });
  });

  const networks = ['testnet', 'mainnet'] as const;
  const [testReceipt, mainReceipt] = networks.map(network => signedReceipt(passphrases[network]));
  assert.equal(testReceipt.digest, mainReceipt.digest);
  const responses = await Promise.all([
    invoke('receipts/anchor', 'POST', testReceipt), invoke('receipts/anchor', 'POST', mainReceipt, '?network=mainnet'),
  ]);
  for (const [index, response] of responses.entries()) {
    const network = networks[index];
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.index.network, network === 'mainnet' ? 'stellar:pubnet' : 'stellar:testnet');
    assert.equal(result.index.digest, testReceipt.digest);
    assert.equal(result.index.ledger, states[network].ledger);
    assert.ok(states[network].hashes.has(result.index.txHash));
  }
  assert.notEqual(clients.get('mainnet'), clients.get('testnet'));
  assert.notDeepEqual([...states.mainnet.hashes.keys()], [...states.testnet.hashes.keys()]);

  const prepare = await invoke('receipts/prepare', 'POST', { ...receiptFields, network: 'mainnet' }, '?network=mainnet');
  assert.deepEqual(await prepare.json(), { ok: true, bytes: mainReceipt.bytes, digest: mainReceipt.digest });
  const contribution = signedReceipt(Networks.PUBLIC,
    { kind: 'CONTRIBUTE', role: 'contributor', chain: mainReceipt.digest, prev: mainReceipt.digest }, contributor);
  const assignment = (network: ContributionNetwork) =>
    actor.sign(Buffer.from(assignmentMessage(mainReceipt.digest, contributor.publicKey(), network))).toString('hex');
  await assertFailure(await invoke('receipts/anchor', 'POST', { ...contribution, network: 'mainnet',
    assignment: assignment('testnet') }), 400, 'invalid-chain-link');
  const contributed = await invoke('receipts/anchor', 'POST', { ...contribution, network: 'mainnet', assignment: assignment('mainnet') });
  assert.equal(contributed.status, 200);
  const acceptance = signedReceipt(Networks.PUBLIC, { kind: 'ACCEPT', role: 'requester',
    chain: mainReceipt.digest, prev: contribution.digest, subject: contribution.digest });
  const accepted = await invoke('receipts/anchor', 'POST', { ...acceptance, network: 'mainnet' });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).index.network, 'stellar:pubnet');
  assert.equal(states.mainnet.hashes.size, 3);
  assert.equal(states.testnet.hashes.size, 1);

  const fingerprint = signedReceipt(Networks.PUBLIC, {
    statement: 'Huella de un registro de Vespi Contributions', comment: 'vespi:encuentro:' + '1'.repeat(64),
  });
  assert.equal((await invoke('receipts/anchor', 'POST', fingerprint, '?network=mainnet')).status, 200);
  assert.equal(JSON.parse(states.mainnet.records.get('receipt:' + fingerprint.digest)!).intent.chain, null);
  const delivery = signedReceipt(Networks.PUBLIC,
    { kind: 'CONTRIBUTE', role: 'contributor', chain: fingerprint.digest, prev: fingerprint.digest }, contributor);
  const offer = actor.sign(Buffer.from(assignmentMessage(fingerprint.digest, contributor.publicKey(), 'mainnet'))).toString('hex');
  await assertFailure(await invoke('receipts/anchor', 'POST', { ...delivery, assignment: offer }, '?network=mainnet'),
    400, 'invalid-chain-link');
  const acceptFingerprint = signedReceipt(Networks.PUBLIC, { kind: 'ACCEPT', role: 'requester',
    chain: fingerprint.digest, prev: delivery.digest, subject: delivery.digest });
  await assertFailure(await invoke('receipts/anchor', 'POST', acceptFingerprint, '?network=mainnet'), 400, 'invalid-chain-link');
  assert.equal(states.mainnet.hashes.size, 4);
});

test('account preparation isolates leases even with the same channel, and mainnet releases only its bound hash', async t => {
  configure(t);
  let held: { tag: string; until: number } | undefined;
  const leaseTag = () => held?.tag;
  let budgetHash: string | undefined;
  let failRedis = false;
  let timeOut = false;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://main-store.invalid');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer main-redis');
    const [command, , keys, key, ...args] = JSON.parse(String(init.body));
    assert.equal(command, 'EVAL');
    assert.equal(keys, 1);
    if (failRedis) return new Response(null, { status: 503 });
    if (key === 'contributions:mainnet:channel-leases') {
      if (typeof args[0] === 'number') {
        const [now, until, , , tag, requested] = args;
        assert.equal(requested, channel.publicKey());
        assert.equal(until - now, 70);
        if (held && held.until >= now) return Response.json({ result: null });
        held = { tag, until };
        return Response.json({ result: requested });
      }
      const [source, tag, hash] = args;
      assert.equal(source, channel.publicKey());
      if (held?.tag !== tag) return Response.json({ result: 0 });
      if (hash === '') held = undefined;
      else {
        assert.ok(held);
        held.tag = hash;
      }
      return Response.json({ result: 1 });
    }
    assert.equal(key, 'contributions:mainnet:sponsor-budget:' + mainSponsor.publicKey());
    assert.equal(args[0], held?.tag);
    assert.equal(args[2], 200000000);
    budgetHash = args[3];
    return Response.json({ result: 'reserved' });
  });
  t.mock.method(Horizon.Server.prototype, 'loadAccount', async function (this: HorizonInstance, id: string) {
    const network = horizonNetwork(this);
    if (id !== channel.publicKey()) throw { response: { status: 404 } };
    return new Account(id, network === 'mainnet' ? '79' : '39');
  });
  t.mock.method(Horizon.Server.prototype, 'submitTransaction', async function (this: HorizonInstance, tx: Transaction) {
    assert.equal(horizonNetwork(this), 'mainnet');
    assert.equal(tx.hash().toString('hex'), held?.tag);
    assert.equal(tx.hash().toString('hex'), budgetHash);
    assert.equal(tx.signatures.length, 3);
    if (timeOut) throw { response: { status: 504 } };
    return { hash: budgetHash, ledger: 321 };
  });
  const lookup = t.mock.method(Horizon.Server.prototype, 'transactions', function (this: HorizonInstance) {
    assert.equal(horizonNetwork(this), 'mainnet');
    return { transaction: (hash: string) => {
      assert.equal(hash, held?.tag);
      return { call: async () => { throw { response: { status: 404 } }; } };
    } };
  });
  const prepare = (network?: ContributionNetwork) =>
    invoke('account', 'POST', { action: 'prepare', publicKey: actorId, ...(network && { network }) });
  const [mainnet, testnet] = await Promise.all([prepare('mainnet'), prepare()]);
  assert.equal(mainnet.status, 200);
  assert.equal(testnet.status, 200);
  const main = await mainnet.json();
  const legacy = await testnet.json();
  assert.equal(main.channel, legacy.channel);
  assert.notEqual(main.token, legacy.token);
  const busy = await prepare('mainnet');
  await assertFailure(busy, 503, 'busy');
  assert.equal(busy.headers.get('Retry-After'), '2');
  const tx = new Transaction(main.xdr, Networks.PUBLIC);
  assert.equal(tx.sequence, '80');
  assert.equal(new Transaction(legacy.xdr, Networks.TESTNET).sequence, '40');
  assert.equal(held?.tag, tx.hash().toString('hex'));
  tx.sign(actor);
  const complete = await invoke('account', 'POST', { network: 'mainnet', action: 'complete', xdr: tx.toXDR(), token: main.token });
  assert.equal(complete.status, 200);
  assert.equal(held, undefined);
  failRedis = true;
  await assertFailure(await prepare('mainnet'), 503, 'channel-unavailable');
  failRedis = false;
  timeOut = true;
  const pending = await (await prepare('mainnet')).json();
  const fresh = new Transaction(pending.xdr, Networks.PUBLIC);
  fresh.sign(actor);
  await assertFailure(await invoke('account', 'POST', { network: 'mainnet', action: 'complete',
    xdr: fresh.toXDR(), token: pending.token }), 409, 'retry');
  assert.equal(lookup.mock.callCount(), 1);
  assert.equal(leaseTag(), fresh.hash().toString('hex'));
  await assertFailure(await prepare('mainnet'), 503, 'busy');
});

test('mainnet encounter reads and unsigned actions stop before Redis without an eligible session', async t => {
  configure(t);
  blockServices(t);
  const id = 'c'.repeat(32);
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const cookie = (signer: Keypair, network: ContributionNetwork) =>
    (network === 'mainnet' ? 'vespi-encounters-mainnet' : 'vespi-encounters') + '=' +
    signer.publicKey() + '.' + expires + '.' + signer.sign(Buffer.from(sessionMessage(signer.publicKey(), expires, network))).toString('hex');
  const query = '?id=' + id + '&network=mainnet';
  await assertFailure(await invoke('encounters', 'GET', undefined, query), 401, 'sign-in');
  await assertFailure(await invoke('encounters', 'GET', undefined, query, { Cookie: cookie(actor, 'testnet') }), 401, 'sign-in');
  await assertFailure(await invoke('encounters', 'GET', undefined, query, { Cookie: cookie(outsider, 'mainnet') }), 403, 'account-not-allowed');
  await assertFailure(await invoke('encounters', 'POST', { id, action: 'respond', account: actorId, network: 'mainnet' }), 401, 'sign-in');
});

test('logout expires only its own session even if its response arrives after the next sign-in', async t => {
  configure(t);
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const [command, key, field] = JSON.parse(String(init.body));
    assert.equal(command, 'HGET');
    assert.match(key, /:profiles$/);
    return Response.json({ result: field === actorId ? 'Ana' : 'Francisco' });
  });
  const expires = Math.floor(Date.now() / 1000) + 3600;
  for (const network of ['testnet', 'mainnet'] as const) {
    const jar = new Map<string, string>();
    const headers = () => ({ Cookie: [...jar].map(([name, value]) => name + '=' + value).join('; ') });
    function apply(response: Response) {
      assert.equal(response.status, 200);
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(';');
        const [name, value] = pair.split('=');
        if (value) jar.set(name, value);
        else jar.delete(name);
      }
    }
    const post = (body: object) => invoke('encounters', 'POST', { ...body, network }, '', headers());
    const login = (signer: Keypair, sessionId: string) => {
      const account = signer.publicKey();
      const signature = signer.sign(Buffer.from(sessionMessage(account, expires, network, sessionId))).toString('hex');
      return post({ action: 'session', session: [account, expires, signature, sessionId].join('.') });
    };
    const viewer = async () => {
      const response = await invoke('encounters', 'GET', undefined, '?session=1&network=' + network, headers());
      assert.equal(response.status, 200);
      return (await response.json()).profile?.account ?? null;
    };
    const old = '1'.repeat(32);
    apply(await login(actor, old));
    assert.equal(await viewer(), actorId);
    const delayed = await post({ action: 'logout', account: actorId, sessionId: old });
    apply(await login(actor, '2'.repeat(32)));
    apply(delayed);
    assert.equal(await viewer(), actorId, 'Same account with a new session');
    apply(await login(contributor, '3'.repeat(32)));
    apply(await post({ action: 'logout', account: actorId, sessionId: old }));
    assert.equal(await viewer(), contributor.publicKey(), 'Different account when the old request reaches the server');
    apply(await post({ action: 'logout' }));
    assert.equal(await viewer(), null, 'Logout without client identification');

    const inflight = await login(actor, '4'.repeat(32));
    apply(await post({ action: 'logout', account: actorId, sessionId: '4'.repeat(32) }));
    apply(inflight);
    assert.equal(await viewer(), null, 'An earlier sign-in response cannot restore the closed session');
    const reused = await login(actor, '4'.repeat(32));
    assert.equal(reused.status, 409);
    assert.equal((await reused.json()).reason, 'session-closed', 'A closed session says so instead of a silent success');
    apply(await login(actor, '5'.repeat(32)));
    assert.equal(await viewer(), actorId, 'A new session signs in again');

    // Signing in clears the older format, so it cannot come back once the new session closes.
    const olderCookie = network === 'testnet' ? 'vespi-encounters' : 'vespi-encounters-mainnet';
    const signature = actor.sign(Buffer.from(sessionMessage(actorId, expires, network))).toString('hex');
    jar.set(olderCookie, [actorId, expires, signature].join('.'));
    apply(await post({ action: 'logout', account: actorId, sessionId: '5'.repeat(32) }));
    assert.equal(jar.has(olderCookie), false, 'Targeted logout expires the older credential of the same account');
    jar.set(olderCookie, [actorId, expires, signature].join('.'));
    apply(await login(contributor, '6'.repeat(32)));
    assert.equal(jar.has(olderCookie), false, 'Sign-in replaces the older credential');
  }
  delete process.env.CONTRIB_SPONSOR_SECRET_MAINNET;
  const fallback = await invoke('encounters', 'POST', { action: 'logout' }, '?network=mainnet',
    { Cookie: 'vespi-encounters-mainnet=unreadable' });
  assert.equal(fallback.status, 200);
  assert.match(fallback.headers.get('Set-Cookie') ?? '', /^vespi-encounters-mainnet=;.*Max-Age=0/);
});

test('a mainnet encounter fingerprint is not a public contribution chain', async t => {
  configure(t);
  const bytes = canonicalBytes({ ...receiptFields, actor: actorId,
    statement: 'Huella de un registro de Vespi Contributions', comment: 'vespi:encuentro:' + '1'.repeat(64) });
  const fetcher = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const [, key, field] = JSON.parse(String(init.body));
    assert.equal(key, 'contributions:mainnet:receipts');
    return Response.json({ result: field === 'receipt:' + digest
      ? JSON.stringify({ intent: { bytes, digest }, index: { digest, network: 'stellar:pubnet',
        txHash: 'b'.repeat(64), ledger: 12345, envelopeXdr: 'AAAA', rehearsal: false } }) : null });
  });
  assert.equal((await invoke('chains/[digest]', 'GET', undefined, '?network=mainnet')).status, 404);
  assert.equal(fetcher.mock.callCount(), 1);
});

test('encounter fingerprints stay out of activity while real requests remain on either network', async t => {
  configure(t);
  const fingerprint = 'c'.repeat(64);
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const network = url === required.CONTRIB_KV_MAINNET_REST_API_URL ? 'mainnet' : 'testnet';
    const indexNetwork = network === 'mainnet' ? 'stellar:pubnet' : 'stellar:testnet';
    const [command, key, field] = JSON.parse(String(init.body));
    assert.equal(key, 'contributions:' + network + ':receipts');
    const record = (id: string, fields: Omit<typeof receiptFields, 'comment'> & { comment: string | null }) => JSON.stringify({
      intent: { digest: id, bytes: canonicalBytes(fields) },
      index: { digest: id, network: indexNetwork, txHash: 'b'.repeat(64), ledger: 42, envelopeXdr: 'AAAA', rehearsal: false },
    });
    const request = record(digest, receiptFields);
    const proof = record(fingerprint, { ...receiptFields, statement: encounterFingerprintStatement,
      comment: 'vespi:encuentro:' + '1'.repeat(64) });
    if (command === 'HSCAN') return Response.json({ result: ['0', ['receipt:' + digest, request, 'receipt:' + fingerprint, proof]] });
    assert.equal(command, 'HGET');
    return Response.json({ result: new Map([['head:' + digest, digest], ['receipt:' + digest, request],
      ['head:' + fingerprint, fingerprint], ['receipt:' + fingerprint, proof]]).get(field) ?? null });
  });
  for (const network of ['testnet', 'mainnet'] as const) {
    const response = await invoke('activity/[account]', 'GET', undefined, '?network=' + network);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).entries.map((entry: { digest: string }) => entry.digest), [digest]);
  }
});

test('encounter certificate links require the mainnet key and preserve the historical testnet token', async t => {
  configure(t);
  const id = 'c'.repeat(32);
  const draft = { type: 'charla' as const, title: 'Charla', date: '2026-11-19', where: '', summary: '',
    a: { account: actorId, displayName: 'Ana' }, b: null, contributions: [{ from: 'a' as const, text: 'Idea', url: '' }] };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  let network: ContributionNetwork = 'mainnet';
  const signature = () => actor.sign(Buffer.from(proposalMessage(id, draft, network))).toString('hex');
  const commitment = () => createHash('sha256').update(encounterAnchorMessage(id, signature(), null, network)).digest('hex');
  const historicalToken = (value: string) => createHash('sha256').update('vespi:encuentro:proof:' + value).digest('hex').slice(0, 32);
  const tokenWrites: string[] = [];
  const redis = t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const [command, key, field, registry, recordId, patch, anchor, token] = JSON.parse(String(init.body));
    if (command === 'HGET') {
      if (key.endsWith(':encounters:v1')) {
        assert.equal(field, 'record:' + id);
        return Response.json({ result: JSON.stringify({ id, draft, proposalSignature: signature(), createdAt: receiptFields.createdAt }) });
      }
      assert.equal(key, 'contributions:' + network + ':receipts');
      assert.equal(field, 'receipt:' + digest);
      const bytes = canonicalBytes({ ...receiptFields, statement: encounterFingerprintStatement, comment: 'vespi:encuentro:' + commitment() });
      return Response.json({ result: JSON.stringify({ intent: { bytes, digest }, index: { digest,
        network: network === 'mainnet' ? 'stellar:pubnet' : 'stellar:testnet',
        txHash: 'b'.repeat(64), ledger: 12345, envelopeXdr: 'AAAA', rehearsal: false } }) });
    }
    assert.equal(command, 'EVAL');
    assert.equal(registry, 'contributions:' + network + ':encounters:v1');
    assert.deepEqual([recordId, patch, JSON.parse(anchor)], [id, 'anchor', digest]);
    tokenWrites.push(token);
    return Response.json({ result: 1 });
  });
  const anchor = () => invoke('encounters', 'POST', { network, id, action: 'anchor', receipt: digest }, '', {
    Cookie: (network === 'mainnet' ? 'vespi-encounters-mainnet' : 'vespi-encounters') + '=' + actorId + '.' + expires + '.' +
      actor.sign(Buffer.from(sessionMessage(actorId, expires, network))).toString('hex'),
  });
  const tokenFor = async () => {
    const response = await anchor();
    assert.equal(response.status, 200);
    const { encounter } = await response.json();
    assert.equal(encounter.anchorCommitment, commitment());
    assert.equal(encounter.receiptToken, tokenWrites.at(-1));
    return encounter.receiptToken;
  };
  const first = await tokenFor();
  assert.equal(first, createHmac('sha256', tokenMain).update('vespi:encounter-proof:v1:stellar:pubnet:' + commitment()).digest('hex').slice(0, 32));
  assert.notEqual(first, historicalToken(commitment()));
  process.env.CONTRIB_TOKEN_KEY_MAINNET = 'n'.repeat(32);
  assert.notEqual(await tokenFor(), first);
  delete process.env.CONTRIB_TOKEN_KEY_MAINNET;
  const calls = redis.mock.callCount();
  await assertFailure(await anchor(), 503, 'mainnet-unavailable');
  assert.equal(redis.mock.callCount(), calls);
  network = 'testnet';
  assert.equal(await tokenFor(), historicalToken(commitment()));
});

test('legacy invitation codes are preserved and sessions and claims use separate mainnet domains', async t => {
  configure(t);
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const [command, , , key] = JSON.parse(String(init.body));
    if (command === 'HGET') return Response.json({ result: 'Ana' });
    assert.equal(command, 'EVAL');
    assert.ok(['contributions:testnet:encounters:v1', 'contributions:mainnet:encounters:v1'].includes(key));
    return Response.json({ result: 1 });
  });
  const id = 'c'.repeat(32);
  const draft = {
    type: 'reunion' as const, title: 'Reunión', date: '2026-11-19', where: '', summary: '',
    a: { account: actorId, displayName: 'Ana' }, b: { account: '', displayName: 'Invitado' }, inviteMode: 'link' as const,
    contributions: [{ from: 'a' as const, text: 'Idea', url: '' }],
  };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const session = (network: ContributionNetwork) => actorId + '.' + expires + '.' +
    actor.sign(Buffer.from(sessionMessage(actorId, expires, network))).toString('hex');
  const wrong = await invoke('encounters', 'POST', { network: 'mainnet', action: 'session', session: session('testnet') });
  await assertFailure(wrong, 401, 'sign-in');
  for (const network of ['testnet', 'mainnet'] as const) {
    const signature = actor.sign(Buffer.from(proposalMessage(id, draft, network))).toString('hex');
    const response = await invoke('encounters', 'POST', { network, id, draft, action: 'publish', signature, session: session(network) });
    assert.equal(response.status, 200);
    const { encounter } = await response.json();
    const isMainnet = network === 'mainnet';
    const domain = isMainnet ? 'vespi:encounter-claim:v1:stellar:pubnet:' : 'vespi:encounter-claim:v1:';
    const code = createHmac('sha256', isMainnet ? tokenMain : tokenTest).update(domain + id + ':' + signature).digest('hex');
    assert.equal(encounter.inviteUrl, '/app?encuentro=' + id + (isMainnet ? '&network=mainnet' : '') + '#invitation=' + code);
    const cookie = isMainnet ? 'vespi-encounters-mainnet' : 'vespi-encounters';
    assert.equal(response.headers.get('Set-Cookie'), cookie + '=' + session(network) +
      '; Path=/api/contributions/encounters; HttpOnly; SameSite=Lax; Max-Age=604800; Secure');
  }
});

test('a signed revision preserves the original visibility in both networks', async t => {
  configure(t);
  const id = '7'.repeat(32);
  const revisionOf = '6'.repeat(32);
  const b = { account: contributor.publicKey(), displayName: 'Francisco' };
  const draft = { type: 'ayuda' as const, title: 'Un aporte revisado', date: '2026-11-23', where: '', summary: '',
    a: { account: actorId, displayName: 'Ana' }, b, contributions: [{ from: 'a' as const, text: 'Un aporte revisado', url: '' }] };
  let originalPublic = false;
  let writes = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const [command, key, field] = JSON.parse(String(init.body));
    if (command === 'EVAL') {
      writes++;
      return Response.json({ result: 1 });
    }
    assert.equal(command, 'HGET');
    if (key.endsWith(':profiles')) return Response.json({ result: field === actorId ? draft.a.displayName : b.displayName });
    assert.equal(field, 'record:' + revisionOf);
    return Response.json({ result: JSON.stringify({
      draft: { ...draft, ...(originalPublic && { visibility: 'public' }) }, id: revisionOf,
      decision: { choice: 'correction', person: b },
    }) });
  });
  for (const network of ['testnet', 'mainnet'] as const) {
    for (const revision of [undefined, revisionOf]) {
      for (const changes of [{ title: 'Título no derivado' }, { summary: 'Resumen privado' }, { summary: ' ' }]) {
        const proposed = { ...draft, visibility: 'public' as const, revisionOf: revision, ...changes };
        const signature = actor.sign(Buffer.from(proposalMessage(id, proposed, network))).toString('hex');
        await assertFailure(await invoke('encounters', 'POST',
          { action: 'publish', id, draft: proposed, network, signature }), 400, 'invalid-encounter');
      }
    }
    for (const visibility of [undefined, 'public'] as const) {
      const publishDraft = { ...draft, revisionOf, visibility };
      const body = { action: 'publish', id, draft: publishDraft, network,
        signature: actor.sign(Buffer.from(proposalMessage(id, publishDraft, network))).toString('hex') };
      originalPublic = !visibility;
      await assertFailure(await invoke('encounters', 'POST', body), 400, 'invalid-revision');
      originalPublic = !!visibility;
      const response = await invoke('encounters', 'POST', body);
      assert.equal(response.status, 200);
      const { encounter } = await response.json();
      assert.equal(encounter.visibility, visibility);
      assert.equal(encounter.title, draft.contributions[0].text);
      assert.equal(encounter.summary, '');
    }
  }
  assert.equal(writes, 4);
});
