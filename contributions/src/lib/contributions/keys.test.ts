import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';

const {
  PRF_SALT, deriveSeed, keypairFromPrf, signerFromKeypair, signTransaction, isEmbeddedBrowser,
  createPasskey, unlockPasskey, resolvePasskeyPrf,
} = await import(new URL('./keys.ts', import.meta.url).href);
const { createDeviceKey, loadDeviceKey } = await import(new URL('./device-key.ts', import.meta.url).href);

const PRF_OUTPUT = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const VECTOR_ACCOUNT = 'GAMIRSHHIDJH3DPEEUPW3M74ZXLESMZGSLXFLJNLMFULB46AM6S5T5GR';

test('same PRF output and rpId give the same account', async () => {
  const first = await keypairFromPrf(PRF_OUTPUT, 'vespi.xyz');
  const second = await keypairFromPrf(PRF_OUTPUT, 'vespi.xyz');
  assert.equal(first.publicKey(), VECTOR_ACCOUNT);
  assert.equal(second.publicKey(), VECTOR_ACCOUNT);
  assert.equal(
    Buffer.from(await deriveSeed(PRF_OUTPUT, 'vespi.xyz')).toString('hex'),
    'ba75491ffd6f1e9b4e172fe4037ee64fa7d98c131d46e28b41940ad48bfd6611',
  );
});

test('another rpId gives another account', async () => {
  const account = await keypairFromPrf(PRF_OUTPUT, 'other.vespi.xyz');
  assert.notEqual(account.publicKey(), VECTOR_ACCOUNT);
});

test('PRF_SALT is the SHA-256 of the versioned PRF label', () => {
  assert.equal(
    Buffer.from(PRF_SALT).toString('hex'),
    '5cb3560b496ac2538778aeef742c517aa4779ae8f8e5b0ff549e680d544eb4e9',
  );
});

test('signTransaction with a keypair signer produces a signature that verifies', async () => {
  const kp = Keypair.fromRawEd25519Seed(Buffer.from(PRF_OUTPUT));
  const tx = new TransactionBuilder(new Account(kp.publicKey(), '0'), {
    fee: '100', networkPassphrase: Networks.TESTNET,
  }).addOperation(Operation.manageData({ name: 'contribution', value: 'test' }))
    .setTimeout(0).build();

  await signTransaction(tx, signerFromKeypair(kp));

  assert.equal(tx.signatures.length, 1);
  const signature = tx.signatures[0];
  assert.deepEqual(signature.hint(), kp.signatureHint());
  assert.equal(kp.verify(tx.hash(), signature.signature()), true);
  assert.equal(kp.verify(Buffer.alloc(32), signature.signature()), false);
});

test('isEmbeddedBrowser detects WhatsApp and Instagram user agents and not Safari or Chrome', () => {
  assert.equal(isEmbeddedBrowser('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 WhatsApp/2.24.20.89'), true);
  assert.equal(isEmbeddedBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Instagram 331.0.0.30.109'), true);
  assert.equal(isEmbeddedBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1'), false);
  assert.equal(isEmbeddedBrowser('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'), false);
});

test('isEmbeddedBrowser detects Facebook FBAN and FBAV markers', () => {
  assert.equal(isEmbeddedBrowser('Mozilla/5.0 [FBAN/FBIOS;FBDV/iPhone15,3]'), true);
  assert.equal(isEmbeddedBrowser('Mozilla/5.0 [FBAV/490.0.0.0.0;]'), true);
});

function replaceGlobal(t: TestContext, name: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  });
}

test('createPasskey distinguishes enabled PRF from unsupported PRF', async (t) => {
  for (const [extensions, enabled] of [
    [{ prf: { enabled: true } }, true],
    [{ prf: { enabled: false } }, false],
    [{}, false],
  ] as const) {
    await t.test(JSON.stringify(extensions), async (t) => {
      replaceGlobal(t, 'navigator', { credentials: {
        create: async () => ({ id: 'AQID', getClientExtensionResults: () => extensions }),
      } });
      assert.deepEqual(await createPasskey({ rpId: 'vespi.xyz', userName: 'participant' }), {
        credentialId: 'AQID', prf: null, prfEnabled: enabled,
      });
    });
  }
});

test('PRF returned on create is enabled and resolves without another prompt', async (t) => {
  replaceGlobal(t, 'navigator', { credentials: {
    create: async () => ({
      id: 'AQID', getClientExtensionResults: () => ({ prf: { results: { first: PRF_OUTPUT.buffer } } }),
    }),
    get: async () => { assert.fail('PRF already available; no unlock is needed'); },
  } });
  const created = await createPasskey({ rpId: 'vespi.xyz', userName: 'participant' });
  assert.equal(created.prfEnabled, true);
  assert.deepEqual(created.prf, PRF_OUTPUT);
  assert.strictEqual(await resolvePasskeyPrf({ rpId: 'vespi.xyz', created }), created.prf);
});

test('enabled PRF without create results resolves through the same passkey', async (t) => {
  replaceGlobal(t, 'navigator', { credentials: {
    create: async () => ({ id: 'AQID', getClientExtensionResults: () => ({ prf: { enabled: true } }) }),
    get: async ({ publicKey }: CredentialRequestOptions) => {
      assert.equal(publicKey?.rpId, 'vespi.xyz');
      assert.deepEqual(publicKey.allowCredentials, [{ type: 'public-key', id: new Uint8Array([1, 2, 3]) }]);
      assert.deepEqual(publicKey.extensions?.prf?.eval?.first, PRF_SALT);
      return { getClientExtensionResults: () => ({ prf: { results: { first: PRF_OUTPUT.buffer } } }) };
    },
  } });
  const created = await createPasskey({ rpId: 'vespi.xyz', userName: 'participant' });
  assert.deepEqual(await resolvePasskeyPrf({ rpId: 'vespi.xyz', created }), PRF_OUTPUT);
});

