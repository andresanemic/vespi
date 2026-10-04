'use strict';
// The ZK verification port: it answers one question and refuses to answer the neighbours.
//
//   "Does this proof satisfy the mathematical relation of the circuit fixed by this verification
//    key, for exactly these public inputs?"
//
// It does not answer "who presented it", "did an institution say so" or "is this fresh". Those four
// stay false in `checks` forever, on purpose, because a Groth16 verification grants none of them
// (design: sections 2, 4 and 6). What the port adds on top of a raw pairing check is provenance and
// binding: the key is pinned by digest, the expected public inputs come from the agreement and not
// from the request, and every answer says which public artifacts describe the result.
//
// The crypto itself is injected. This module never performs a pairing: `backendDigest` names the
// implementation expected for the audit record, and the host is the one who must guarantee that the
// function it injects is those bytes. JavaScript does not certify code with a label, and this port
// does not pretend otherwise.

const { createHash } = require('node:crypto');

const VK_SCHEMA = 'vespi-groth16-bn254-v1';
const EVIDENCE_SCHEMA = 'vespi-zk-evidence-v1';
const VK_DIGEST_DOMAIN = 'vespi.zk.vk.v1';
const PROOF_DIGEST_DOMAIN = 'vespi.zk.proof.v1';

// The BN254 profile this port pins. Groth16 is defined over several curves; these two numbers say
// which one, and every range check below follows from them. BN254 does not offer 128-bit security
// (Barbulescu-Duquesne 2017, and CAP-0074 says the same), which is a property of the curve, not of
// this code, and it is why the acceptance of this profile is a decision left open.
const FP_MODULUS = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n;
const SCALAR_MODULUS = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;

const MAX_SCALAR_DIGITS = 78;
const DEFAULT_MAX_PUBLIC_INPUTS = 32;
const MAX_PUBLIC_INPUTS_CEILING = 32;

const CONFIG_ERROR = 'zk verifier configuration is invalid';

const DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

const VK_KEYS = ['schema', 'nPublic', 'alpha', 'beta', 'gamma', 'delta', 'ic'];
const PROOF_KEYS = ['a', 'b', 'c'];
const REQUEST_KEYS = ['proof', 'publicInputs'];
const CONFIG_KEYS = ['verificationKey', 'expectedVkDigest', 'circuitDigest', 'expectedPublicInputs', 'backend', 'backendDigest', 'maxPublicInputs'];
const EVIDENCE_KEYS = ['schema', 'system', 'curve', 'circuitDigest', 'vkDigest', 'backendDigest', 'proofDigest', 'publicInputs', 'result', 'code'];

const CHECK_KEYS = [
  'zk.verification-key-pinned',
  'zk.public-inputs-bound',
  'zk.proof-valid',
  'zk.presenter-authentication',
  'zk.institutional-attestation',
  'zk.replay-prevention',
  'zk.transport-privacy',
];
const COVERED_CHECKS = new Set(CHECK_KEYS.slice(0, 3));
const LIMIT_CHECKS = CHECK_KEYS.slice(3);

// One fixed reason per outcome. Nothing from the request, the backend or an exception reaches it.
const REASONS = {
  ok: 'groth16 proof verified against the pinned verification key',
  malformed_input: 'zk request is not the exact expected json shape',
  public_inputs_mismatch: 'zk public inputs differ from the inputs the agreement fixed',
  invalid_proof: 'zk backend did not verify the proof',
  backend_unavailable: 'no zk backend was injected into this verifier',
  backend_error: 'zk backend failed to answer with a strict boolean',
};

// --- strict reading of plain JSON data ---

// A plain data object: object or null prototype, no own symbols, no accessors, exactly `keys`.
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  return true;
}

function hasExactKeys(value, keys) {
  const own = Object.keys(value);
  if (own.length !== keys.length) return false;
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(value, key)) return false;
  return true;
}

function isAccessor(container, key) {
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  if (descriptor === undefined) return false;
  if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') return true;
  return !('value' in descriptor);
}

