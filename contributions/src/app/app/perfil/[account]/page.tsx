import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StrKey } from '@stellar/stellar-sdk/base';
import { createProfileRegistry } from '@/lib/contributions/profile-registry';
import ProfileView from './ProfileView';
import '../../mobile.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Perfil público · Vespi Contributions',
  robots: { index: false, follow: true },
};

export default async function ProfilePage({ params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  if (!StrKey.isValidEd25519PublicKey(account)) notFound();

  const profile = await createProfileRegistry(process.env).get(account).catch(() => undefined);
  if (profile === null) notFound();
  return <ProfileView key={account} profile={profile} />;
}