test('unsupported PRF resolves to null without prompting', async (t) => {
  replaceGlobal(t, 'navigator', { credentials: {
    create: async () => ({ id: 'AQID', getClientExtensionResults: () => ({}) }),
    get: async () => { assert.fail('Unsupported PRF must not trigger an unlock'); },
  } });
  const created = await createPasskey({ rpId: 'vespi.xyz', userName: 'participant' });
  assert.equal(await resolvePasskeyPrf({ rpId: 'vespi.xyz', created }), null);
});

test('resolvePasskeyPrf propagates unlock cancellation', async (t) => {
  const cancelled = new DOMException('Cancelled', 'NotAllowedError');
  replaceGlobal(t, 'navigator', { credentials: { get: async () => { throw cancelled; } } });
  await assert.rejects(resolvePasskeyPrf({
    rpId: 'vespi.xyz', created: { credentialId: 'AQID', prf: null, prfEnabled: true },
  }), (error) => error === cancelled);
});

function fakeKeyDatabase(t: TestContext, initial?: CryptoKeyPair) {
  const state = { pair: initial, closes: 0 };
  const db = {
    close: () => { state.closes++; },
    transaction: (store: string, mode: string) => {
      assert.equal(store, 'keys');
      const tx = {
        oncomplete: null as (() => void) | null,
        onabort: null as (() => void) | null,
        error: null as DOMException | null,
        objectStore: (name: string) => {
          assert.equal(name, 'keys');
          return {
            get: (id: string) => {
              assert.equal(id, 'device');
              const request = { result: state.pair };
              queueMicrotask(() => tx.oncomplete?.());
              return request;
            },
            add: (pair: CryptoKeyPair, id: string) => {
              assert.equal(mode, 'readwrite');
              assert.equal(id, 'device');
              queueMicrotask(() => {
                if (state.pair) {
                  tx.error = new DOMException('Key already stored', 'ConstraintError');
                  tx.onabort?.();
                } else {
                  state.pair = pair;
                  tx.oncomplete?.();
                }
              });
            },
          };
        },
      };
      return tx;
    },
  };
  replaceGlobal(t, 'indexedDB', { open: (name: string, version: number) => {
    assert.equal(name, 'vespi-contributions');
    assert.equal(version, 1);
    const request = { result: db, onsuccess: null as (() => void) | null };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  } });
  return state;
}

test('createDeviceKey rejects an existing identity before generating another key', async (t) => {
  const existing = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  const state = fakeKeyDatabase(t, existing);
  let generated = 0;
  replaceGlobal(t, 'crypto', { subtle: { generateKey: async () => {
    generated++;
    throw new Error('Key generation must not run');
  } } });
  await assert.rejects(createDeviceKey(), {
    message: 'contributions: a device key already exists',
  });
  assert.equal(generated, 0);
  assert.strictEqual(state.pair, existing);
  assert.equal(state.closes, 1);
});

test('createDeviceKey explains unsupported Ed25519', async (t) => {
  const state = fakeKeyDatabase(t);
  replaceGlobal(t, 'crypto', { subtle: { generateKey: async () => {
    throw new DOMException('Unrecognized algorithm name', 'NotSupportedError');
  } } });
  await assert.rejects(createDeviceKey(), {
    name: 'Error', message: 'contributions: this browser does not support Ed25519 device keys',
  });
  assert.equal(state.pair, undefined);
  assert.equal(state.closes, 1);
});

test('createDeviceKey preserves other generation errors', async (t) => {
  fakeKeyDatabase(t);
  const denied = new DOMException('Denied', 'SecurityError');
  replaceGlobal(t, 'crypto', { subtle: { generateKey: async () => { throw denied; } } });
  await assert.rejects(createDeviceKey(), (error) => error === denied);
});

test('a new device key remains non-extractable and loads as the same signer', async (t) => {
  const state = fakeKeyDatabase(t);
  assert.equal(await loadDeviceKey(), null);
  const signer = await createDeviceKey();
  assert.equal(state.pair?.privateKey.extractable, false);
  const loaded = await loadDeviceKey();
  assert.equal(loaded?.publicKey, signer.publicKey);
  assert.equal(Keypair.fromPublicKey(signer.publicKey).verify(
    Buffer.from(PRF_OUTPUT), Buffer.from(await loaded.sign(PRF_OUTPUT)),
  ), true);
});

test('passkey operations explain missing secure randomness before requesting credentials', async (t) => {
  for (const [name, cryptoApi] of [
    ['missing crypto', undefined],
    ['missing getRandomValues', {}],
    ['invalid getRandomValues', { getRandomValues: true }],
  ] as const) {
    await t.test(name, async (t) => {
      replaceGlobal(t, 'crypto', cryptoApi);
      replaceGlobal(t, 'navigator', { credentials: {
        create: async () => { assert.fail('Cannot create credentials without secure randomness'); },
        get: async () => { assert.fail('Cannot request credentials without secure randomness'); },
      } });
      const expected = { message: 'Web Crypto (crypto.getRandomValues) is unavailable.' };
      await assert.rejects(createPasskey({ rpId: 'vespi.xyz', userName: 'participant' }), expected);
      await assert.rejects(unlockPasskey({ rpId: 'vespi.xyz', credentialId: 'AQID' }), expected);
    });
  }
});