// Reading a data property from something that may be a proxy. Accessors and symbols are already
// rejected by shape; this is the second gate, for the case where a proxy answers a question the
// shape gate asked about something else.
function readData(container, key) {
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  if (descriptor === undefined) return undefined;
  if (typeof descriptor.get === 'function' || typeof descriptor.set === 'function') {
    throw new TypeError('accessor');
  }
  return descriptor.value;
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== value.length) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (keys[i] !== String(i)) return false;
    // A getter on an array index is a hole in disguise.
    if (isAccessor(value, String(i))) return false;
  }
  return true;
}

// A canonical decimal field element or scalar: a string, no sign, no padding, no exponent, no hex,
// no whitespace, not longer than 78 digits. Numbers and BigInts are refused on purpose: the shapes
// in this module are JSON, and a value that only survives a JavaScript coercion is not one.
function readScalar(value) {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_SCALAR_DIGITS) return null;
  if (!DECIMAL_PATTERN.test(value)) return null;
  return value;
}

function scalarInRange(value, modulus) {
  const scalar = readScalar(value);
  if (scalar === null) return null;
  const asBigInt = BigInt(scalar);
  if (asBigInt >= modulus) return null;
  return scalar;
}

function readG1(value) {
  if (!isDenseArray(value) || value.length !== 2) return null;
  const x = scalarInRange(value[0], FP_MODULUS);
  const y = scalarInRange(value[1], FP_MODULUS);
  if (x === null || y === null) return null;
  return [x, y];
}

function readFp2(value) {
  if (!isDenseArray(value) || value.length !== 2) return null;
  const c0 = scalarInRange(value[0], FP_MODULUS);
  const c1 = scalarInRange(value[1], FP_MODULUS);
  if (c0 === null || c1 === null) return null;
  return [c0, c1];
}

function readG2(value) {
  if (!isDenseArray(value) || value.length !== 2) return null;
  const x = readFp2(value[0]);
  const y = readFp2(value[1]);
  if (x === null || y === null) return null;
  return [x, y];
}

// Reading the request. A proxy that throws is a malformed request, never a crash: the caller gets
// the same fixed answer it gets for an empty object.
function readRequest(value) {
  try {
    if (!isPlainObject(value) || !hasExactKeys(value, REQUEST_KEYS)) return null;
    if (isAccessor(value, 'proof') || isAccessor(value, 'publicInputs')) return null;
    const proof = readProof(readData(value, 'proof'));
    const publicInputs = readPublicInputs(readData(value, 'publicInputs'), MAX_PUBLIC_INPUTS_CEILING);
    if (proof === null || publicInputs === null) return null;
    return { proof, publicInputs };
  } catch {
    return null;
  }
}

function readProof(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, PROOF_KEYS)) return null;
  if (isAccessor(value, 'a') || isAccessor(value, 'b') || isAccessor(value, 'c')) return null;
  const a = readG1(readData(value, 'a'));
  const b = readG2(readData(value, 'b'));
  const c = readG1(readData(value, 'c'));
  if (a === null || b === null || c === null) return null;
  return { a, b, c };
}

function readPublicInputs(value, ceiling) {
  if (!isDenseArray(value) || value.length > ceiling) return null;
  const out = [];
  for (let i = 0; i < value.length; i += 1) {
    const scalar = scalarInRange(value[i], SCALAR_MODULUS);
    if (scalar === null) return null;
    out.push(scalar);
  }
  return out;
}

function readVerificationKey(value, ceiling) {
  try {
    if (!isPlainObject(value) || !hasExactKeys(value, VK_KEYS)) return null;
    for (const key of VK_KEYS) if (isAccessor(value, key)) return null;
    if (readData(value, 'schema') !== VK_SCHEMA) return null;
    const nPublic = readData(value, 'nPublic');
    if (typeof nPublic !== 'number' || !Number.isInteger(nPublic) || nPublic < 0 || nPublic > ceiling) return null;
    const alpha = readG1(readData(value, 'alpha'));
    const beta = readG2(readData(value, 'beta'));
    const gamma = readG2(readData(value, 'gamma'));
    const delta = readG2(readData(value, 'delta'));
    const icRaw = readData(value, 'ic');
    if (alpha === null || beta === null || gamma === null || delta === null) return null;
    if (!isDenseArray(icRaw) || icRaw.length !== nPublic + 1) return null;
    const ic = [];
    for (let i = 0; i < icRaw.length; i += 1) {
      const point = readG1(icRaw[i]);
      if (point === null) return null;
      ic.push(point);
    }
    return { schema: VK_SCHEMA, nPublic, alpha, beta, gamma, delta, ic };
  } catch {
    return null;
  }
}

