import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
  Account, FeeBumpTransaction, Keypair, Memo, Networks, Operation, Transaction, TransactionBuilder,
} from '@stellar/stellar-sdk';
import type { Deps } from './handlers';

// @types/node is v20; the test runner is Node 26 with synchronous loader hooks.
const { registerHooks } = await import('node:module' as string);
type ResolveContext = { parentURL?: string };
type Resolve = (specifier: string, context: ResolveContext) => { url: string };
// Node runs the source directly; Next resolves these extensionless imports and aliases itself.
registerHooks({ resolve(specifier: string, context: ResolveContext, nextResolve: Resolve) {
  if (specifier.startsWith('./') && context.parentURL?.startsWith(new URL('./', import.meta.url).href) &&
    !/\.[cm]?[jt]s$/.test(specifier)) {
    return nextResolve(new URL(`${specifier}.ts`, context.parentURL).href, context);
  }
  if (specifier.startsWith('@/')) {
    return nextResolve(new URL(`../../${specifier.slice(2)}.ts`, import.meta.url).href, context);
  }
  return nextResolve(specifier, context);
}, load(url: string, context: unknown, nextLoad: (url: string, context: unknown) => unknown) {
  // The existing store has parameter properties, which Node's strip-only mode cannot run.
  if (url === new URL('../store.ts', import.meta.url).href) {
    return { format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext },
    }).outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
} });

const { createAccountHandlers, createChannelLeases, createFeeBumpHandler, leasesPerIp, parseLeasesPerIp } =
  await import(new URL('./handlers.ts', import.meta.url).href);
const { onboardingToken } = await import(new URL('./stellar-server.ts', import.meta.url).href);
const sponsor = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const channels = [2, 3].map(seed => Keypair.fromRawEd25519Seed(Buffer.alloc(32, seed)));
const participant = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5));
const instant = new Date('2026-11-16T12:00:00Z');
const tokenKey = 'test-only-token-key-with-32-bytes!';
const env = {
  CONTRIB_SPONSOR_SECRET: sponsor.secret(),
  CONTRIB_CHANNEL_SECRETS: channels.map(channel => channel.secret()).join(', '),
  CONTRIB_TOKEN_KEY: tokenKey,
  CONTRIB_SPONSOR_MAX_FEE: '300',
  CONTRIB_SPONSOR_MAX_RESERVE: '10000000',
  CONTRIB_SPONSOR_EXPIRES_AT: '2026-11-17T12:00:00Z',
};

const ip = '203.0.113.7';

function fixture(settings: Partial<typeof env> = {}) {
  const submitted: Array<Transaction | FeeBumpTransaction> = [];
  const loaded: string[] = [];
  const found: string[] = [];
  const lookedUp: string[] = [];
  const deps: Deps = {
    env: { ...env, ...settings }, now: () => instant, leases: createChannelLeases(),
    reserveSponsorBudget: async () => ({ state: 'reserved' }),
    loadAccount: async (id: string) => { loaded.push(id); return new Account(id, '100'); },
    // By default the participant's account does not exist yet and no transaction is found by hash.
    findAccount: async (id: string) => { found.push(id); return null; },
    getTransaction: async (hash: string) => { lookedUp.push(hash); return null; },
    submit: async (tx: Transaction | FeeBumpTransaction) => {
      submitted.push(tx);
      return { hash: 'submitted-hash', ledger: 123 };
    },
  };
  return { deps, submitted, loaded, found, lookedUp };
}

async function prepared(deps: Deps) {
  const result = await createAccountHandlers(deps).prepare({ publicKey: participant.publicKey() }, ip);
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  return result;
}

async function signedOnboarding(deps: Deps) {
  const result = await prepared(deps);
  const tx = new Transaction(result.xdr, Networks.TESTNET);
  tx.sign(participant);
  return { xdr: tx.toXDR(), token: result.token };
}

function participantTx({ source = participant, fee = '150', memo = Memo.hash(Buffer.alloc(32, 7)),
  operations = [Operation.bumpSequence({ bumpTo: '102' })], network = Networks.TESTNET }: {
  source?: Keypair; fee?: string; memo?: Memo;
  operations?: ReturnType<typeof Operation.bumpSequence>[]; network?: string;
} = {}) {
  const builder = new TransactionBuilder(new Account(source.publicKey(), '100'), {
    fee, networkPassphrase: network,
    timebounds: { minTime: 0, maxTime: Math.floor(instant.getTime() / 1000) + 120 },
  }).addMemo(memo);
  for (const operation of operations) builder.addOperation(operation);
  return builder.build();
}

function horizonError(transaction = 'tx_bad_seq', inner_transaction?: string) {
  return { response: { status: 400, data: {
    title: 'Transaction Failed', detail: 'private Horizon detail', status: 400,
    extras: { envelope_xdr: 'private-envelope', result_codes: { transaction, inner_transaction } },
  } } };
}

