import { Keypair } from '@stellar/stellar-sdk/base';
import { createPhotoStore } from './contribution-photos';
import { createFeeBumpHandler, outerBaseFee } from './handlers';
import { makeFeeBumpDeps } from './fee-bump-runtime';
import { createReceiptAnchor } from './receipt-anchor';
import { accountAllowed, readAccountAllowlist, readSponsorConfig, sponsorSetting } from './sponsor-policy';
import { createReceiptRegistry } from './receipt-registry';
import { createPrivateSurveyStore } from './survey-intake';
import { DEFAULT_NETWORK } from './network';
import { readYerkoSettings } from './yerko-event';

export function makeReceiptAnchor(network = DEFAULT_NETWORK, env: Record<string, string | undefined> = process.env) {
  const deps = makeFeeBumpDeps(network, env);
  const submit = createFeeBumpHandler(deps);
  const survey = createPrivateSurveyStore(env, fetch, network);
  const photos = createPhotoStore({}, network);
  return createReceiptAnchor({
    registry: createReceiptRegistry(env, fetch, network), now: deps.now,
    sponsor: () => Keypair.fromSecret(sponsorSetting(env, 'CONTRIB_SPONSOR_SECRET', network) ?? ''),
    // The event cutoff, survey and organizer belong to the testnet event; a mainnet record is never a rehearsal.
    cutoff: network === DEFAULT_NETWORK ? deps.env.CONTRIB_EVENT_CUTOFF : '1970-01-01T00:00:00.000Z',
    surveyClosesAt: network === DEFAULT_NETWORK ? deps.env.CONTRIB_SURVEY_CLOSES_AT : undefined,
    send: (xdr, actor, baseFee, outer) => submit({ xdr, participant: actor }, baseFee, outer),
    outerFee: async innerFee => {
      try { return await outerBaseFee(deps.networkFee, innerFee, readSponsorConfig(env, network).maxFeeStroops); }
      catch { return innerFee; }
    },
    lookup: deps.getTransaction, latestLedgerTime: deps.latestLedgerTime, getSurvey: survey.get, getReport: survey.getReport,
    organizer: network === DEFAULT_NETWORK ? deps.env.CONTRIB_ORGANIZER_ACCOUNT : undefined,
    yerko: network === DEFAULT_NETWORK ? readYerkoSettings(env) : undefined,
    photoExists: async (actor, digest) => !!await photos.read(actor, digest),
    accountAllowed: actor => accountAllowed(readAccountAllowlist(env, network), actor),
  }, network);
}
