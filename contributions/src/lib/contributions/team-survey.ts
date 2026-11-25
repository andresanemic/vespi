import { Keypair, StrKey } from '@stellar/stellar-sdk/base';
import type { SurveyRecord } from './survey-intake';
import { DEFAULT_NETWORK } from './network';
import { teamSurveyRequestMessage } from './team-survey-authorization';

export { teamSurveyRequestMessage } from './team-survey-authorization';

export function surveyCsv(records: Pick<SurveyRecord, 'createdAt' | 'answer'>[]) {
  const columns: (keyof SurveyRecord['answer'] | 'createdAt')[] = [
    'createdAt', 'usefulness', 'building', 'project', 'ambassadorInterest', 'nextTopic', 'email',
  ];
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [columns.map(cell).join(','), ...records.map(record => columns.map(column =>
    cell(column === 'createdAt' ? record.createdAt : record.answer[column])).join(','))].join('\r\n') + '\r\n';
}

export function createTeamSurveyQuery(deps: {
  teamAccounts: string[];
  consumeNonce(account: string, nonce: string): Promise<boolean>;
  list(): Promise<SurveyRecord[]>;
}, now = () => Date.now(), network = DEFAULT_NETWORK) {
  const allowlist = new Set(deps.teamAccounts.filter(StrKey.isValidEd25519PublicKey));
  return async (body: Record<string, unknown>) => {
    const { account, action, cohort, expiresAt, nonce, signature } = body;
    const seconds = Math.floor(now() / 1000);
    if (typeof account !== 'string' || !allowlist.has(account) ||
      (action !== 'json' && action !== 'csv') || (cohort !== 'rehearsal' && cohort !== 'event') ||
      typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= seconds || expiresAt > seconds + 60 ||
      typeof nonce !== 'string' || !/^[a-f0-9]{32}$/.test(nonce) ||
      typeof signature !== 'string' || !/^[a-f0-9]{128}$/.test(signature)) {
      return { ok: false, reason: 'team-auth-required' } as const;
    }
    if (!Keypair.fromPublicKey(account).verify(Buffer.from(teamSurveyRequestMessage(account, action, cohort, expiresAt, nonce, network)),
      Buffer.from(signature, 'hex'))) return { ok: false, reason: 'team-auth-required' } as const;
    if (expiresAt <= Math.floor(now() / 1000)) return { ok: false, reason: 'team-auth-expired' } as const;
    if (!await deps.consumeNonce(account, nonce)) return { ok: false, reason: 'team-auth-replayed' } as const;
    if (expiresAt <= Math.floor(now() / 1000)) return { ok: false, reason: 'team-auth-expired' } as const;
    const records = (await deps.list()).filter(record => record.rehearsal === (cohort === 'rehearsal'));
    return { ok: true, action, cohort, records: records.map(({ createdAt, answer }) => ({ createdAt, answer })) } as const;
  };
}