test('prepare and complete submit once with the participant, channel and sponsor signatures', async () => {
  const { deps, submitted, loaded } = fixture();
  const result = await prepared(deps);
  const tx = new Transaction(result.xdr, Networks.TESTNET);
  assert.ok(channels.some(channel => channel.publicKey() === result.channel));
  assert.deepEqual(loaded, [result.channel]);
  assert.equal(tx.source, result.channel);
  assert.equal(tx.sequence, '101');
  assert.equal(tx.fee, '300');
  assert.equal(tx.timeBounds?.maxTime, String(instant.getTime() / 1000 + 60));
  assert.equal(tx.signatures.length, 0);
  assert.equal(submitted.length, 0);
  tx.sign(participant);
  assert.deepEqual(await createAccountHandlers(deps).complete({ xdr: tx.toXDR(), token: result.token }),
    { ok: true, hash: 'submitted-hash', ledger: 123 });
  assert.equal(submitted.length, 1);
  assert.deepEqual(loaded, [result.channel]);
  const sent = submitted[0];
  assert.ok(sent instanceof Transaction);
  assert.deepEqual(sent.hash(), tx.hash());
  assert.equal(sent.signatures.length, 3);
  for (const key of [participant, sponsor, channels.find(channel => channel.publicKey() === result.channel)!]) {
    assert.ok(sent.signatures.some(signature => key.verify(sent.hash(), signature.signature())));
  }
});

test('prepare rejects malformed public keys without loading a channel', async () => {
  const { deps, loaded } = fixture();
  for (const publicKey of ['', 'G' + 'A'.repeat(55), sponsor.secret(), null, 1]) {
    assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey }, ip),
      { ok: false, reason: 'invalid-public-key' });
  }
  assert.deepEqual(loaded, []);
});

test('onboarding reserve and expiry policy reject before loading or submitting', async () => {
  for (const [settings, reason] of [
    [{ CONTRIB_SPONSOR_MAX_RESERVE: '9999999' }, 'reserve-over-limit'],
    [{ CONTRIB_SPONSOR_EXPIRES_AT: instant.toISOString() }, 'authority-expired'],
  ] as const) {
    const { deps, loaded, submitted } = fixture(settings);
    assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: participant.publicKey() }, ip),
      { ok: false, reason });
    assert.deepEqual(loaded, []);
    assert.deepEqual(submitted, []);
  }
});

test('complete rejects an altered token without submitting', async () => {
  const { deps, submitted } = fixture();
  const body = await signedOnboarding(deps);
  const token = (body.token[0] === '0' ? '1' : '0') + body.token.slice(1);
  assert.deepEqual(await createAccountHandlers(deps).complete({ ...body, token }),
    { ok: false, reason: 'bad-token' });
  assert.equal(submitted.length, 0);
});

test('complete rejects a valid token reused with a different account, channel or operation', async () => {
  const { deps, submitted } = fixture();
  const original = await prepared(deps);
  const tx = new Transaction(original.xdr, Networks.TESTNET);
  const changedAccount = new TransactionBuilder(new Account(tx.source, '100'), {
    fee: '100', networkPassphrase: Networks.TESTNET, timebounds: tx.timeBounds,
  }).addOperation(Operation.beginSponsoringFutureReserves({ source: sponsor.publicKey(), sponsoredId: other.publicKey() }))
    .addOperation(Operation.createAccount({ source: sponsor.publicKey(), destination: other.publicKey(), startingBalance: '0' }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: other.publicKey() })).build();
  const envelope = tx.toEnvelope();
  envelope.v1().tx().sourceAccount(other.xdrMuxedAccount());
  const changedChannel = new Transaction(envelope, Networks.TESTNET);
  const changedOperation = new TransactionBuilder(new Account(tx.source, '100'), {
    fee: '100', networkPassphrase: Networks.TESTNET, timebounds: tx.timeBounds,
  }).addOperation(Operation.bumpSequence({ bumpTo: '102' })).build();
  for (const changed of [changedAccount, changedChannel, changedOperation]) {
    changed.sign(participant);
    assert.deepEqual(await createAccountHandlers(deps).complete({ xdr: changed.toXDR(), token: original.token }),
      { ok: false, reason: 'bad-token' });
  }
  assert.equal(submitted.length, 0);
});

test('complete rejects absent, wrong-key, malformed and wrong-network participant signatures', async () => {
  const { deps, submitted } = fixture();
  const result = await prepared(deps);
  const unsigned = new Transaction(result.xdr, Networks.TESTNET);
  const wrongKey = new Transaction(result.xdr, Networks.TESTNET);
  wrongKey.sign(other);
  const malformed = new Transaction(result.xdr, Networks.TESTNET);
  malformed.sign(participant);
  malformed.signatures[0].signature(Buffer.alloc(1));
  const wrongNetwork = new Transaction(result.xdr, Networks.PUBLIC);
  wrongNetwork.sign(participant);
  for (const tx of [unsigned, wrongKey, malformed, wrongNetwork]) {
    assert.deepEqual(await createAccountHandlers(deps).complete({ xdr: tx.toXDR(), token: result.token }),
      { ok: false, reason: 'missing-participant-signature' });
  }
  assert.equal(submitted.length, 0);
});

test('complete rejects non-onboarding operations even with an authentic token', async () => {
  const { deps, submitted } = fixture();
  const result = await prepared(deps);
  const original = new Transaction(result.xdr, Networks.TESTNET);
  const tx = new TransactionBuilder(new Account(result.channel, '100'), {
    fee: '100', networkPassphrase: Networks.TESTNET, timebounds: original.timeBounds,
  }).addOperation(Operation.bumpSequence({ bumpTo: '102' })).build();
  tx.sign(participant);
  assert.deepEqual(await createAccountHandlers(deps).complete({ xdr: tx.toXDR(),
    token: onboardingToken(tx.toXDR(), Buffer.from(tokenKey)) }), { ok: false, reason: 'invalid-onboarding' });
  assert.equal(submitted.length, 0);
});

