import type { ContributionNetwork } from '../network';
import type { EncounterDraft } from '../encounters';

export const VOICE_MIN_SECONDS = 8;
export const VOICE_MAX_SECONDS = 120;
export const VOICE_MAX_BYTES = 2 * 1024 * 1024;
export const VOICE_AUTH_SECONDS = 300;

export type VoiceKind = 'request' | 'delivery' | 'encounter';
export type ChainVoiceDraft = { statement: string; comment?: string };
export type EncounterVoiceDraft = {
  type: EncounterDraft['type'] | '';
  title: string;
  date?: string;
  where?: string;
  summary: string;
  contributions: { from: 'a' | 'b'; text: string }[];
  otherName?: string;
};
export type VoiceDraft = ChainVoiceDraft | EncounterVoiceDraft;

export function voiceMessage(network: ContributionNetwork, account: string, expires: number,
  kind: VoiceKind, audioSha256: string, nonce: string) {
  return new TextEncoder().encode(`vespi:voice-draft:v2:${network}:${account}:${expires}:${kind}:${audioSha256}:${nonce}`);
}
