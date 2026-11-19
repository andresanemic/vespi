import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@stellar/stellar-sdk/base';
const { registerHooks } = await import('node:module' as string);
type Context = { parentURL?: string };
type Resolve = (specifier: string, context: Context) => { url: string };
registerHooks({ resolve(specifier: string, context: Context, next: Resolve) {
  if (specifier.startsWith('./') && context.parentURL?.startsWith(new URL('./', import.meta.url).href) && !/\.[cm]?[jt]s$/.test(specifier))
    return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
  return next(specifier, context);
} });
const { createProfile }: typeof import('./profile') = await import(new URL('./profile.ts', import.meta.url).href);
const { profileMessage }: typeof import('./profile-authorization') = await import(new URL('./profile-authorization.ts', import.meta.url).href);
const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
const account = signer.publicKey();
const expiresAt = 400;
 const body = (name = 'Andrés', exp = expiresAt) => ({ account, displayName: name, expiresAt: exp, signature: signer.sign(Buffer.from(profileMessage(account, name, exp))).toString('hex') });
test('profile signature, limits and immutable idempotent create', async () => {
 let saved: string | null = null;
 const register = createProfile({ exists: async key => key === account, create: async (_key, name) => { if (saved === null) { saved = name; return 'created'; } return saved === name ? 'same' : 'exists'; } }, () => 100_000);
 assert.equal((await register({ ...body(), displayName: 'Other' })).reason, 'profile-signature-required');
 assert.equal((await register(body('Andrés', 701))).reason, 'invalid-profile');
 assert.equal((await register({ ...body(), displayName: 'bad\nname' })).reason, 'invalid-profile');
 assert.deepEqual(await register(body()), { ok: true, created: true });
 assert.deepEqual(await register(body()), { ok: true, created: false });
 assert.equal((await register(body('Otro'))).reason, 'profile-exists');
 assert.equal(saved, 'Andrés');
});
test('profile requires an existing testnet account', async () => {
 const register = createProfile({ exists: async () => false, create: async () => 'created' }, () => 100_000);
 assert.equal((await register(body())).reason, 'profile-account-required');
});
test('profile rechecks expiry after the account lookup', async () => {
 let time = 100_000;
 let writes = 0;
 const register = createProfile({ exists: async () => { time = 401_000; return true; }, create: async () => { writes++; return 'created'; } }, () => time);
 assert.equal((await register(body())).reason, 'invalid-profile');
 assert.equal(writes, 0);
});
