'use client';

import { useEffect, useEffectEvent, useRef } from 'react';
import type { Signer } from '@/lib/contributions/keys';
import type { ContributionNetwork } from '@/lib/contributions/network';
import type { ChainVoiceDraft } from '@/lib/contributions/voice/contract';
import { mountVoiceRecorder, type VoiceDraftChoice } from './voice-recorder';
import '../../../public/voice-draft.css';

export default function VoiceDraftControl({ account, lang, network, kind, getSigner, needsPasskey, hasWritten, onDraft, composer }: {
  account?: string;
  lang: 'es' | 'en';
  network: ContributionNetwork;
  kind: 'request' | 'delivery';
  composer?: boolean;
  getSigner(): Signer | Promise<Signer>;
  needsPasskey(): boolean;
  hasWritten(draft: ChainVoiceDraft): boolean;
  onDraft(draft: ChainVoiceDraft, choice: VoiceDraftChoice): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const signerForVoice = useEffectEvent(getSigner);
  const passkeyForVoice = useEffectEvent(needsPasskey);
  const checkDraft = useEffectEvent(hasWritten);
  const applyDraft = useEffectEvent(onDraft);

  useEffect(() => {
    if (!host.current || !account) return;
    return mountVoiceRecorder(host.current, {
      account, lang, network, kind, composer, getSigner: () => signerForVoice(), needsPasskey: () => passkeyForVoice(),
      hasWritten: draft => 'statement' in draft && checkDraft(draft),
      onDraft: (draft, choice) => { if ('statement' in draft) applyDraft(draft, choice); },
    });
  }, [account, lang, network, kind, composer]);

  return <div ref={host} hidden />;
}