test('complete rechecks onboarding authority before signing and submitting', async () => {
  const { deps, submitted } = fixture();
  const body = await signedOnboarding(deps);
  deps.env.CONTRIB_SPONSOR_MAX_RESERVE = '0';
  assert.deepEqual(await createAccountHandlers(deps).complete(body), { ok: false, reason: 'reserve-over-limit' });
  assert.equal(submitted.length, 0);
});

test('complete rejects an expired XDR before submitting', async () => {
  const { deps, submitted } = fixture();
  const body = await signedOnboarding(deps);
  deps.now = () => new Date(instant.getTime() + 121_000);
  assert.deepEqual(await createAccountHandlers(deps).complete(body), { ok: false, reason: 'expired' });
  assert.equal(submitted.length, 0);
});

test('tx_bad_seq returns retry after one submit without preparing or resending', async () => {
  const { deps, loaded } = fixture();
  const body = await signedOnboarding(deps);
  let attempts = 0;
  deps.submit = async () => { attempts++; throw horizonError(); };
  assert.deepEqual(await createAccountHandlers(deps).complete(body), { ok: false, reason: 'retry' });
  assert.equal(attempts, 1);
  assert.equal(loaded.length, 1);
});

function submissionTimeout() {
  return { response: { status: 504, data: { title: 'Transaction Submission Timeout', status: 504 } } };
}

async function signedFor(deps: Deps, key: Keypair) {
  const result = await createAccountHandlers(deps).prepare({ publicKey: key.publicKey() }, ip);
  assert.ok(result.ok);
  const tx = new Transaction(result.xdr, Networks.TESTNET);
  tx.sign(key);
  return { body: { xdr: tx.toXDR(), token: result.token }, channel: result.channel as string, hash: tx.hash() };
}

test('simultaneous prepares lease different channels', async () => {
  // The channel choice is random among free channels; repeat so a missing lease cannot pass by chance.
  for (let run = 0; run < 16; run++) {
    const { deps } = fixture();
    const results = await Promise.all([participant, other].map(key =>
      createAccountHandlers(deps).prepare({ publicKey: key.publicKey() }, ip)));
    assert.ok(results.every(result => result.ok));
    assert.notEqual(results[0].channel, results[1].channel);
  }
});

test('prepare answers busy without building a transaction when every channel is in flight', async () => {
  const { deps, loaded } = fixture();
  await signedFor(deps, participant);
  await signedFor(deps, other);
  assert.equal(loaded.length, 2);
  assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: participant.publicKey() }, ip),
    { ok: false, reason: 'busy' });
  assert.equal(loaded.length, 2);
});

test('the lease is shared by handler instances on the same lease store, as in one route per request', async () => {
  for (let run = 0; run < 16; run++) {
    const { deps } = fixture();
    const first = await createAccountHandlers(deps).prepare({ publicKey: participant.publicKey() }, ip);
    const second = await createAccountHandlers({ ...deps }).prepare({ publicKey: other.publicKey() }, ip);
    assert.ok(first.ok && second.ok);
    assert.notEqual(first.channel, second.channel);
  }
});

test('complete releases the channel lease after success and after a submission error', async () => {
  const { deps } = fixture();
  const a = await signedFor(deps, participant);
  await signedFor(deps, other);
  assert.equal((await createAccountHandlers(deps).complete(a.body)).ok, true);
  const c = await signedFor(deps, participant);
  assert.equal(c.channel, a.channel);
  deps.submit = async () => { throw horizonError('tx_bad_auth'); };
  assert.deepEqual(await createAccountHandlers(deps).complete(c.body), { ok: false, reason: 'horizon-error' });
  assert.equal((await signedFor(deps, other)).channel, a.channel);
});

test('a lease lasts the 60 s of its transaction plus a 10 s clock margin', async () => {
  const { deps } = fixture({ CONTRIB_CHANNEL_SECRETS: channels[0].secret() });
  await signedFor(deps, participant);
  deps.now = () => new Date(instant.getTime() + 65_000);
  assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: other.publicKey() }, 'other-ip'),
    { ok: false, reason: 'busy' });
  deps.now = () => new Date(instant.getTime() + 71_000);
  assert.equal((await createAccountHandlers(deps).prepare({ publicKey: other.publicKey() }, 'other-ip')).ok, true);
});

test('complete judges expired with a 10 s margin before maxTime', async () => {
  for (const [offset, expired] of [[49_000, false], [51_000, true]] as const) {
    const { deps, submitted } = fixture();
    const body = await signedOnboarding(deps);
    deps.now = () => new Date(instant.getTime() + offset);
    const result = await createAccountHandlers(deps).complete(body);
    assert.equal(result.ok, !expired);
    if (expired) assert.deepEqual(result, { ok: false, reason: 'expired' });
    assert.equal(submitted.length, expired ? 0 : 1);
  }
});

test('one IP holds at most two open leases; a third prepare answers busy while channels are free', async () => {
  const third = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6));
  const { deps, loaded } = fixture({ CONTRIB_CHANNEL_SECRETS: [...channels, third].map(key => key.secret()).join(',') });
  await signedFor(deps, participant);
  await signedFor(deps, other);
  assert.equal(loaded.length, 2);
  assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: third.publicKey() }, ip),
    { ok: false, reason: 'busy' });
  assert.equal(loaded.length, 2);
  assert.equal((await createAccountHandlers(deps).prepare({ publicKey: third.publicKey() }, 'another-ip')).ok, true);
});

