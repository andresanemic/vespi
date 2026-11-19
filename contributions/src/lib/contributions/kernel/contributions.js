// Kernel commit 005d7b8 (vespi kernel repo).
// Source: src/contributions.js
// Do not edit: change the source and re-copy.
'use strict';

const { canonicalize, computeDigest } = require('./receipt.js');
const { createHash } = require('node:crypto');
const { isProxy } = require('node:util').types;

const CONTRIBUTION_VERSION = 1;
const INDEX_VERSION = 1;
const KINDS = Object.freeze(['REQUEST', 'CONTRIBUTE', 'ACCEPT', 'ATTEST', 'SURVEY', 'REPORT']);
const ROLE_BY_KIND = Object.freeze({
  REQUEST: 'requester', CONTRIBUTE: 'contributor', ACCEPT: 'requester',
  ATTEST: 'observer', SURVEY: 'respondent', REPORT: 'organizer',
});
const FIELDS = [
  'version', 'chain', 'kind', 'role', 'actor', 'statement', 'comment', 'subject', 'prev', 'evidence', 'createdAt',
];

function requireValid(condition, message) {
  if (!condition) throw new Error(`contribution: ${message}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHex64(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

// Every value that enters the evidence or a survey answer must reach the canonical bytes unchanged:
// anything canonicalize or JSON.stringify would drop, rename or collapse is refused here instead.
function copyEvidence(value, ancestors = new Set()) {
  if (value === null || typeof value !== 'object') {
    requireValid(value === null || ['string', 'boolean'].includes(typeof value)
      || (typeof value === 'number' && Number.isFinite(value)), 'evidence must contain only data');
    return value;
  }
  requireValid(!isProxy(value), 'evidence must not contain proxies');
  requireValid(!ancestors.has(value), 'evidence must not contain cycles');
  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  requireValid(isArray ? prototype === Array.prototype : prototype === Object.prototype || prototype === null,
    'evidence must contain only plain objects and arrays');
  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = isArray ? descriptors.length.value : 0;
  const copy = isArray ? new Array(length) : Object.create(null);
  let indices = 0;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (isArray && key === 'length') continue;
    requireValid(typeof key !== 'symbol', 'evidence must not contain symbol keys');
    const descriptor = descriptors[key];
    requireValid(Object.hasOwn(descriptor, 'value'), 'evidence must not contain accessors');
    requireValid(descriptor.enumerable, 'evidence must not contain non-enumerable properties');
    if (isArray) {
      requireValid(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < length, 'evidence arrays must contain only indices');
      indices += 1;
    }
    Object.defineProperty(copy, key, {
      value: copyEvidence(descriptor.value, ancestors), enumerable: true,
    });
  }
  requireValid(indices === length, 'evidence arrays must not contain holes');
  ancestors.delete(value);
  return Object.freeze(copy);
}

// Reads only own enumerable data properties named in `allowed`: no proxy traps, no getters, no
// inherited values. Anything else is refused rather than silently left out.
function ownFields(fields, allowed, prefix) {
  requireValid(isObject(fields), `${prefix}fields must be an object`);
  requireValid(!isProxy(fields), `${prefix}fields must not be a proxy`);
  const descriptors = Object.getOwnPropertyDescriptors(fields);
  const out = Object.create(null);
  for (const key of Reflect.ownKeys(descriptors)) {
    requireValid(typeof key === 'string' && allowed.includes(key), `unexpected ${prefix}field`);
    const descriptor = descriptors[key];
    requireValid(Object.hasOwn(descriptor, 'value') && descriptor.enumerable, `${prefix}fields must be data`);
    out[key] = descriptor.value;
  }
  return out;
}

const FORMAT_CHARACTERS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;

function hasExactly(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function validReferenceEvidence(evidence) {
  return evidence === null || (hasExactly(evidence, ['uri', 'sha256'])
    && typeof evidence.uri === 'string' && /^https:\/\//.test(evidence.uri) && isHex64(evidence.sha256));
}

function validSurveyEvidence(evidence) {
  return hasExactly(evidence, ['commitment']) && isHex64(evidence.commitment);
}

function validReportEvidence(evidence) {
  return hasExactly(evidence, ['surveys', 'commitments', 'counts', 'aggregate'])
    && ['surveys', 'commitments'].every(key => Array.isArray(evidence[key])
      && Array.from(evidence[key]).every(isHex64)
      && new Set(evidence[key]).size === evidence[key].length)
    && hasExactly(evidence.counts, ['withAccount', 'withoutAccount', 'fallbackForm'])
    && Object.values(evidence.counts).every(value => Number.isInteger(value) && value >= 0)
    && evidence.counts.withAccount === evidence.surveys.length
    && evidence.commitments.length === evidence.counts.withAccount
      + evidence.counts.withoutAccount + evidence.counts.fallbackForm
    && isObject(evidence.aggregate)
    && Object.values(evidence.aggregate).every(value => typeof value === 'string'
      || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)));
}

function surveyCommitment(saltHex, answer) {
  requireValid(typeof saltHex === 'string' && /^[0-9a-f]{32,}$/.test(saltHex)
    && saltHex.length % 2 === 0 && saltHex.trim() === saltHex, 'invalid survey salt');
  const data = copyEvidence(answer);
  requireValid(isObject(data), 'answer must be an object');
  return createHash('sha256').update(Buffer.from(saltHex, 'hex'))
    .update(JSON.stringify(canonicalize(data)), 'utf8').digest('hex');
}

const INDEX_FIELDS = ['version', 'digest', 'network', 'txHash', 'ledger', 'envelopeXdr', 'rehearsal'];

function buildIndexEntry(fields) {
  const own = ownFields(fields, INDEX_FIELDS, 'index ');
  requireValid(!Object.hasOwn(own, 'version') || own.version === INDEX_VERSION, 'index version must be 1');
  for (const key of INDEX_FIELDS) {
    if (key !== 'version') requireValid(Object.hasOwn(own, key), `missing index ${key}`);
  }
  const { digest, network, txHash, ledger, envelopeXdr, rehearsal } = own;
  requireValid(isHex64(digest) && isHex64(txHash), 'invalid index digest or txHash');
  requireValid(['stellar:testnet', 'stellar:pubnet'].includes(network), 'invalid index network');
  requireValid(Number.isInteger(ledger) && ledger > 0, 'index ledger must be a positive integer');
  requireValid(typeof envelopeXdr === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(envelopeXdr)
    && envelopeXdr.length % 4 === 0 && envelopeXdr.trim() === envelopeXdr, 'invalid index envelopeXdr');
  requireValid(typeof rehearsal === 'boolean', 'index rehearsal must be boolean');
  return Object.freeze({ version: INDEX_VERSION, digest, network, txHash, ledger, envelopeXdr, rehearsal });
}

function buildContribution(fields) {
  const receipt = ownFields(fields, FIELDS, '');
  for (const key of FIELDS) {
    if (key !== 'version') requireValid(Object.hasOwn(receipt, key), `missing ${key}`);
  }
  requireValid(!Object.hasOwn(receipt, 'version') || receipt.version === CONTRIBUTION_VERSION, 'version must be 1');
  receipt.version = CONTRIBUTION_VERSION;
  requireValid(KINDS.includes(receipt.kind), 'unknown kind');
  requireValid(receipt.role === ROLE_BY_KIND[receipt.kind], 'role must match kind');
  requireValid(typeof receipt.actor === 'string' && /^G[A-Z2-7]{55}$/.test(receipt.actor), 'invalid actor');
  requireValid(typeof receipt.statement === 'string' && receipt.statement.length > 0
    && receipt.statement.length <= 1000, 'statement must contain 1 to 1000 characters');
  requireValid(receipt.statement.normalize('NFC') === receipt.statement, 'statement must be NFC');
  requireValid(!FORMAT_CHARACTERS.test(receipt.statement), 'statement must not contain invisible format characters');
  requireValid(receipt.comment === null || (typeof receipt.comment === 'string' && receipt.comment.length <= 280),
    'comment must be null or at most 280 characters');
  requireValid(receipt.comment === null || receipt.comment.normalize('NFC') === receipt.comment, 'comment must be NFC');
  requireValid(receipt.comment === null || !FORMAT_CHARACTERS.test(receipt.comment),
    'comment must not contain invisible format characters');
  requireValid(typeof receipt.createdAt === 'string' && Number.isFinite(Date.parse(receipt.createdAt))
    && new Date(receipt.createdAt).toISOString() === receipt.createdAt, 'createdAt must be ISO UTC with milliseconds');

  for (const key of ['chain', 'prev', 'subject']) {
    const linked = (key === 'chain' && ['CONTRIBUTE', 'ACCEPT', 'ATTEST'].includes(receipt.kind))
      || (key === 'prev' && ['CONTRIBUTE', 'ACCEPT'].includes(receipt.kind))
      || (key === 'subject' && ['ACCEPT', 'ATTEST'].includes(receipt.kind));
    requireValid(linked ? isHex64(receipt[key]) : receipt[key] === null, `invalid ${key} for kind`);
  }
  const validateEvidence = receipt.kind === 'SURVEY' ? validSurveyEvidence
    : receipt.kind === 'REPORT' ? validReportEvidence : validReferenceEvidence;
  receipt.evidence = copyEvidence(receipt.evidence);
  requireValid(validateEvidence(receipt.evidence), 'invalid evidence for kind');
  return Object.freeze(receipt);
}

// Both go through buildContribution, so raw or invalid input throws instead of being hashed as given.
function canonicalBytes(receipt) {
  return JSON.stringify(canonicalize(buildContribution(receipt)));
}

function contributionDigest(receipt) {
  return computeDigest(buildContribution(receipt));
}

// The published form of a receipt: its bytes must be exactly its canonical bytes, so that the sha256
// of what was published is the receipt digest. Missing `version`, another key order, whitespace or
// another JSON spelling of the same value is refused.
function parseContribution(bytes) {
  requireValid(typeof bytes === 'string', 'bytes must be a string');
  let parsed;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    requireValid(false, 'bytes must be JSON');
  }
  const receipt = buildContribution(parsed);
  requireValid(canonicalBytes(receipt) === bytes, 'bytes must be canonical');
  return receipt;
}

function verifyChain(receipts) {
  requireValid(Array.isArray(receipts), 'receipts must be an array');
  let chainId = null;
  const fail = reason => ({ ok: false, reason, chainId });
  if (receipts.length === 0) return fail('empty');

  const seen = new Set();
  const contributions = new Set();
  let requester;
  let contributor;
  let previous;
  for (let i = 0; i < receipts.length; i++) {
    const receipt = buildContribution(receipts[i]);
    const digest = contributionDigest(receipt);
    if (i === 0) {
      if (receipt.kind !== 'REQUEST') return fail('first-not-request');
      chainId = digest;
      requester = receipt.actor;
    } else {
      if (seen.has(digest)) return fail('duplicate');
      if (!['CONTRIBUTE', 'ACCEPT'].includes(receipt.kind)) return fail('unexpected-kind');
      if (receipt.chain !== chainId) return fail('wrong-chain');
      if (receipt.prev !== previous) return fail('broken-prev');
      if (receipt.kind === 'CONTRIBUTE') {
        if (contributor !== undefined && receipt.actor !== contributor) return fail('contributor-changed');
        contributor = receipt.actor;
        contributions.add(digest);
      } else {
        if (i !== receipts.length - 1) return fail('accept-not-last');
        if (contributions.size === 0) return fail('unexpected-kind');
        if (receipt.actor !== requester) return fail('accept-by-non-requester');
        if (!contributions.has(receipt.subject)) return fail('accept-subject-not-in-chain');
      }
    }
    seen.add(digest);
    previous = digest;
  }
  return { ok: true, reason: null, chainId };
}

module.exports = {
  CONTRIBUTION_VERSION, KINDS, ROLE_BY_KIND, buildContribution, canonicalBytes, contributionDigest, parseContribution,
  verifyChain,
  surveyCommitment, INDEX_VERSION, buildIndexEntry,
};
