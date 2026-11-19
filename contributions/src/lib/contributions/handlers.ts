// Lore: runs the clue «En Stellar, dos transacciones de la misma cuenta en el mismo canal hacen que Horizon
// responda 504» (confirmed) in desarrollo-web/proyectos/vespi/lore/proyecto.md: lease the channel, and
// reconcile by hash before any retry. Never resend blindly.
import { randomInt } from 'node:crypto';
import {
  type Account, type FeeBumpTransaction, BASE_FEE, Keypair, Networks, StrKey, Transaction, TransactionBuilder,
} from '@stellar/stellar-sdk/base';
import { checkOnboarding, checkParticipantTx, ONBOARDING_RESERVE_STROOPS, readSponsorConfig } from './sponsor-policy';
import type { SponsorBudget } from './sponsor-budget';
import { buildFeeBump, buildOnboardingTx, isBadSequence, onboardingToken, verifyOnboardingToken } from './stellar-server';
import type { RateLimiter } from './rate-limit';

export type Deps = {
  loadAccount(id: string): Promise<Account>;
  // null when the account does not exist; throws when Horizon cannot answer.
  findAccount(id: string): Promise<{ sponsor: string | null } | null>;
  // null when Horizon does not know the hash; throws when Horizon cannot answer.
  getTransaction(hash: string): Promise<{ successful: boolean; ledger: number } | null>;
  submit(tx: Transaction | FeeBumpTransaction): Promise<{ hash: string; ledger: number }>;
  env: Record<string, string | undefined>;
  reserveSponsorBudget: SponsorBudget;
  now(): Date;
  leases?: ChannelLeases;
  // Explicit open leases per IP (CONTRIB_LEASES_PER_IP, read by the route); otherwise leasesPerIp derives it.
  leasesPerIp?: number;
};

// A channel is leased from prepare until complete ends or the transaction's maxTime passes, so two
// in-flight onboardings never share a channel sequence. In memory: one lease store per server instance.
export type ChannelLeases = Map<string, { hash: string; until: number; ip: string }>;

const LEASE_SECONDS = 60;
// Clocks drift: a lease is held 10 s past its maxTime, and complete refuses a transaction with less than 10 s left.
const CLOCK_MARGIN_SECONDS = 10;

// One venue Wi-Fi is one IP: it may hold every channel but 8, never fewer than 2, unless an override says otherwise.
export function leasesPerIp(channelCount: number, override?: number): number {
  return override ?? Math.max(2, channelCount - 8);
}

// A positive integer, or undefined so the derived value applies.
export function parseLeasesPerIp(value: string | undefined): number | undefined {
  const trimmed = value?.trim() ?? '';
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return parsed > 0 ? parsed : undefined;
}

function leaseOpen(lease: { until: number }, nowSeconds: number): boolean {
  return lease.until + CLOCK_MARGIN_SECONDS >= nowSeconds;
}

export function createChannelLeases(): ChannelLeases {
  return new Map();
}

const instanceLeases = createChannelLeases();

type Failure = { ok: false; reason: string };
// A reconciled submission was resolved on the ledger after a submission timeout. Its hash is null when the
// transaction was not found by hash but the account exists with our sponsor.
type Submitted = { ok: true; hash: string | null; ledger: number | null; reconciled?: true };
type Prepared = { ok: true; xdr: string; token: string; channel: string };

function isObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null && !Array.isArray(body);
}

function isPublicKey(value: unknown): value is string {
  return typeof value === 'string' && StrKey.isValidEd25519PublicKey(value);
}

function readFeeConfig(env: Deps['env']) {
  return {
    sponsor: Keypair.fromSecret(env.CONTRIB_SPONSOR_SECRET ?? ''),
    policy: readSponsorConfig(env),
  };
}

function readAccountConfig(env: Deps['env']) {
  const config = readFeeConfig(env);
  const channels = (env.CONTRIB_CHANNEL_SECRETS ?? '').split(',').map(secret => Keypair.fromSecret(secret.trim()));
  const tokenKey = Buffer.from(env.CONTRIB_TOKEN_KEY ?? '', 'utf8');
  if (tokenKey.length < 32) throw new Error('invalid token key');
  return { ...config, channels, tokenKey };
}

export function hasParticipantSignature(tx: Transaction, participant: string): boolean {
  const key = Keypair.fromPublicKey(participant);
  const hash = tx.hash();
  return tx.signatures.some(signature => signature.hint().equals(key.signatureHint()) &&
    signature.signature().length === 64 && key.verify(hash, signature.signature()));
}