// --- digests ---

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function digestOf(domain, value) {
  const canonical = JSON.stringify(canonicalize(value));
  return createHash('sha256').update(`${domain}\n${canonical}`, 'utf8').digest('hex');
}

// The identity of a verification key for pinning and for the audit record. Only structures that
// already passed the strict reader get here: a digest over something half-read would be a digest of
// the wrong thing.
function digestZkVerificationKey(verificationKey) {
  const read = readVerificationKey(verificationKey, MAX_PUBLIC_INPUTS_CEILING);
  if (read === null) throw new TypeError(CONFIG_ERROR);
  return digestOf(VK_DIGEST_DOMAIN, read);
}

function digestOfProof(proof) {
  return digestOf(PROOF_DIGEST_DOMAIN, proof);
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sameList(left, right) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  return true;
}

// --- configuration ---

function readDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value) ? value : null;
}

function readConfig(raw) {
  try {
    if (!isPlainObject(raw) || !hasExactKeysAny(raw, CONFIG_KEYS)) return null;
    if (isAccessor(raw, 'backend')) return null;
    const maxPublicInputs = raw.maxPublicInputs === undefined
      ? DEFAULT_MAX_PUBLIC_INPUTS
      : raw.maxPublicInputs;
    if (typeof maxPublicInputs !== 'number' || !Number.isInteger(maxPublicInputs)
      || maxPublicInputs < 1 || maxPublicInputs > MAX_PUBLIC_INPUTS_CEILING) return null;

    const verificationKey = readVerificationKey(readData(raw, 'verificationKey'), maxPublicInputs);
    if (verificationKey === null) return null;
    if (verificationKey.nPublic > maxPublicInputs) return null;

    const expectedVkDigest = readDigest(readData(raw, 'expectedVkDigest'));
    const circuitDigest = readDigest(readData(raw, 'circuitDigest'));
    const backendDigest = readDigest(readData(raw, 'backendDigest'));
    if (expectedVkDigest === null || circuitDigest === null || backendDigest === null) return null;

    // The pin is checked here, against the key that will actually be used, not against whatever
    // the caller computed somewhere else.
    if (digestOf(VK_DIGEST_DOMAIN, verificationKey) !== expectedVkDigest) return null;

    const expectedRaw = readData(raw, 'expectedPublicInputs');
    if (!isDenseArray(expectedRaw) || expectedRaw.length !== verificationKey.nPublic) return null;
    const expectedPublicInputs = [];
    for (let i = 0; i < expectedRaw.length; i += 1) {
      const scalar = scalarInRange(expectedRaw[i], SCALAR_MODULUS);
      if (scalar === null) return null;
      expectedPublicInputs.push(scalar);
    }

    const backendRaw = readData(raw, 'backend');
    const backend = backendRaw === undefined ? null : backendRaw;
    if (backend !== null && typeof backend !== 'function') return null;

    return {
      verificationKey: deepFreeze(verificationKey),
      expectedVkDigest,
      circuitDigest,
      expectedPublicInputs: deepFreeze(expectedPublicInputs),
      backend,
      backendDigest,
      maxPublicInputs,
    };
  } catch {
    return null;
  }
}

function hasExactKeysAny(value, allowed) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) return false;
  return true;
}

function readConfigChecked(raw) {
  const read = readConfig(raw);
  if (read === null) throw new TypeError(CONFIG_ERROR);
  return read;
}

// --- the verifier ---

function allFalse() {
  const checks = {};
  for (const key of CHECK_KEYS) checks[key] = false;
  return checks;
}

function checksWith(covered) {
  const checks = {};
  for (const key of CHECK_KEYS) checks[key] = COVERED_CHECKS.has(key) && covered.includes(key);
  return checks;
}

