import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { StrKey } from '@stellar/stellar-sdk/base';
import { createProfileRegistry } from '@/lib/contributions/profile-registry';
import { isEncounterId } from '@/lib/contributions/encounters';
import { DEFAULT_NETWORK, parseContributionNetwork } from '@/lib/contributions/network';
import { createPublicEncounters, publicProfileLimiter } from '@/lib/contributions/public-encounters';
import { focusAttendanceSlot, focusRoot } from '@/lib/contributions/focus-event';
import { createReceiptRegistry } from '@/lib/contributions/receipt-registry';
import { parseContribution } from '@/lib/contributions/kernel/contributions.js';
import ProfileView from './ProfileView';
import '../../mobile.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Perfil público · Vespi Contributions',
  robots: { index: false, follow: true },
};

type ProfileProps = {
  params: Promise<{ account: string }>;
  searchParams: Promise<{ network?: string | string[]; lang?: string | string[]; cursor?: string | string[] }>;
};

async function readAttendance(root: string, account: string) {
  const record = await createReceiptRegistry(process.env).head(focusAttendanceSlot(root, account));
  if (!record?.index) return undefined;
  const receipt = parseContribution(record.intent.bytes);
  if (receipt.kind === 'ATTEST' && receipt.chain === root && receipt.subject === root && receipt.actor === account) {
    return { digest: record.index.digest, statement: receipt.statement };
  }
}

export default async function ProfilePage({ params, searchParams }: ProfileProps) {
  const [{ account }, query, requestHeaders] = await Promise.all([params, searchParams, headers()]);
  if (!StrKey.isValidEd25519PublicKey(account)) notFound();
  let network;
  try { network = parseContributionNetwork(query.network ?? DEFAULT_NETWORK); }
  catch { notFound(); }
  const cursor = query.cursor ?? '0';
  if (cursor !== '0' && !isEncounterId(cursor)) notFound();
  const lang = query.lang === 'en' ? 'en' : 'es';
  const hit = publicProfileLimiter.take(requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown', null);

  const profile = hit.ok ? await createProfileRegistry(process.env, fetch, network).get(account).catch(() => undefined) : undefined;
  if (profile === null) notFound();
  const [records, attendance] = await Promise.all([
    profile ? createPublicEncounters(network).list(account, cursor).catch(() => null) : null,
    profile && network === DEFAULT_NETWORK && focusRoot ? readAttendance(focusRoot, account).catch(() => undefined) : undefined,
  ]);
  return <ProfileView key={account + ':' + network + ':' + cursor + ':' + lang} profile={profile}
    network={network} initialLang={lang} page={records} attendance={attendance} cursor={cursor} limited={!hit.ok} />;
}