function submissionFailure(error: unknown): Failure {
  if (isBadSequence(error)) return { ok: false, reason: 'retry' };
  const codes = (error as {
    response?: { data?: { extras?: { result_codes?: { transaction?: string; inner_transaction?: string } } } };
  } | null)?.response?.data?.extras?.result_codes;
  if (codes?.transaction === 'tx_fee_bump_inner_failed') return { ok: false, reason: 'inner-failed' };
  return { ok: false, reason: 'horizon-error' };
}

// Horizon answers 504 when it held the submission without a result; no response means the network failed.
function isSubmissionTimeout(error: unknown): boolean {
  const response = (error as { response?: { status?: number } } | null)?.response;
  return !response || response.status === 504;
}

type Reconciled = { result: Submitted | Failure; keepLease: boolean };

// A timeout has no result: look the transaction up by hash, then the account, and never resend.
async function reconcile(deps: Deps, hash: string, account: string, sponsor: string): Promise<Reconciled> {
  try {
    const found = await deps.getTransaction(hash);
    if (found?.successful) return { result: { ok: true, hash, ledger: found.ledger, reconciled: true }, keepLease: false };
    // On the ledger but failed: the channel sequence was used, so a new prepare can take it.
    if (found) return { result: { ok: false, reason: 'retry' }, keepLease: false };
    const existing = await deps.findAccount(account);
    // Not found by hash yet: the transaction may still land before its maxTime, so the channel stays leased.
    if (existing?.sponsor === sponsor) return { result: { ok: true, hash: null, ledger: null, reconciled: true }, keepLease: true };
    if (existing) return { result: { ok: false, reason: 'account-exists' }, keepLease: true };
    return { result: { ok: false, reason: 'retry' }, keepLease: true };
  } catch {
    // Unknown outcome: hold the channel until maxTime so its sequence is not reused meanwhile.
    return { result: { ok: false, reason: 'horizon-error' }, keepLease: true };
  }
}

async function reserveBudget(deps: Pick<Deps, 'reserveSponsorBudget'>, claim: Parameters<SponsorBudget>[0]) {
  try { return await deps.reserveSponsorBudget(claim); }
  catch { return { state: 'unavailable' } as const; }
}