function answer(config, { verified, checks, result, code, proofDigest }) {
  return {
    verified,
    checks,
    reason: REASONS[code],
    zk: {
      schema: EVIDENCE_SCHEMA,
      system: 'groth16',
      curve: 'bn254',
      circuitDigest: config.circuitDigest,
      vkDigest: config.expectedVkDigest,
      backendDigest: config.backendDigest,
      proofDigest: proofDigest === undefined ? null : proofDigest,
      publicInputs: [...config.expectedPublicInputs],
      result,
      code,
    },
  };
}

// An invalid configuration never becomes a verifier: a caller cannot ask a question of a key it was
// not given. `digestZkVerificationKey` stays available on its own so a caller can compute the pin
// before building, which is the intended order.
function createZkVerifier(rawConfig) {
  const config = readConfigChecked(rawConfig);

  return async function verifyZkProof(request) {
    // 1. The request is plain JSON data or it is nothing. Coordinates and signals are range checked
    //    here, before the backend, so an out-of-field point never reaches the crypto.
    const read = readRequest(request);
    if (read === null) {
      return answer(config, { verified: false, checks: allFalse(), result: 'invalid', code: 'malformed_input', proofDigest: null });
    }
    if (read.publicInputs.length !== config.verificationKey.nPublic) {
      return answer(config, { verified: false, checks: allFalse(), result: 'invalid', code: 'malformed_input', proofDigest: null });
    }
    const proofDigest = digestOfProof(read.proof);

    // 2. The pin is recomputed from the frozen key that is about to be used. It is a check that
    //    runs, not one that is assumed.
    const pinned = digestOf(VK_DIGEST_DOMAIN, config.verificationKey) === config.expectedVkDigest;

    // 3. The public inputs are compared with the ones the agreement fixed. A mismatch never reaches
    //    the backend: there is nothing to verify against this circuit.
    const bound = sameList(read.publicInputs, config.expectedPublicInputs);
    if (!pinned || !bound) {
      return answer(config, {
        verified: false,
        checks: checksWith([...(pinned ? ['zk.verification-key-pinned'] : []), ...(bound ? ['zk.public-inputs-bound'] : [])]),
        result: 'invalid',
        code: 'public_inputs_mismatch',
        proofDigest,
      });
    }

    // 4. No backend means no answer about the proof. Two checks ran; the third did not, so it is not
    //    credited.
    if (config.backend === null) {
      return answer(config, {
        verified: false,
        checks: checksWith(['zk.verification-key-pinned', 'zk.public-inputs-bound']),
        result: 'unavailable',
        code: 'backend_unavailable',
        proofDigest,
      });
    }

    // 5. The backend sees a frozen copy, so nothing it does can move the proof or the inputs
    //    between the digest above and the answer below.
    const snapshot = deepFreeze({
      verificationKey: deepClone(config.verificationKey),
      proof: deepClone(read.proof),
      publicInputs: [...read.publicInputs],
    });
    let verdict;
    try {
      verdict = await config.backend(snapshot);
    } catch {
      return answer(config, {
        verified: false,
        checks: checksWith(['zk.verification-key-pinned', 'zk.public-inputs-bound']),
        result: 'error',
        code: 'backend_error',
        proofDigest,
      });
    }
    if (verdict !== true) {
      const isStrictFalse = verdict === false;
      return answer(config, {
        verified: false,
        checks: checksWith(['zk.verification-key-pinned', 'zk.public-inputs-bound']),
        result: isStrictFalse ? 'invalid' : 'error',
        code: isStrictFalse ? 'invalid_proof' : 'backend_error',
        proofDigest,
      });
    }
    return answer(config, {
      verified: true,
      checks: checksWith(['zk.verification-key-pinned', 'zk.public-inputs-bound', 'zk.proof-valid']),
      result: 'verified',
      code: 'ok',
      proofDigest,
    });
  };
}

module.exports = {
  createZkVerifier,
  digestZkVerificationKey,
  VK_SCHEMA,
  EVIDENCE_SCHEMA,
  COVERED_CHECKS,
  LIMIT_CHECKS,
  FP_MODULUS,
  SCALAR_MODULUS,
};