function keysFrom(first: number, count: number) {
  return Array.from({ length: count }, (_, i) => Keypair.fromRawEd25519Seed(Buffer.alloc(32, first + i)));
}

async function prepareMany(deps: Deps, keys: Keypair[], from = ip) {
  const results = [];
  for (const key of keys) results.push(await createAccountHandlers(deps).prepare({ publicKey: key.publicKey() }, from));
  return results;
}

test('with 20 channels one IP holds 12 leases (channels - 8) and the 13th prepare answers busy', async () => {
  const { deps, loaded } = fixture({ CONTRIB_CHANNEL_SECRETS: keysFrom(100, 20).map(key => key.secret()).join(',') });
  const results = await prepareMany(deps, keysFrom(140, 13));
  assert.ok(results.slice(0, 12).every(result => result.ok));
  assert.deepEqual(results[12], { ok: false, reason: 'busy' });
  assert.equal(loaded.length, 12);
  assert.equal((await createAccountHandlers(deps).prepare({ publicKey: participant.publicKey() }, 'another-ip')).ok, true);
});

test('an explicit leases-per-IP override wins: with 3 the fourth prepare answers busy', async () => {
  const { deps } = fixture({ CONTRIB_CHANNEL_SECRETS: keysFrom(100, 20).map(key => key.secret()).join(',') });
  deps.leasesPerIp = 3;
  const results = await prepareMany(deps, keysFrom(140, 4));
  assert.ok(results.slice(0, 3).every(result => result.ok));
  assert.deepEqual(results[3], { ok: false, reason: 'busy' });
});

test('with 5 channels the leases-per-IP floor is 2', async () => {
  const { deps } = fixture({ CONTRIB_CHANNEL_SECRETS: keysFrom(100, 5).map(key => key.secret()).join(',') });
  const results = await prepareMany(deps, keysFrom(140, 3));
  assert.ok(results.slice(0, 2).every(result => result.ok));
  assert.deepEqual(results[2], { ok: false, reason: 'busy' });
});

test('leasesPerIp is max(2, channels - 8) unless a positive integer override is given', () => {
  assert.equal(leasesPerIp(20), 12);
  assert.equal(leasesPerIp(5), 2);
  assert.equal(leasesPerIp(10), 2);
  assert.equal(leasesPerIp(11), 3);
  assert.equal(leasesPerIp(20, 3), 3);
  assert.equal(parseLeasesPerIp('3'), 3);
  assert.equal(parseLeasesPerIp(' 7 '), 7);
  for (const value of [undefined, '', '0', '-1', '2.5', 'abc', '3x']) assert.equal(parseLeasesPerIp(value), undefined);
});

test('prepare answers busy without asking Horizon when the IP is at its lease cap', async () => {
  const third = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6));
  const { deps, found } = fixture({ CONTRIB_CHANNEL_SECRETS: [...channels, third].map(key => key.secret()).join(',') });
  await signedFor(deps, participant);
  await signedFor(deps, other);
  assert.equal(found.length, 2);
  assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: third.publicKey() }, ip),
    { ok: false, reason: 'busy' });
  assert.equal(found.length, 2);
});

test('prepare answers busy without asking Horizon when no channel is free', async () => {
  const { deps, found } = fixture({ CONTRIB_CHANNEL_SECRETS: channels[0].secret() });
  await signedFor(deps, participant);
  assert.equal(found.length, 1);
  assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: other.publicKey() }, 'other-ip'),
    { ok: false, reason: 'busy' });
  assert.equal(found.length, 1);
});

test('prepare checks the account before building: already onboarded by our sponsor', async () => {
  const { deps, loaded, found } = fixture({ CONTRIB_CHANNEL_SECRETS: channels[0].secret() });
  deps.findAccount = async (id: string) => { found.push(id); return { sponsor: sponsor.publicKey() }; };
  assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: participant.publicKey() }, ip),
    { ok: false, reason: 'already-onboarded' });
  assert.deepEqual(found, [participant.publicKey()]);
  assert.deepEqual(loaded, []);
  deps.findAccount = async () => null;
  assert.equal((await createAccountHandlers(deps).prepare({ publicKey: other.publicKey() }, ip)).ok, true);
});

test('prepare answers account-exists for an account with another sponsor or none, without leasing', async () => {
  for (const existing of [{ sponsor: other.publicKey() }, { sponsor: null }]) {
    const { deps, loaded } = fixture({ CONTRIB_CHANNEL_SECRETS: channels[0].secret() });
    deps.findAccount = async () => existing;
    assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: participant.publicKey() }, ip),
      { ok: false, reason: 'account-exists' });
    assert.deepEqual(loaded, []);
    deps.findAccount = async () => null;
    assert.equal((await createAccountHandlers(deps).prepare({ publicKey: other.publicKey() }, ip)).ok, true);
  }
});

test('prepare fails closed when the account lookup fails, without loading a channel', async () => {
  const { deps, loaded } = fixture();
  deps.findAccount = async () => { throw new Error('private network detail'); };
  assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: participant.publicKey() }, ip),
    { ok: false, reason: 'horizon-error' });
  assert.deepEqual(loaded, []);
});

test('a stale complete does not release a lease that a newer prepare holds', async () => {
  const { deps } = fixture({ CONTRIB_CHANNEL_SECRETS: channels[0].secret() });
  const stale = await signedFor(deps, participant);
  deps.now = () => new Date(instant.getTime() + 121_000);
  await signedFor(deps, other);
  assert.deepEqual(await createAccountHandlers(deps).complete(stale.body), { ok: false, reason: 'expired' });
  assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: participant.publicKey() }, 'other-ip'),
    { ok: false, reason: 'busy' });
});

