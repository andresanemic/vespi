'use strict';

// CodeQL `js/incomplete-url-substring-sanitization` (alert #3 of this repository) fired on a test
// that asserted `!reason.includes(<url>)`. A substring check on a URL is the wrong tool even in a
// test: it says "this exact string is absent", not "this host is absent". This test keeps the
// pattern out of `src/` and `test/` so the alert cannot come back: assert on the parsed host or
// with an anchored regular expression instead.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const METHODS = '(?:includes|startsWith|endsWith|indexOf)';
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return entry.name.endsWith('.js') || entry.name.endsWith('.mjs') ? [full] : [];
  });
}

test('no substring check is made against a URL in src/ or test/', () => {
  const root = path.join(__dirname, '..');
  const self = path.basename(__filename);
  const offenders = [];
  for (const file of [...files(path.join(root, 'src')), ...files(path.join(root, 'test'))]) {
    if (path.basename(file) === self) continue;
    const text = fs.readFileSync(file, 'utf8');
    // A name counts as a URL only while its most recent declaration above the line is a URL
    // literal: `planted` is a URL in one test and something else in the next, and only the
    // first is the pattern CodeQL flags.
    const isUrl = new Map();
    const direct = new RegExp(`\\.${METHODS}\\(\\s*['"\`]https?:\\/\\/`);
    text.split('\n').forEach((line, i) => {
      const declaration = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`]https?:\/\/)?/.exec(line);
      if (declaration) isUrl.set(declaration[1], Boolean(declaration[2]));
      const viaName = [...isUrl].some(([name, url]) => url && new RegExp(`\\.${METHODS}\\(\\s*${escapeRegExp(name)}\\s*[),]`).test(line));
      if (direct.test(line) || viaName) offenders.push(`${path.relative(root, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, [], 'URL substring checks found; parse the host or use an anchored regular expression');
});

test('the check does catch the pattern CodeQL flagged', () => {
  const sample = "const planted = 'https://attacker.test/x';\nassert.ok(!reason.includes(planted));";
  const names = [...sample.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"`]https?:\/\//g)].map((m) => m[1]);
  assert.deepEqual(names, ['planted']);
  assert.ok(new RegExp(`\\.${METHODS}\\(\\s*${escapeRegExp(names[0])}\\s*[),]`).test(sample));
});
