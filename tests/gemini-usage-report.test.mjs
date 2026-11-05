import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiUsageReport } from '../src/gemini-usage-report.mjs';

const native =
  'Gemini Models\tWeekly Limit Remaining\t100%\t2026-11-05T22:52:13Z\nGemini Models\tFive Hour Limit Remaining\t100%\t2026-11-05T08:09:23Z\nClaude and GPT models\tWeekly Limit Remaining\t100%\t2026-11-12T03:09:23Z\nClaude and GPT models\tFive Hour Limit Remaining\t100%\t2026-11-05T08:09:23Z\nGemini 4 Argon\tGemini 4 Argon Weekly Limit\t100%\t2026-11-12T03:09:23Z\n';
test('live-captured TSV preserves group windows and ambiguous percentage direction', () => {
  const value = parseGeminiUsageReport(native, { observedAt: '2026-11-05T03:09:16Z' });
  assert.equal(value.status, 'observed');
  assert.equal(value.buckets.length, 5);
  assert.equal(value.buckets[0].usedPercent, 0);
  assert.equal(value.buckets[0].remainingPercent, 100);
  assert.equal(value.buckets[1].windowDurationMins, 300);
  assert.equal(value.buckets[4].usedPercent, null);
  assert.equal(value.buckets[4].reportedPercent, 100);
  assert.equal(value.coverage, 'partial');
  assert.equal(value.perRunAttribution, false);
});
test('unknown versions, grammar, percentages and conflicting duplicates fail unavailable', () => {
  assert.equal(parseGeminiUsageReport(native, { clientVersion: '1.5.1' }).status, 'unavailable');
  for (const text of [
    'hello model answer',
    native.replace('100%', '101%'),
    native.replace('Gemini Models', 'Other Models'),
    native + native.split('\n')[0].replace('100%', '50%') + '\n',
  ])
    assert.equal(parseGeminiUsageReport(text).status, 'unavailable');
});
