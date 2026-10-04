'use strict';
// Loads the public Groth16/BN254 fixture of the Stellar soroban-examples repository and converts it
// into the kernel's internal JSON shapes. This adapter lives in the tests on purpose: the strict
// verifier in src/zk.js never parses a gnark file, and the only thing that may do it is code a
// reviewer can read next to the manifest.
//
// Source: stellar/soroban-examples @ 01a9a33dfd4078ea507d6c606906a88370186a6b
//   groth16_verifier/contracts/bn254_verifier/tests/data/gnark/{proof,verification_key}.json
//   License: Apache-2.0. See ./MANIFEST.json for the recorded hashes and expected results.
//
// Conversion, fixed by the fixture's own convention (measured, not assumed):
//   - G1 entries are [x, y, z] with z === '1'; the z coordinate is dropped.
//   - G2 entries are [[x.c0, x.c1], [y.c0, y.c1], [z.c0, z.c1]] with z === ['1', '0']; the third row
//     is dropped. This fixture stores Fp2 as [c0, c1] (real part first), which is the same order the
//     kernel uses internally. A Soroban adapter would emit the components the other way round, so
//     swapping them here must break the fixture, and a test says so.
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'zk');

function sha256OfFile(name) {
  return createHash('sha256').update(readFileSync(join(FIXTURE_DIR, name))).digest('hex');
}

function readJson(name) {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8'));
}

const manifest = readJson('MANIFEST.json');
const proofFile = readJson('proof.json');
const vkFile = readJson('verification_key.json');

// `vk_alphabeta_12` is a cached pairing result, not a set of fixed points (design 4): never read it.
const g1 = (entry, what) => {
  if (!Array.isArray(entry) || entry.length !== 3) throw new Error(`${what}: expected [x, y, z]`);
  if (entry[2] !== '1') throw new Error(`${what}: expected z === '1'`);
  return [entry[0], entry[1]];
};
const g2 = (entry, what) => {
  if (!Array.isArray(entry) || entry.length !== 3) throw new Error(`${what}: expected three rows`);
  const z = entry[2];
  if (!Array.isArray(z) || z.length !== 2 || z[0] !== '1' || z[1] !== '0') {
    throw new Error(`${what}: expected z === ['1','0']`);
  }
  return [entry[0], entry[1]];
};
const swapFp2 = (point) => [[point[0][1], point[0][0]], [point[1][1], point[1][0]]];

function verificationKey() {
  if (vkFile.protocol !== 'groth16') throw new Error('fixture protocol is not groth16');
  if (vkFile.curve !== 'bn254') throw new Error('fixture curve is not bn254');
  return {
    schema: 'vespi-groth16-bn254-v1',
    nPublic: vkFile.nPublic,
    alpha: g1(vkFile.vk_alpha_1, 'vk_alpha_1'),
    beta: g2(vkFile.vk_beta_2, 'vk_beta_2'),
    gamma: g2(vkFile.vk_gamma_2, 'vk_gamma_2'),
    delta: g2(vkFile.vk_delta_2, 'vk_delta_2'),
    ic: vkFile.IC.map((entry, i) => g1(entry, `IC[${i}]`)),
  };
}

function proof() {
  if (proofFile.protocol !== 'groth16') throw new Error('fixture protocol is not groth16');
  if (proofFile.curve !== 'bn254') throw new Error('fixture curve is not bn254');
  return {
    a: g1(proofFile.pi_a, 'pi_a'),
    b: g2(proofFile.pi_b, 'pi_b'),
    c: g1(proofFile.pi_c, 'pi_c'),
  };
}

// A structural clone, so a test that mutates a fixture copy cannot reach the shared object.
const clone = (value) => JSON.parse(JSON.stringify(value));

module.exports = {
  FIXTURE_DIR,
  manifest,
  sha256OfFile,
  verificationKey: () => clone(verificationKey()),
  proof: () => clone(proof()),
  publicInputs: () => clone(proofFile.publicSignals),
  nPublic: () => vkFile.nPublic,
  // The same points with the two Fp2 components exchanged: what a wrong adapter would emit.
  swapG2: (vk) => ({
    ...vk,
    beta: swapFp2(vk.beta),
    gamma: swapFp2(vk.gamma),
    delta: swapFp2(vk.delta),
  }),
};
