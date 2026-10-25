'use strict';

// Inspect data descriptors rather than invoking caller getters. Proxies remain host code.
function dataFields(value, keys, array = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value) !== array) throw new TypeError('invalid context shape');
  const proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new TypeError('invalid context prototype');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const own = Reflect.ownKeys(descriptors);
  if (array) {
    const length = descriptors.length;
    if (!length || !Object.hasOwn(length, 'value') || !Number.isSafeInteger(length.value) || length.value < 1 || own.length !== length.value + 1) throw new TypeError('invalid context sources');
    keys = ['length'];
    for (let i = 0; i < length.value; i += 1) keys.push(String(i));
  }
  if (own.length !== keys.length || own.some((key) => typeof key !== 'string' || !keys.includes(key))) throw new TypeError('invalid context fields');
  const out = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('context accessors are forbidden');
    out[key] = descriptor.value;
  }
  return out;
}

function text(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError('invalid context text');
  return value;
}

function snapshotContext(value) {
  try {
    const fields = dataFields(value, ['manifestDigest', 'scope', 'sources']);
    if (typeof fields.manifestDigest !== 'string' || !/^[a-fA-F0-9]{64}$/.test(fields.manifestDigest)) throw new TypeError();
    const entries = dataFields(fields.sources, null, true);
    const sources = [];
    for (let i = 0; i < entries.length; i += 1) {
      const source = dataFields(entries[i], ['ref', 'owner', 'revision', 'state']);
      if (source.state !== 'approved') throw new TypeError();
      sources.push(Object.freeze({ ref: text(source.ref), owner: text(source.owner), revision: text(source.revision), state: 'approved' }));
    }
    return Object.freeze({ manifestDigest: fields.manifestDigest, scope: text(fields.scope), sources: Object.freeze(sources) });
  } catch {
    throw new TypeError('context must be an inert approved manifest');
  }
}

function readContextProperty(options) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(options, 'context');
    if (!descriptor) {
      if ('context' in options) throw new TypeError();
      return undefined;
    }
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError();
    return snapshotContext(descriptor.value);
  } catch {
    throw new TypeError('context must be an own inert approved manifest');
  }
}

module.exports = { snapshotContext, readContextProperty, dataFields };