export function createAccountHandlers(deps: Deps) {
  const leases = deps.leases ?? instanceLeases;
  return {
    async prepare(body: unknown, ip: string): Promise<Prepared | Failure> {
      if (!isObject(body) || !isPublicKey(body.publicKey)) return { ok: false, reason: 'invalid-public-key' };
      let config;
      try { config = readAccountConfig(deps.env); }
      catch { return { ok: false, reason: 'config-error' }; }
      const now = deps.now();
      const checked = checkOnboarding(body.publicKey, config.policy, now);
      if (!checked.ok) return checked;
      const cap = leasesPerIp(config.channels.length, deps.leasesPerIp);
      // Channels this IP may lease now; empty when it is at its cap or every channel is in flight.
      const freeChannels = (nowSeconds: number) => {
        const open = [...leases.values()].filter(lease => lease.ip === ip && leaseOpen(lease, nowSeconds));
        if (open.length >= cap) return [];
        return config.channels.map(key => key.publicKey()).filter(key => {
          const lease = leases.get(key);
          return !lease || !leaseOpen(lease, nowSeconds);
        });
      };
      // A cheap check first, so a full venue does not cost a Horizon lookup per waiting client.
      if (freeChannels(Math.floor(now.getTime() / 1000)).length === 0) return { ok: false, reason: 'busy' };
      // Look the account up before building anything: an onboarded participant needs no channel.
      let existing;
      try { existing = await deps.findAccount(body.publicKey); }
      catch { return { ok: false, reason: 'horizon-error' }; }
      if (existing) {
        return { ok: false, reason: existing.sponsor === config.sponsor.publicKey() ? 'already-onboarded' : 'account-exists' };
      }
      const nowSeconds = Math.floor(deps.now().getTime() / 1000);
      // No await from here to the lease, so concurrent prepares see each other's reservations.
      const free = freeChannels(nowSeconds);
      if (free.length === 0) return { ok: false, reason: 'busy' };
      const channel = free[randomInt(free.length)];
      const lease = { hash: '', until: nowSeconds + LEASE_SECONDS, ip };
      leases.set(channel, lease);
      try {
        const tx = buildOnboardingTx({
          channel: await deps.loadAccount(channel), sponsor: config.sponsor.publicKey(),
          newAccount: body.publicKey, baseFee: BASE_FEE, timeoutSeconds: 0,
        });
        // The shared builder uses wall time; bind the deadline to the injected clock instead.
        const bounded = TransactionBuilder.cloneFrom(tx, {
          timebounds: { minTime: 0, maxTime: lease.until },
        }).build();
        lease.hash = bounded.hash().toString('hex');
        const xdr = bounded.toXDR();
        return { ok: true, xdr, token: onboardingToken(xdr, config.tokenKey), channel };
      } catch {
        if (leases.get(channel) === lease) leases.delete(channel);
        return { ok: false, reason: 'horizon-error' };
      }
    },

    async complete(body: unknown): Promise<Submitted | Failure> {
      if (!isObject(body) || typeof body.xdr !== 'string' || typeof body.token !== 'string') {
        return { ok: false, reason: 'invalid-body' };
      }
      let config;
      try { config = readAccountConfig(deps.env); }
      catch { return { ok: false, reason: 'config-error' }; }
      if (!verifyOnboardingToken(body.xdr, body.token, config.tokenKey)) return { ok: false, reason: 'bad-token' };
      const tx = new Transaction(body.xdr, Networks.TESTNET);
      const [begin, create, end] = tx.operations;
      const sponsor = config.sponsor.publicKey();
      const channel = config.channels.find(key => key.publicKey() === tx.source);
      if (!channel || tx.operations.length !== 3 || tx.memo.type !== 'none' ||
        begin.type !== 'beginSponsoringFutureReserves' || begin.source !== sponsor || !isPublicKey(begin.sponsoredId) ||
        create.type !== 'createAccount' || create.source !== sponsor || create.destination !== begin.sponsoredId ||
        create.startingBalance !== '0.0000000' || end.type !== 'endSponsoringFutureReserves' ||
        end.source !== begin.sponsoredId || !tx.timeBounds || tx.timeBounds.maxTime === '0') {
        return { ok: false, reason: 'invalid-onboarding' };
      }
      // Signatures do not change the hash, so this matches the lease taken by the prepare that built it.
      const hash = tx.hash().toString('hex');
      let keepLease = false;
      try {
        const now = deps.now();
        if (BigInt(tx.timeBounds.maxTime) < BigInt(Math.floor(now.getTime() / 1000) + CLOCK_MARGIN_SECONDS)) {
          return { ok: false, reason: 'expired' };
        }
        if (!hasParticipantSignature(tx, begin.sponsoredId)) return { ok: false, reason: 'missing-participant-signature' };
        const checked = checkOnboarding(begin.sponsoredId, config.policy, now);
        if (!checked.ok) return checked;
        const budget = await reserveBudget(deps, {
          sponsor, hash, txHash: hash, stroops: ONBOARDING_RESERVE_STROOPS + Number(tx.fee),
        });
        if (budget.state === 'exhausted') return { ok: false, reason: 'budget-exhausted' };
        if (budget.state === 'unavailable') return { ok: false, reason: 'budget-unavailable' };
        if (budget.state === 'duplicate') {
          const reconciled = await reconcile(deps, hash, begin.sponsoredId, sponsor);
          keepLease = reconciled.keepLease;
          return reconciled.result;
        }
        const signingTime = deps.now();
        if (BigInt(tx.timeBounds.maxTime) < BigInt(Math.floor(signingTime.getTime() / 1000) + CLOCK_MARGIN_SECONDS)) {
          return { ok: false, reason: 'expired' };
        }
        const currentAuthority = checkOnboarding(begin.sponsoredId, config.policy, signingTime);
        if (!currentAuthority.ok) return currentAuthority;
        try { tx.sign(channel, config.sponsor); }
        catch { return { ok: false, reason: 'horizon-error' }; }
        try {
          const submitted = await deps.submit(tx);
          return { ok: true, hash: submitted.hash, ledger: submitted.ledger };
        } catch (error) {
          // Changing the channel changes the signed hash; only the participant can sign a retry.
          if (isBadSequence(error) || !isSubmissionTimeout(error)) return submissionFailure(error);
          const reconciled = await reconcile(deps, hash, begin.sponsoredId, sponsor);
          keepLease = reconciled.keepLease;
          return reconciled.result;
        }
      } finally {
        if (!keepLease && leases.get(tx.source)?.hash === hash) leases.delete(tx.source);
      }
    },
  };
}

export type FeeBumpDeps = Pick<Deps, 'env' | 'now' | 'reserveSponsorBudget' | 'getTransaction' | 'submit'>;

