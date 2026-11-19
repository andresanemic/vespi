import type { Transaction } from '@stellar/stellar-sdk/base';
import { sufficient } from './kernel/authority.js';
import { parseTime } from './kernel/time.js';

export type SponsorConfig = { maxFeeStroops: string; maxReserveStroops: string; expiresAt: string };
type PolicyResult = { ok: true } | { ok: false; reason: string };

export function readSponsorConfig(env: Record<string, string | undefined>): SponsorConfig {
  const maxFeeStroops = env.CONTRIB_SPONSOR_MAX_FEE;
  const maxReserveStroops = env.CONTRIB_SPONSOR_MAX_RESERVE;
  const expiresAt = env.CONTRIB_SPONSOR_EXPIRES_AT;
  if (!maxFeeStroops || !/^\d+$/.test(maxFeeStroops)) {
    throw new Error('contributions: CONTRIB_SPONSOR_MAX_FEE must be integer stroops');
  }
  if (!maxReserveStroops || !/^\d+$/.test(maxReserveStroops)) {
    throw new Error('contributions: CONTRIB_SPONSOR_MAX_RESERVE must be integer stroops');
  }
  if (!expiresAt || parseTime(expiresAt) === null) {
    throw new Error('contributions: CONTRIB_SPONSOR_EXPIRES_AT must be an ISO timestamp with timezone');
  }
  return { maxFeeStroops, maxReserveStroops, expiresAt };
}

export function sponsorAuthority(cfg: SponsorConfig): {
  spend: Array<{ asset: 'XLM'; maxAmount: string; to: string; expiresAt: string }>;
} {
  return { spend: [
    { asset: 'XLM', maxAmount: cfg.maxFeeStroops, to: 'stellar:fee', expiresAt: cfg.expiresAt },
    { asset: 'XLM', maxAmount: cfg.maxReserveStroops, to: 'stellar:reserve', expiresAt: cfg.expiresAt },
  ] };
}

export function checkSponsorSpend({ to, amountStroops }: { to: string; amountStroops: string },
  cfg: SponsorConfig, now: Date): PolicyResult {
  const result = sufficient([{ asset: 'XLM', amount: amountStroops, to }], sponsorAuthority(cfg), { now: now.getTime() });
  if (result.ok) return { ok: true };
  if (result.reason === `no grant for asset XLM to ${to}`) {
    return { ok: false, reason: 'destination-not-allowed' };
  }
  if (result.reason === `grant for asset XLM expired at ${cfg.expiresAt}`) {
    return { ok: false, reason: 'authority-expired' };
  }
  if (to === 'stellar:fee' && /^requirements consume \d+ against grant max \d+ \(XLM to stellar:fee\)$/.test(result.reason)) {
    return { ok: false, reason: 'fee-over-limit' };
  }
  if (to === 'stellar:reserve' && /^requirements consume \d+ against grant max \d+ \(XLM to stellar:reserve\)$/.test(result.reason)) {
    return { ok: false, reason: 'reserve-over-limit' };
  }
  return { ok: false, reason: 'policy-error' };
}

export function checkParticipantTx(tx: Transaction, participant: string, cfg: SponsorConfig, now: Date):
  { ok: true; baseFee: string } | { ok: false; reason: string } {
  if (tx.source !== participant) return { ok: false, reason: 'wrong-source' };
  if (tx.operations.length !== 1) return { ok: false, reason: 'operation-count' };
  const operation = tx.operations[0];
  if (operation.source !== undefined && operation.source !== participant) return { ok: false, reason: 'wrong-source' };
  if (operation.type !== 'bumpSequence') return { ok: false, reason: 'wrong-operation' };
  if (tx.memo.type !== 'hash') return { ok: false, reason: 'memo-not-hash' };
  const baseFee = tx.fee;
  const result = checkSponsorSpend({ to: 'stellar:fee', amountStroops: String(Number(baseFee) * 2) }, cfg, now);
  return result.ok ? { ok: true, baseFee } : result;
}

export const ONBOARDING_RESERVE_STROOPS = 10_000_000;

export function checkOnboarding(_newAccount: string, cfg: SponsorConfig, now: Date): PolicyResult {
  return checkSponsorSpend({ to: 'stellar:reserve', amountStroops: String(ONBOARDING_RESERVE_STROOPS) }, cfg, now);
}
