import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateQuota as evaluate, usedFromRemainingFraction as used } from '../core/quota-policy.mjs';
const now = 1800000000000;
const sample = (patch = {}) => ({
  provider: 'example',
  accountId: 'a',
  workspaceId: 'w',
  poolId: 'shared',
  windowId: 'five-hour',
  cycleId: 'cycle-1',
  cycleConfirmed: true,
  availability: 'available',
  observedAtMs: now,
  resetsAtMs: now + 3600000,
  usedPercent: 49,
  ...patch,
});
const read = (s, state = {}, time = now) => evaluate(state, s, time);

for (const [before, after, expected] of [
  [49, 50, 50],
  [74, 75, 75],
  [89, 90, 90],
]) {
  test(`crossing ${before} to ${after}`, () => {
    const a = read(sample({ usedPercent: before }));
    const b = read(sample({ usedPercent: after }), a.state);
    assert.equal(b.alerts.length, 1);
    assert.equal(b.alerts[0].threshold, expected);
  });
}
test('jump emits one highest warning and covers skipped bands', () => {
  const a = read(sample());
  const b = read(sample({ usedPercent: 92 }), a.state);
  assert.equal(b.alerts.length, 1);
  assert.deepEqual(b.alerts[0].crossed, [50, 75, 90]);
  assert.equal(b.alerts[0].threshold, 90);
});
test('first connection high warns once', () => assert.equal(read(sample({ usedPercent: 92 })).alerts.length, 1));
test('persisted restart does not duplicate', () => {
  const a = read(sample({ usedPercent: 92 }));
  assert.equal(read(sample({ usedPercent: 95 }), JSON.parse(JSON.stringify(a.state))).alerts.length, 0);
});
test('oscillation does not rearm', () => {
  const a = read(sample({ usedPercent: 76 }));
  const b = read(sample({ usedPercent: 45 }), a.state);
  assert.equal(read(sample({ usedPercent: 76 }), b.state).alerts.length, 0);
});
test('fresh confirmed cycle rearms', () => {
  const a = read(sample({ usedPercent: 76 }));
  assert.equal(read(sample({ usedPercent: 76, cycleId: 'cycle-2' }), a.state).alerts.length, 1);
});
test('reset timestamp correction alone does not rearm', () => {
  const a = read(sample({ usedPercent: 76 }));
  assert.equal(read(sample({ usedPercent: 76, resetsAtMs: now + 7200000 }), a.state).alerts.length, 0);
});
test('unknown cycle does not repeatedly warn', () => {
  const s = sample({ usedPercent: 76, cycleConfirmed: false });
  const a = read(s);
  assert.equal(read(s, a.state).alerts.length, 0);
});
test('losing cycle metadata does not rearm', () => {
  const a = read(sample({ usedPercent: 76 }));
  assert.equal(read(sample({ usedPercent: 76, cycleConfirmed: false }), a.state).alerts.length, 0);
});
test('gaining cycle metadata does not duplicate same current state', () => {
  const a = read(sample({ usedPercent: 76, cycleConfirmed: false }));
  assert.equal(read(sample({ usedPercent: 76 }), a.state).alerts.length, 0);
});
test('unknown is not zero', () => {
  for (const value of [null, undefined, NaN, Infinity, -1, '90']) {
    const r = read(sample({ usedPercent: value }));
    assert.equal(r.status, 'unknown');
    assert.equal(r.alerts.length, 0);
  }
});
test('over-100 reported usage stays visible and warns', () => assert.equal(read(sample({ usedPercent: 110 })).alerts[0].usedPercent, 110));
test('stale data never warns as current', () => {
  const r = read(sample({ usedPercent: 92, observedAtMs: now - 600001 }));
  assert.equal(r.status, 'stale');
  assert.equal(r.alerts.length, 0);
});
test('passed reset requires provider refresh, never assumes zero', () =>
  assert.equal(read(sample({ resetsAtMs: now - 1, usedPercent: 90 })).status, 'refresh-required'));