test('a timeout whose hash is found successful answers ok with its ledger, without resending, and frees the channel', async () => {
  const { deps, lookedUp, found } = fixture({ CONTRIB_CHANNEL_SECRETS: channels[0].secret() });
  const a = await signedFor(deps, participant);
  let attempts = 0;
  deps.submit = async () => { attempts++; throw submissionTimeout(); };
  deps.getTransaction = async (hash: string) => { lookedUp.push(hash); return { successful: true, ledger: 777 }; };
  assert.deepEqual(await createAccountHandlers(deps).complete(a.body),
    { ok: true, hash: a.hash.toString('hex'), ledger: 777, reconciled: true });
  assert.equal(attempts, 1);
  assert.deepEqual(lookedUp, [a.hash.toString('hex')]);
  assert.deepEqual(found, [participant.publicKey()]);
  assert.equal((await signedFor(deps, other)).channel, a.channel);
});

test('a timeout whose hash is found failed answers retry and frees the channel, since the sequence was used', async () => {
  const { deps } = fixture({ CONTRIB_CHANNEL_SECRETS: channels[0].secret() });
  const a = await signedFor(deps, participant);
  deps.submit = async () => { throw submissionTimeout(); };
  deps.getTransaction = async () => ({ successful: false, ledger: 778 });
  assert.deepEqual(await createAccountHandlers(deps).complete(a.body), { ok: false, reason: 'retry' });
  assert.equal((await signedFor(deps, other)).channel, a.channel);
});

test('a timeout with no transaction but the account sponsored by us answers ok with a null hash and keeps the lease', async () => {
  const { deps } = fixture({ CONTRIB_CHANNEL_SECRETS: channels[0].secret() });
  const a = await signedFor(deps, participant);
  let attempts = 0;
  deps.submit = async () => { attempts++; throw submissionTimeout(); };
  deps.findAccount = async () => ({ sponsor: sponsor.publicKey() });
  assert.deepEqual(await createAccountHandlers(deps).complete(a.body),
    { ok: true, hash: null, ledger: null, reconciled: true });
  assert.equal(attempts, 1);
  deps.findAccount = async () => null;
  assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: other.publicKey() }, 'other-ip'),
    { ok: false, reason: 'busy' });
});

test('a timeout with no transaction and an account sponsored by others answers account-exists and keeps the lease', async () => {
  const { deps } = fixture({ CONTRIB_CHANNEL_SECRETS: channels[0].secret() });
  const a = await signedFor(deps, participant);
  deps.submit = async () => { throw submissionTimeout(); };
  deps.findAccount = async () => ({ sponsor: null });
  assert.deepEqual(await createAccountHandlers(deps).complete(a.body), { ok: false, reason: 'account-exists' });
  deps.findAccount = async () => null;
  assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: other.publicKey() }, 'other-ip'),
    { ok: false, reason: 'busy' });
});

test('a timeout with no transaction and no account answers retry without resending and keeps the lease until maxTime', async () => {
  for (const error of [submissionTimeout(), new Error('socket hang up')]) {
    const { deps } = fixture({ CONTRIB_CHANNEL_SECRETS: channels[0].secret() });
    const a = await signedFor(deps, participant);
    let attempts = 0;
    deps.submit = async () => { attempts++; throw error; };
    assert.deepEqual(await createAccountHandlers(deps).complete(a.body), { ok: false, reason: 'retry' });
    assert.equal(attempts, 1);
    assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: other.publicKey() }, 'other-ip'),
      { ok: false, reason: 'busy' });
    deps.now = () => new Date(instant.getTime() + 71_000);
    assert.equal((await signedFor(deps, participant)).channel, a.channel);
  }
});

test('a timeout that cannot be reconciled keeps the lease and reports a Horizon error', async () => {
  for (const broken of ['getTransaction', 'findAccount'] as const) {
    const { deps } = fixture({ CONTRIB_CHANNEL_SECRETS: channels[0].secret() });
    const a = await signedFor(deps, participant);
    let attempts = 0;
    deps.submit = async () => { attempts++; throw submissionTimeout(); };
    deps[broken] = async () => { throw new Error('private network detail'); };
    assert.deepEqual(await createAccountHandlers(deps).complete(a.body), { ok: false, reason: 'horizon-error' });
    assert.equal(attempts, 1);
    deps.findAccount = async () => null;
    assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: other.publicKey() }, 'other-ip'),
      { ok: false, reason: 'busy' });
  }
});

test('account handlers map load and submit errors without leaking Horizon details', async () => {
  const { deps } = fixture();
  const body = await signedOnboarding(deps);
  deps.submit = async () => { throw horizonError('tx_bad_auth'); };
  assert.deepEqual(await createAccountHandlers(deps).complete(body), { ok: false, reason: 'horizon-error' });
  deps.loadAccount = async () => { throw new Error('private channel detail'); };
  assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: participant.publicKey() }, ip),
    { ok: false, reason: 'horizon-error' });
});

