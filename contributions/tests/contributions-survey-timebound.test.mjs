import assert from 'node:assert/strict';
import { test } from 'node:test';
import { surveyMaxTime } from '../src/app/app/encuesta/timebound.ts';

test('a survey XDR uses the remaining whole seconds at the official deadline', () => {
  assert.equal(surveyMaxTime(50_250), 80);
  assert.equal(surveyMaxTime(50_250, 190_000), 80);
  assert.equal(surveyMaxTime(50_250, 51_900), 51);
  assert.equal(surveyMaxTime(51_050, 51_900), null);
  assert.equal(surveyMaxTime(51_050, null), null);
});
