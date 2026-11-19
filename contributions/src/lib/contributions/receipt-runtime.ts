import { Keypair } from '@stellar/stellar-sdk/base';
import { createPhotoStore } from './contribution-photos';
import { createFeeBumpHandler } from './handlers';
import { latestLedgerTime, lookupAnchor, makeFeeBumpDeps } from './fee-bump-runtime';
import { createReceiptAnchor } from './receipt-anchor';
import { createReceiptRegistry } from './receipt-registry';
import { createPrivateSurveyStore } from './survey-intake';
import { readYerkoSettings } from './yerko-event';

export function makeReceiptAnchor() {
  const deps = makeFeeBumpDeps();
  const submit = createFeeBumpHandler(deps);
  const survey = createPrivateSurveyStore(deps.env);
  const photos = createPhotoStore();
  return createReceiptAnchor({
    registry: createReceiptRegistry(deps.env), now: deps.now,
    sponsor: () => Keypair.fromSecret(deps.env.CONTRIB_SPONSOR_SECRET ?? ''),
    cutoff: deps.env.CONTRIB_EVENT_CUTOFF, surveyClosesAt: deps.env.CONTRIB_SURVEY_CLOSES_AT,
    send: (xdr, actor) => submit({ xdr, participant: actor }),
    lookup: lookupAnchor, latestLedgerTime, getSurvey: survey.get, getReport: survey.getReport,
    organizer: deps.env.CONTRIB_ORGANIZER_ACCOUNT,
    yerko: readYerkoSettings(deps.env),
    photoExists: async (actor, digest) => !!await photos.read(actor, digest),
  });
}
