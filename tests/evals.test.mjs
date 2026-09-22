import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { summarize } from '../evals/summarize.mjs';
const fixtures = JSON.parse(await fs.readFile(new URL('../evals/attempts.example.json', import.meta.url), 'utf8'));
test('evaluation math keeps failure denominators, raw outcomes and verification distinct', () => {
  const [result] = summarize(fixtures);
  assert.equal(result.completedWorkMean, 80);
  assert.equal(result.reliabilityAdjustedMean, 40);
  assert.equal(result.strictVerifiedDeliveryMean, 40);
  assert.equal(result.reliabilityPercent, 50);
  assert.equal(result.raw.length, 2);
  const changed = structuredClone(fixtures);
  changed[0].verification = 'failed';
  assert.equal(summarize(changed)[0].strictVerifiedDeliveryMean, 0);
  assert.equal(summarize(changed)[0].completedWorkMean, 80);
});
test('unknown completed scores are not imputed and preflight refusals remain visible', () => {
  const rows = structuredClone(fixtures);
  rows[0].score = null;
  assert.equal(summarize(rows)[0].completedWorkMean, null);
  assert.equal(summarize(rows)[0].reliabilityAdjustedMean, null);
  rows[1].delivery = 'not-started';
  assert.equal(summarize(rows)[0].notStarted, 1);
  assert.equal(summarize(rows)[0].attempts, 1);
});
test('assistance stays separate and invalid or duplicate rows fail loudly', () => {
  const assisted = { ...fixtures[0], attemptId: 'fixture-assisted', mode: 'assisted', parentAttemptId: 'fixture-02' };
  assert.equal(summarize([...fixtures, assisted]).length, 2);
  assert.throws(() => summarize([...fixtures, fixtures[0]]), /duplicate/);
  assert.throws(() => summarize([{ ...fixtures[1], score: 40 }]), /Scores require/);
  assert.throws(() => summarize([{ ...fixtures[0], score: NaN }]), /Scores/);
  assert.throws(() => summarize([{ ...assisted, parentAttemptId: 'missing' }]), /parent/);
});
