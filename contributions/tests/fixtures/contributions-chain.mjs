import { Account, BASE_FEE, Keypair, Memo, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk/base';
import { canonicalBytes, contributionDigest } from '../../src/lib/contributions/kernel/contributions.js';

const [requester, contributor, sponsor, channel] = [21, 22, 23, 24].map(n => Keypair.fromRawEd25519Seed(Buffer.alloc(32, n)));
export const fixtureAccounts = { requester: requester.publicKey(), contributor: contributor.publicKey() };
export const privateText = ['private statement', 'private comment', 'invite-fixture-secret'];
export const revisedRequestText = 'XAda FixtureX. Al. Revised. ';
export const unavailableRequestText = 'Unavailable fixture. ';
export const fixtureRepository = 'https://example.invalid/chain-evidence';

export function chainFixture(network, {
  revision = false, wrongMemo = false, unsigned = false, requestText = 'ADA FIXTURE. ',
  thirdPartyAccept = false, thirdPartyRevision = false, foreignSubject = false,
} = {}) {
  const passphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  const networkId = network === 'mainnet' ? 'stellar:pubnet' : 'stellar:testnet';
  const createdAt = '2026-11-18T12:00:00.000Z';
  const create = (kind, signer, previous, root, subject, number) => {
    const actor = signer.publicKey();
    const receipt = {
      kind, role: kind === 'CONTRIBUTE' ? 'contributor' : 'requester', actor,
      chain: root, prev: previous, subject,
      statement: (kind === 'REQUEST' ? requestText : '') + privateText[0],
      comment: privateText[1] + ' #' + privateText[2], evidence: null,
      createdAt: new Date(Date.parse(createdAt) + number * 60_000).toISOString(),
    };
    const digest = contributionDigest(receipt);
    const ledger = 12345 + number;
    const tx = new TransactionBuilder(new Account(actor, String(number)), { fee: BASE_FEE, networkPassphrase: passphrase })
      .addMemo(Memo.hash(wrongMemo && number === 1 ? 'a'.repeat(64) : digest))
      .addOperation(Operation.bumpSequence({ bumpTo: String(number + 2) }))
      .setTimebounds(0, 1_800_000_000).build();
    if (!(unsigned && number === 1)) tx.sign(signer);
    const envelope = TransactionBuilder.buildFeeBumpTransaction(sponsor, BASE_FEE, tx, passphrase);
    envelope.sign(sponsor);
    const txHash = envelope.hash().toString('hex');
    const envelopeXdr = envelope.toXDR();
    return {
      bytes: canonicalBytes(receipt), receipt,
      index: { version: 1, digest, network: networkId, txHash, ledger, envelopeXdr, rehearsal: false },
      horizon: { hash: txHash, ledger, envelope_xdr: envelopeXdr, successful: true,
        source_account: actor, fee_account: sponsor.publicKey(), created_at: receipt.createdAt },
    };
  };
  const request = create('REQUEST', requester, null, null, null, 0);
  const root = request.index.digest;
  const contribute = create('CONTRIBUTE', contributor, root, root, null, 1);
  const records = [request, contribute];
  if (revision) records.push(create('CONTRIBUTE', thirdPartyRevision ? channel : contributor, contribute.index.digest, root, null, 2));
  const accept = create('ACCEPT', thirdPartyAccept ? channel : requester, records.at(-1).index.digest, root,
    foreignSubject ? 'f'.repeat(64) : contribute.index.digest, records.length);
  records.push(accept);
  return { root, records, accept };
}

export const fakeStores = {
  CONTRIB_KV_REST_API_URL: 'https://test-store.invalid',
  CONTRIB_KV_REST_API_TOKEN: 'fixture-test-store',
  CONTRIB_KV_MAINNET_REST_API_URL: 'https://main-store.invalid',
  CONTRIB_KV_MAINNET_REST_API_TOKEN: 'fixture-main-store',
  CONTRIB_TOKEN_KEY_MAINNET: 'fixture-main-token-key-32-bytes-long',
  CONTRIB_SPONSOR_SECRET_MAINNET: sponsor.secret(),
  CONTRIB_CHANNEL_SECRETS_MAINNET: channel.secret(),
  CONTRIB_SPONSOR_BUDGET_STROOPS_MAINNET: '200000000',
  CONTRIB_SPONSOR_MAX_FEE_MAINNET: '2000',
  CONTRIB_SPONSOR_MAX_RESERVE_MAINNET: '10000000',
  CONTRIB_SPONSOR_EXPIRES_AT_MAINNET: '2099-01-01T00:00:00Z',
  CONTRIB_ALLOWED_ACCOUNTS_MAINNET: Object.values(fixtureAccounts).join(','),
};
