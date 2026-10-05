'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const childSource = String.raw`
const { createDelegation } = require('./src/delegation.js');
const mode = process.argv[1];
let now;
if (mode === 'rejected-promise') now = () => Promise.reject(new Error('clock unavailable'));
if (mode === 'resolved-promise') now = () => Promise.resolve(1000);
if (mode === 'thenable') now = () => ({ then(resolve) { resolve(1000); } });
if (mode === 'hostile-then') now = () => Object.defineProperty({}, 'then', {
  get() { throw new Error('hostile then getter'); },
});
let error;
try {
  createDelegation({
    task: 'clock contract', medium: {}, delegate: 'worker', orchestrator: 'vespi',
    deadlineMs: 1000, now,
  });
} catch (caught) {
  error = caught;
}
if (!(error instanceof Error) || !/reloj inyectado no comprobable/i.test(error.message)) {
  console.error('expected synchronous invalid injected clock error; received:', error?.message || 'no error');
  process.exitCode = 42;
}
`;

test('H6: createDelegation rechaza clocks asíncronos y thenables sin dejar rechazos sueltos', () => {
  for (const mode of ['rejected-promise', 'resolved-promise', 'thenable', 'hostile-then']) {
    const result = spawnSync(process.execPath, ['-e', childSource, mode], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(
      result.status,
      0,
      `${mode}: child must synchronously reject the injected clock and exit cleanly; ` +
        `status=${result.status}, signal=${result.signal}, stderr=${result.stderr}`,
    );
  }
});