test('fee bump preserves the signed inner XDR and uses exactly the checked base fee', async () => {
  const { deps, submitted, loaded } = fixture();
  const tx = participantTx();
  tx.sign(participant);
  const xdr = tx.toXDR();
  assert.deepEqual(await createFeeBumpHandler(deps)({ xdr, participant: participant.publicKey() }),
    { ok: true, hash: 'submitted-hash', ledger: 123 });
  assert.deepEqual(loaded, []);
  assert.equal(submitted.length, 1);
  const sent = submitted[0];
  assert.ok(sent instanceof FeeBumpTransaction);
  assert.equal(sent.fee, '300');
  assert.equal(sent.feeSource, sponsor.publicKey());
  assert.equal(sent.innerTransaction.toXDR(), xdr);
  assert.equal(sent.signatures.length, 1);
  assert.ok(sponsor.verify(sent.hash(), sent.signatures[0].signature()));
});

test('fee bump needs only sponsor configuration, without channel or token secrets', async () => {
  const { deps } = fixture({ CONTRIB_CHANNEL_SECRETS: '', CONTRIB_TOKEN_KEY: '' });
  const tx = participantTx();
  tx.sign(participant);
  assert.deepEqual(await createFeeBumpHandler(deps)({ xdr: tx.toXDR(), participant: participant.publicKey() }),
    { ok: true, hash: 'submitted-hash', ledger: 123 });
});

test('fee bump policy rejects wrong sources, operations, memos and fees without submitting', async () => {
  const { deps, submitted } = fixture();
  for (const [tx, reason] of [
    [participantTx({ source: other }), 'wrong-source'],
    [participantTx({ operations: [Operation.bumpSequence({ bumpTo: '102', source: other.publicKey() })] }), 'wrong-source'],
    [participantTx({ operations: [Operation.manageData({ name: 'no', value: 'payment' })] }), 'wrong-operation'],
    [participantTx({ operations: [Operation.bumpSequence({ bumpTo: '102' }), Operation.bumpSequence({ bumpTo: '103' })] }), 'operation-count'],
    [participantTx({ memo: Memo.text('no-hash') }), 'memo-not-hash'],
    [participantTx({ fee: '151' }), 'fee-over-limit'],
  ] as const) {
    tx.sign(participant);
    assert.deepEqual(await createFeeBumpHandler(deps)({ xdr: tx.toXDR(), participant: participant.publicKey() }),
      { ok: false, reason });
  }
  assert.equal(submitted.length, 0);
});

test('fee bump rejects expired sponsor authority without submitting', async () => {
  const { deps, submitted } = fixture({ CONTRIB_SPONSOR_EXPIRES_AT: instant.toISOString() });
  const tx = participantTx();
  tx.sign(participant);
  assert.deepEqual(await createFeeBumpHandler(deps)({ xdr: tx.toXDR(), participant: participant.publicKey() }),
    { ok: false, reason: 'authority-expired' });
  assert.equal(submitted.length, 0);
});

test('fee bump rejects unsigned, wrong-key, malformed and wrong-network signatures without submitting', async () => {
  const { deps, submitted } = fixture();
  const unsigned = participantTx();
  const wrongKey = participantTx();
  wrongKey.sign(other);
  const malformed = participantTx();
  malformed.sign(participant);
  malformed.signatures[0].signature(Buffer.alloc(1));
  const wrongNetwork = participantTx({ network: Networks.PUBLIC });
  wrongNetwork.sign(participant);
  for (const tx of [unsigned, wrongKey, malformed, wrongNetwork]) {
    assert.deepEqual(await createFeeBumpHandler(deps)({ xdr: tx.toXDR(), participant: participant.publicKey() }),
      { ok: false, reason: 'missing-participant-signature' });
  }
  assert.equal(submitted.length, 0);
});

test('fee bump maps inner transaction failure and never returns raw Horizon errors', async () => {
  const { deps } = fixture();
  const tx = participantTx();
  tx.sign(participant);
  for (const [error, reason] of [
    [horizonError('tx_fee_bump_inner_failed', 'tx_bad_seq'), 'inner-failed'],
    [horizonError('tx_bad_auth'), 'horizon-error'],
    [new Error('private response'), 'horizon-error'],
  ] as const) {
    deps.submit = async () => { throw error; };
    assert.deepEqual(await createFeeBumpHandler(deps)({ xdr: tx.toXDR(), participant: participant.publicKey() }),
      { ok: false, reason });
  }
});

test('successful handlers return only hash and ledger from the Horizon response', async () => {
  const { deps } = fixture();
  const body = await signedOnboarding(deps);
  deps.submit = async () => ({ hash: 'public-hash', ledger: 321, envelope_xdr: 'unrequested-envelope' });
  assert.deepEqual(await createAccountHandlers(deps).complete(body), { ok: true, hash: 'public-hash', ledger: 321 });
  const tx = participantTx();
  tx.sign(participant);
  assert.deepEqual(await createFeeBumpHandler(deps)({ xdr: tx.toXDR(), participant: participant.publicKey() }),
    { ok: true, hash: 'public-hash', ledger: 321 });
});

