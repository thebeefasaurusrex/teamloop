import test from 'node:test';
import assert from 'node:assert/strict';
import { beginTelemetry } from '../src/runner-telemetry.mjs';

function journal() {
  const events = [];
  return {
    events,
    emit: async (type, details) => {
      events.push({ type, details });
      return true;
    },
    close: async () => ({ enabled: true, healthy: true, coverageComplete: true, journalPath: 'fixture.jsonl' }),
  };
}
test('generated but rejected output retains native cache usage and preserves failure state', async () => {
  const record = { runId: 'fixture', provider: 'claude', requestedModel: 'claude-sonnet-5-5', status: 'failed', exitCode: 1 };
  const native = journal();
  const trace = await beginTelemetry({ observability: { enabled: true } }, record, { journalFactory: async () => native });
  const stdout = JSON.stringify({
    type: 'result',
    is_error: true,
    usage: { input_tokens: 2, cache_creation_input_tokens: 16085, output_tokens: 4243 },
    result: 'not valid review',
  });
  trace.stream(stdout);
  trace.capture(stdout);
  await trace.finish();
  assert.equal(record.status, 'failed');
  assert.equal(record.usage.cache_creation_input_tokens, 16085);
  assert.equal(record.usageCoverage, 'observed');
  const usages = native.events.filter(e => e.type === 'usage.observed');
  assert.equal(usages.length, 1);
  assert.ok(usages[0].details.evidenceHash);
  assert.equal(usages[0].details.cacheCreationTokens, 16085);
  assert.equal(record.observability.path, 'fixture.jsonl');
  assert.equal(JSON.stringify(native.events).includes('not valid review'), false);
});
test('disabled instrumentation leaves records untouched and opens no writer', async () => {
  const record = { status: 'completed' };
  const trace = await beginTelemetry({}, record, {
    journalFactory: () => {
      throw Error('not called');
    },
  });
  await trace.measure('private');
  trace.capture('private');
  await trace.finish();
  assert.deepEqual(record, { status: 'completed' });
});
test('writer failure neither changes execution nor exposes errors', async () => {
  const record = { provider: 'codex', status: 'completed' };
  const trace = await beginTelemetry({ observability: { enabled: true } }, record, {
    journalFactory: () => {
      throw Error('private credential details');
    },
  });
  await trace.emit('anything');
  await trace.finish();
  assert.equal(record.status, 'completed');
  assert.equal(JSON.stringify(record).includes('credential'), false);
});
test('input measurement stores counts without prompt and missing usage stays absent', async () => {
  const record = { provider: 'codex', requestedModel: 'unverified', status: 'completed' };
  const native = journal();
  const trace = await beginTelemetry({ observability: { enabled: true } }, record, { journalFactory: async () => native });
  await trace.measure('sensitive draft π');
  trace.capture('{}');
  await trace.finish();
  assert.equal(record.inputMeasurement.visibleBytes, Buffer.byteLength('sensitive draft π'));
  assert.equal(record.usageCoverage, 'absent');
  assert.equal(record.usage, undefined);
  assert.equal(JSON.stringify(record).includes('sensitive draft'), false);
});

test('interrupted assistant-only usage is partial, retained, and never terminal authority', async () => {
  const record = { provider: 'claude', runId: 'interrupted', status: 'failed' };
  const native = journal();
  const trace = await beginTelemetry({ observability: { enabled: true } }, record, { journalFactory: async () => native });
  trace.capture(JSON.stringify({ type: 'assistant', message: { id: 'message-one', usage: { input_tokens: 10, output_tokens: 3 } } }));
  await trace.finish();
  assert.equal(record.usageCoverage, 'partial');
  assert.equal(record.usage, undefined);
  assert.equal(record.usageObservations[0].usage.output, 3);
  assert.equal(record.status, 'failed');
});

test('multiline Codex stream/final copies deduplicate while equal independent turns remain', async () => {
  const record = { provider: 'codex', runId: 'codex-two', status: 'completed' },
    native = journal();
  const trace = await beginTelemetry({ observability: { enabled: true } }, record, { journalFactory: async () => native });
  const lines = [
    JSON.stringify({ type: 'thread.started', thread_id: 'one' }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 4 } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 4 } }),
  ];
  for (const line of lines) trace.stream(line);
  trace.capture(lines.join('\n') + '\n');
  await trace.finish();
  const observed = native.events.filter(x => x.type === 'usage.observed');
  assert.equal(observed.length, 2);
  assert.notEqual(observed[0].details.evidenceHash, observed[1].details.evidenceHash);
  assert.equal(record.usageObservations.length, 2);
  assert.equal(record.usageCoverage, 'observed');
});
