import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceEndpoint } from './capability.js';

test('sets the service query without corrupting existing parameters', () => {
  const result = new URL(serviceEndpoint('https://example.test/api?a=b=c'));
  assert.equal(result.searchParams.get('a'), 'b=c');
  assert.equal(result.searchParams.get('service'), 'marketing-plan');
});