test('handlers reject malformed bodies, invalid XDR and fee bump envelopes without submitting', async () => {
  const { deps, submitted } = fixture();
  for (const body of [null, [], 1, 'body', {}]) {
    assert.deepEqual(await createAccountHandlers(deps).complete(body), { ok: false, reason: 'invalid-body' });
    assert.deepEqual(await createFeeBumpHandler(deps)(body), { ok: false, reason: 'invalid-body' });
  }
  const tx = participantTx();
  tx.sign(participant);
  const bumped = TransactionBuilder.buildFeeBumpTransaction(sponsor, '150', tx, Networks.TESTNET);
  for (const xdr of ['', 'not-xdr', bumped.toXDR()]) {
    assert.deepEqual(await createAccountHandlers(deps).complete({ xdr, token: 'a'.repeat(64) }),
      { ok: false, reason: 'bad-token' });
    assert.deepEqual(await createFeeBumpHandler(deps)({ xdr, participant: participant.publicKey() }),
      { ok: false, reason: 'invalid-xdr' });
  }
  assert.deepEqual(await createFeeBumpHandler(deps)({ xdr: tx.toXDR(), participant: sponsor.secret() }),
    { ok: false, reason: 'invalid-public-key' });
  assert.equal(submitted.length, 0);
});

test('missing or invalid signing configuration fails closed without exposing secrets', async () => {
  for (const settings of [
    { CONTRIB_SPONSOR_SECRET: '' }, { CONTRIB_SPONSOR_SECRET: 'invalid-secret' },
    { CONTRIB_CHANNEL_SECRETS: '' }, { CONTRIB_CHANNEL_SECRETS: `${channels[0].secret()},invalid-secret` },
    { CONTRIB_TOKEN_KEY: '' }, { CONTRIB_TOKEN_KEY: 'short' }, { CONTRIB_SPONSOR_MAX_RESERVE: 'bad' },
  ]) {
    const { deps, loaded } = fixture(settings);
    assert.deepEqual(await createAccountHandlers(deps).prepare({ publicKey: participant.publicKey() }, ip),
      { ok: false, reason: 'config-error' });
    assert.deepEqual(loaded, []);
  }
  const { deps, submitted } = fixture({ CONTRIB_SPONSOR_SECRET: '' });
  const tx = participantTx();
  tx.sign(participant);
  assert.deepEqual(await createFeeBumpHandler(deps)({ xdr: tx.toXDR(), participant: participant.publicKey() }),
    { ok: false, reason: 'config-error' });
  assert.equal(submitted.length, 0);
});

test('routes enforce JSON shape, a streamed 16 KiB byte limit and rate limiting without network', async () => {
  const account = await import(new URL('../../app/api/contributions/account/route.ts', import.meta.url).href);
  const feebump = await import(new URL('../../app/api/contributions/feebump/route.ts', import.meta.url).href);
  for (const [index, route] of [account, feebump].entries()) {
    assert.equal(route.dynamic, 'force-dynamic');
    let requestId = 0;
    const post = (body: BodyInit, ip = `test-route-${index}-${requestId++}`) => route.POST(new Request('http://local.test', {
      method: 'POST', headers: { 'x-forwarded-for': `${ip}, proxy` }, body, duplex: 'half',
    } as RequestInit));
    for (const raw of ['{', 'null', '[]']) {
      const response = await post(raw);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { ok: false, reason: 'invalid_json' });
    }
    const exact = await post('{}' + ' '.repeat(16382));
    assert.equal(exact.status, 400);
    assert.notEqual((await exact.json()).reason, 'too_large');
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('"' + 'é'.repeat(8192) + '"')); },
      cancel() { cancelled = true; },
    });
    const large = await post(stream);
    assert.equal(large.status, 413);
    assert.deepEqual(await large.json(), { ok: false, reason: 'too_large' });
    assert.equal(cancelled, true);
    // The contribution limiter is its own: 120 per IP, not the waitlist's 5.
    for (let n = 0; n < 120; n++) assert.equal((await post('{', `limited-${index}`)).status, 400);
    const limited = await post('{', `limited-${index}`);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { ok: false, reason: 'rate_limited' });
    assert.ok(Number(limited.headers.get('Retry-After')) > 0);
    // Thursday's hub: 30 clients behind one IP with their own keys all pass two calls each.
    const keyed = (key: Keypair) => JSON.stringify(index === 0
      ? { action: 'prepare', publicKey: key.publicKey() } : { xdr: 'not-xdr', participant: key.publicKey() });
    for (let client = 0; client < 30; client++) {
      const key = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 100 + client));
      for (let call = 0; call < 2; call++) assert.notEqual((await post(keyed(key), `hub-${index}`)).status, 429);
    }
    // One client repeating its key: the eleventh call in the minute is 429. Both routes share one limiter,
    // so each route gets its own repeated key.
    const repeated = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 99 - index));
    for (let n = 0; n < 10; n++) assert.notEqual((await post(keyed(repeated), `repeat-${index}-${n}`)).status, 429);
    const eleventh = await post(keyed(repeated), `repeat-${index}-10`);
    assert.equal(eleventh.status, 429);
    assert.deepEqual(await eleventh.json(), { ok: false, reason: 'rate_limited' });
  }
});