test('future observation is clock skew', () => assert.equal(read(sample({ observedAtMs: now + 30001 })).status, 'clock-skew'));
test('auth loss immediately degraded despite cached high percentage', () => {
  const r = read(sample({ availability: 'signed-out', usedPercent: 90 }));
  assert.equal(r.status, 'signed-out');
  assert.equal(r.alerts.length, 0);
});
test('malformed identity rejected', () => assert.equal(read(sample({ accountId: '' })).status, 'unknown'));
test('accounts isolated', () => {
  const a = read(sample({ usedPercent: 90 }));
  assert.equal(read(sample({ usedPercent: 90, accountId: 'b' }), a.state).alerts.length, 1);
});
test('workspaces isolated', () => {
  const a = read(sample({ usedPercent: 90 }));
  assert.equal(read(sample({ usedPercent: 90, workspaceId: 'b' }), a.state).alerts.length, 1);
});
test('providers isolated for same model/pool name', () => {
  const a = read(sample({ usedPercent: 90 }));
  assert.equal(read(sample({ usedPercent: 90, provider: 'another' }), a.state).alerts.length, 1);
});
test('weekly and five-hour meters isolated', () => {
  const a = read(sample({ usedPercent: 90 }));
  assert.equal(read(sample({ usedPercent: 90, windowId: 'weekly' }), a.state).alerts.length, 1);
});
test('shared pool deduplicated across model variants', () => {
  const a = read(sample({ usedPercent: 90, model: 'model-a' }));
  assert.equal(read(sample({ usedPercent: 90, model: 'model-b' }), a.state).alerts.length, 0);
});
test('older observation cannot roll state backward', () => {
  const a = read(sample({ usedPercent: 90 }));
  const b = read(sample({ usedPercent: 10, observedAtMs: now - 1 }), a.state);
  assert.equal(b.status, 'out-of-order');
  assert.deepEqual(b.state, a.state);
});
test('remaining fraction converts to USED percentage', () => {
  assert.equal(used(0.25), 75);
  assert.equal(used(0.1), 90);
  assert.equal(used(1), 0);
  assert.equal(used(0), 100);
});
test('invalid fraction has no percentage', () => {
  for (const v of [null, undefined, 2, -1, Infinity, '0.1']) assert.equal(used(v), null);
});
test('alert payload cannot include raw credentials/prompts', () => {
  const a = read(sample({ usedPercent: 90, secret: 'synthetic-never-send', prompt: 'private-test-text' }));
  assert.ok(!JSON.stringify(a.alerts).includes('synthetic-never-send'));
  assert.ok(!JSON.stringify(a.alerts).includes('private-test-text'));
});
test('local budgets explicitly distinguished', () => assert.equal(read(sample({ usedPercent: 90, budgetKind: 'local' })).alerts[0].budgetKind, 'local'));
test('state input is immutable', () => {
  const a = read(sample({ usedPercent: 50 }));
  const frozen = JSON.stringify(a.state);
  read(sample({ usedPercent: 90 }), a.state);
  assert.equal(JSON.stringify(a.state), frozen);
});
test('missing reset cannot revive expired same-cycle reading', () => {
  const a = read(sample({ usedPercent: 49, resetsAtMs: now + 1000 }));
  const b = read(sample({ usedPercent: 90, resetsAtMs: null, observedAtMs: now + 2000 }), a.state, now + 2000);
  assert.equal(b.status, 'refresh-required');
  assert.equal(b.alerts.length, 0);
});
test('missing reset preserves known unexpired timestamp', () => {
  const a = read(sample({ usedPercent: 49 }));
  const b = read(sample({ usedPercent: 90, resetsAtMs: null }), a.state);
  assert.equal(b.alerts[0].resetsAtMs, now + 3600000);
});
test('new confirmed cycle does not inherit old reset', () => {
  const a = read(sample({ usedPercent: 49, resetsAtMs: now + 1000 }));
  const b = read(sample({ usedPercent: 90, cycleId: 'cycle-2', resetsAtMs: null, observedAtMs: now + 2000 }), a.state, now + 2000);
  assert.equal(b.status, 'current-reset-unknown');
  assert.equal(b.alerts.length, 1);
});
test('unknown cycle is visible even with fresh percent', () => assert.equal(read(sample({ cycleConfirmed: false })).status, 'current-cycle-unknown'));
test('missing reset is visible even with confirmed cycle', () => assert.equal(read(sample({ resetsAtMs: null })).status, 'current-reset-unknown'));
test('global and scoped limits remain independently alertable', () => {
  const a = read(sample({ usedPercent: 90 }));
  const b = read(sample({ usedPercent: 90, scopeId: 'model-family' }), a.state);
  assert.equal(b.alerts.length, 1);
  assert.equal(b.alerts[0].scopeId, 'model-family');
});
test('two scoped model limits do not suppress each other', () => {
  const a = read(sample({ usedPercent: 90, scopeId: 'family-a' }));
  assert.equal(read(sample({ usedPercent: 90, scopeId: 'family-b' }), a.state).alerts.length, 1);
});
