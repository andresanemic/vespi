import assert from 'node:assert/strict';
import { chainFixture, fakeStores, fixtureAccounts, fixtureRepository, revisedRequestText, unavailableRequestText } from './contributions-chain.mjs';

Object.assign(process.env, fakeStores);
if (process.env.VESPI_FIXTURE_REPOSITORY === '1') process.env.CONTRIB_EVIDENCE_REPO_URL = fixtureRepository;
const chains = {
  mainnet: chainFixture('mainnet'),
  testnet: chainFixture('testnet'),
};
const variant = {
  mainnet: chainFixture('mainnet', { requestText: revisedRequestText, revision: true }),
  testnet: chainFixture('testnet', { requestText: revisedRequestText }),
};
const unavailable = chainFixture('mainnet', { requestText: unavailableRequestText });
let failOnce = true;
const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (['localhost', '127.0.0.1'].includes(url.hostname)) return realFetch(input, init);
  const network = { 'test-store.invalid': 'testnet', 'main-store.invalid': 'mainnet' }[url.hostname];
  assert.ok(network, 'Unexpected server-side network: ' + url.origin);
  const [command, key, field] = JSON.parse(init?.body ?? await input.text());
  assert.equal(command, 'HGET');
  assert.ok(key.startsWith('contributions:' + network + ':'));
  const chain = chains[network];
  if (key.endsWith(':profiles')) {
    const names = network === 'mainnet'
      ? { [fixtureAccounts.requester]: 'Ada Fixture', [fixtureAccounts.contributor]: 'Unmentioned Public Profile' }
      : { [fixtureAccounts.requester]: 'Al' };
    return Response.json({ result: names[field] ?? null });
  }
  assert.ok(key.endsWith(':receipts'));
  const [, digest] = field.split(':');
  if (field.startsWith('head:')) {
    if (network === 'mainnet' && digest === unavailable.root) {
      if (failOnce) {
        failOnce = false;
        return new Response(null, { status: 503 });
      }
      return Response.json({ result: unavailable.accept.index.digest });
    }
    // The same request bytes have only reached CONTRIBUTE on testnet in this browser fixture.
    const head = digest === chain.root ? (network === 'mainnet' ? chain.accept : chain.records[1])
      : digest === variant[network].root ? variant[network].accept : undefined;
    return Response.json({ result: head?.index.digest ?? null });
  }
  const visible = network === 'mainnet' ? chain.records : chain.records.slice(0, 2);
  const record = [...visible, ...variant[network].records, ...(network === 'mainnet' ? unavailable.records : [])]
    .find(entry => entry.index.digest === digest);
  return Response.json({ result: record ? JSON.stringify({
    intent: { digest, bytes: record.bytes, chain: record.receipt.chain ?? digest },
    index: record.index,
  }) : null });
};