test('route statuses: busy is 503 with Retry-After 2 and costs no quota; expired 410; existing accounts 409', async () => {
  const { contributionRoute } = await import(new URL('./handlers.ts', import.meta.url).href);
  const { createRateLimiter } = await import(new URL('./rate-limit.ts', import.meta.url).href);
  const { deps } = fixture({ CONTRIB_CHANNEL_SECRETS: channels[0].secret() });
  const post = (route: (request: Request) => Promise<Response>, body: unknown, from = ip) => route(new Request('http://local.test', {
    method: 'POST', headers: { 'x-forwarded-for': from }, body: JSON.stringify(body),
  }));
  // Every channel is leased by someone else, so prepare answers busy.
  const held = await signedFor(deps, other);
  const tight = contributionRoute('account', () => deps, createRateLimiter({ perIp: 1, perKey: 1 }));
  for (let n = 0; n < 3; n++) {
    const busy = await post(tight, { action: 'prepare', publicKey: participant.publicKey() }, 'busy-ip');
    assert.equal(busy.status, 503);
    assert.equal(busy.headers.get('Retry-After'), '2');
    assert.deepEqual(await busy.json(), { ok: false, reason: 'busy' });
  }
  const account = contributionRoute('account', () => deps, createRateLimiter());
  deps.now = () => new Date(instant.getTime() + 51_000);
  const expired = await post(account, { action: 'complete', ...held.body });
  assert.equal(expired.status, 410);
  assert.deepEqual(await expired.json(), { ok: false, reason: 'expired' });
  deps.now = () => instant;
  for (const [existing, reason] of [[{ sponsor: sponsor.publicKey() }, 'already-onboarded'], [{ sponsor: null }, 'account-exists']] as const) {
    deps.findAccount = async () => existing;
    const response = await post(account, { action: 'prepare', publicKey: participant.publicKey() });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { ok: false, reason });
  }
  for (const [body, reason] of [
    [{ action: 'prepare', publicKey: 'nope' }, 'invalid-public-key'], [{ action: 'other' }, 'invalid-action'],
    [{ action: 'complete' }, 'invalid-body'],
  ] as const) {
    const response = await post(account, body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, reason });
  }
  const feebump = contributionRoute('feebump', () => deps, createRateLimiter());
  const invalid = await post(feebump, { xdr: 'not-xdr', participant: participant.publicKey() });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { ok: false, reason: 'invalid-xdr' });
});

test('complete is limited by the key of the account it onboards, read from the XDR', async () => {
  const { contributionRoute } = await import(new URL('./handlers.ts', import.meta.url).href);
  const { createRateLimiter } = await import(new URL('./rate-limit.ts', import.meta.url).href);
  const { deps } = fixture();
  const route = contributionRoute('account', () => deps, createRateLimiter({ perKey: 1 }));
  const post = (body: unknown) => route(new Request('http://local.test', {
    method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify(body),
  }));
  const prepared = await post({ action: 'prepare', publicKey: participant.publicKey() });
  assert.equal(prepared.status, 200);
  const { xdr, token } = await prepared.json();
  const tx = new Transaction(xdr, Networks.TESTNET);
  tx.sign(participant);
  const completed = await post({ action: 'complete', xdr: tx.toXDR(), token });
  assert.equal(completed.status, 429);
});

test('onboarding and fee bump reserve against the same sponsor cap before submitting', async () => {
  const { deps, submitted } = fixture();
  const body = await signedOnboarding(deps);
  const tx = participantTx();
  tx.sign(participant);
  const claims: Array<{ sponsor: string; stroops: number }> = [];
  deps.reserveSponsorBudget = async claim => {
    claims.push(claim);
    return { state: claims.length === 1 ? 'reserved' : 'exhausted' };
  };

  const [onboarding, feeBump] = await Promise.all([
    createAccountHandlers(deps).complete(body),
    createFeeBumpHandler(deps)({ xdr: tx.toXDR(), participant: participant.publicKey() }),
  ]);
  assert.equal([onboarding, feeBump].filter(result => result.ok).length, 1);
  assert.equal([onboarding, feeBump].find(result => !result.ok)?.reason, 'budget-exhausted');
  assert.deepEqual(claims.map(claim => claim.stroops).sort((a, b) => a - b), [300, 10_000_300]);
  assert.ok(claims.every(claim => claim.sponsor === sponsor.publicKey()));
  assert.equal(submitted.length, 1);
});

test('Redis failure refuses to submit either sponsored transaction', async () => {
  const { deps, submitted } = fixture();
  const body = await signedOnboarding(deps);
  const tx = participantTx();
  tx.sign(participant);
  deps.reserveSponsorBudget = async () => { throw new Error('storage unavailable'); };
  assert.deepEqual(await createAccountHandlers(deps).complete(body), { ok: false, reason: 'budget-unavailable' });
  assert.deepEqual(await createFeeBumpHandler(deps)({ xdr: tx.toXDR(), participant: participant.publicKey() }),
    { ok: false, reason: 'budget-unavailable' });
  assert.equal(submitted.length, 0);
});

test('a repeat with a reserved hash reconciles instead of submitting twice', async () => {
  const { deps, submitted } = fixture();
  const tx = participantTx();
  tx.sign(participant);
  const request = { xdr: tx.toXDR(), participant: participant.publicKey() };
  let reserved: { hash: string; txHash: string } | undefined;
  deps.reserveSponsorBudget = async ({ hash, txHash }) => {
    if (reserved?.hash === hash) {
      assert.notEqual(txHash, reserved.txHash);
      return { state: 'duplicate', txHash: reserved.txHash };
    }
    reserved = { hash, txHash };
    return { state: 'reserved' };
  };
  const handler = createFeeBumpHandler(deps);
  assert.equal((await handler(request)).ok, true);
  const submittedHash = submitted[0].hash().toString('hex');
  deps.getTransaction = async hash => {
    assert.equal(hash, submittedHash);
    return { successful: true, ledger: 123 };
  };
  tx.sign(other);
  assert.deepEqual(await handler({ ...request, xdr: tx.toXDR() }),
    { ok: true, hash: submittedHash, ledger: 123, reconciled: true });
  assert.equal(submitted.length, 1);
});