export function createFeeBumpHandler(deps: FeeBumpDeps) {
  return async (body: unknown): Promise<Submitted | Failure> => {
    if (!isObject(body) || typeof body.xdr !== 'string' || typeof body.participant !== 'string') {
      return { ok: false, reason: 'invalid-body' };
    }
    if (!isPublicKey(body.participant)) return { ok: false, reason: 'invalid-public-key' };
    let tx;
    try { tx = new Transaction(body.xdr, Networks.TESTNET); }
    catch { return { ok: false, reason: 'invalid-xdr' }; }
    let config;
    try { config = readFeeConfig(deps.env); }
    catch { return { ok: false, reason: 'config-error' }; }
    const checked = checkParticipantTx(tx, body.participant, config.policy, deps.now());
    if (!checked.ok) return checked;
    if (!hasParticipantSignature(tx, body.participant)) return { ok: false, reason: 'missing-participant-signature' };
    let outer;
    try { outer = buildFeeBump(tx, config.sponsor, checked.baseFee); }
    catch (error) { return submissionFailure(error); }
    if (BigInt(outer.fee) !== BigInt(2) * BigInt(checked.baseFee)) return { ok: false, reason: 'fee-over-limit' };
    const budget = await reserveBudget(deps, {
      sponsor: config.sponsor.publicKey(), hash: tx.hash().toString('hex'),
      txHash: outer.hash().toString('hex'), stroops: Number(outer.fee),
    });
    if (budget.state === 'exhausted') return { ok: false, reason: 'budget-exhausted' };
    if (budget.state === 'unavailable') return { ok: false, reason: 'budget-unavailable' };
    if (budget.state === 'duplicate') {
      try {
        const hash = budget.txHash;
        const found = await deps.getTransaction(hash);
        if (found?.successful) return { ok: true, hash, ledger: found.ledger, reconciled: true };
        return { ok: false, reason: found ? 'inner-failed' : 'retry' };
      } catch { return { ok: false, reason: 'horizon-error' }; }
    }
    const currentAuthority = checkParticipantTx(tx, body.participant, config.policy, deps.now());
    if (!currentAuthority.ok) return currentAuthority;
    try {
      outer.sign(config.sponsor);
      const { hash, ledger } = await deps.submit(outer);
      return { ok: true, hash, ledger };
    } catch (error) { return submissionFailure(error); }
  };
}

export async function readContributionBody(request: Request, maxBytes = 16 * 1024): Promise<{ ok: true; body: Record<string, unknown> } | Failure> {
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (!reader) return { ok: false, reason: 'invalid_json' };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    return isObject(body) ? { ok: true, body } : { ok: false, reason: 'invalid_json' };
  } catch { return { ok: false, reason: 'invalid_json' }; }
  finally { reader?.releaseLock(); }
}

// Rejections that are not plain validation errors (400).
const STATUS: Record<string, number> = {
  rate_limited: 429, too_large: 413, 'config-error': 503, busy: 503, 'horizon-error': 502, retry: 409,
  'already-onboarded': 409, 'account-exists': 409, expired: 410, 'inner-failed': 422,
  'budget-exhausted': 409, 'budget-unavailable': 503,
};

// The participant key a call spends quota on: publicKey in prepare, the onboarded account of the XDR in
// complete, participant in the fee bump. Null when the body names none.
function limitKey(kind: 'account' | 'feebump', body: Record<string, unknown>): string | null {
  if (kind === 'feebump') return isPublicKey(body.participant) ? body.participant : null;
  if (body.action === 'prepare') return isPublicKey(body.publicKey) ? body.publicKey : null;
  if (body.action !== 'complete' || typeof body.xdr !== 'string') return null;
  try {
    const [begin] = new Transaction(body.xdr, Networks.TESTNET).operations;
    return begin?.type === 'beginSponsoringFutureReserves' && isPublicKey(begin.sponsoredId) ? begin.sponsoredId : null;
  } catch { return null; }
}

// The whole POST of a contribution route, so the route files only wire Horizon in.
export function contributionRoute(kind: 'account' | 'feebump', makeDeps: () => Deps, limiter: RateLimiter) {
  return async (request: Request): Promise<Response> => {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const parsed = await readContributionBody(request);
    const hit = limiter.take(ip, parsed.ok ? limitKey(kind, parsed.body) : null);
    if (!hit.ok) {
      return Response.json({ ok: false, reason: 'rate_limited' }, {
        status: 429, headers: { 'Retry-After': String(hit.retryAfter) },
      });
    }
    if (!parsed.ok) return Response.json(parsed, { status: STATUS[parsed.reason] ?? 400 });
    const { body } = parsed;
    let result: Submitted | Prepared | Failure;
    if (kind === 'feebump') result = await createFeeBumpHandler(makeDeps())(body);
    else if (body.action === 'prepare') result = await createAccountHandlers(makeDeps()).prepare(body, ip);
    else if (body.action === 'complete') result = await createAccountHandlers(makeDeps()).complete(body);
    else result = { ok: false, reason: 'invalid-action' };
    if (result.ok) return Response.json(result, { status: 200 });
    if (result.reason === 'busy') {
      // Waiting for a free channel costs no quota.
      hit.release();
      return Response.json(result, { status: 503, headers: { 'Retry-After': '2' } });
    }
    return Response.json(result, { status: STATUS[result.reason] ?? 400 });
  };
}
