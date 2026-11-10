import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsage, extractUsageObservations, measurePayload, createTokenizerPin } from '../src/accounting.mjs';

test('Claude preserves disjoint cache categories, missing total, zero and native fields', () => {
  const value = normalizeUsage('claude', {
    input_tokens: 5,
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 20,
    output_tokens: 0,
    api_key: 'secret',
  });
  assert.equal(value.input, 5);
  assert.equal(value.cached, 100);
  assert.equal(value.cacheCreation, 20);
  assert.equal(value.output, 0);
  assert.equal(value.total, null);
  assert.equal(value.semantics.inputIncludesCache, false);
  assert.equal(value.native.api_key, undefined);
});
test('OpenAI cached and reasoning are subsets and never added to native total', () => {
  const value = normalizeUsage('codex', {
    input_tokens: 100,
    cached_input_tokens: 80,
    output_tokens: 20,
    output_tokens_details: { reasoning_tokens: 15 },
    total_tokens: 120,
  });
  assert.equal(value.total, 120);
  assert.equal(value.cached, 80);
  assert.equal(value.thinking, 15);
  assert.equal(value.semantics.inputIncludesCache, true);
});
test('invalid primary numeric field does not silently fall back to another alias', () => {
  const value = normalizeUsage('nvidia', {
    input_tokens: -1,
    prompt_tokens: 5,
    completion_tokens: '7',
    total_tokens: Number.MAX_SAFE_INTEGER + 1,
    thinking_tokens: 1.5,
  });
  assert.equal(value.input, null);
  assert.equal(value.output, null);
  assert.equal(value.total, null);
  assert.equal(value.thinking, null);
  assert.equal(value.invalidFields.length, 4);
  assert.equal(normalizeUsage('gemini', {}).input, null);
});
test('malformed or failed review output does not erase token consumption', () => {
  const output = JSON.stringify({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result: 'invalid json',
    usage: { input_tokens: 19, output_tokens: 4 },
    session_id: 's',
    num_turns: 1,
  });
  const observations = extractUsageObservations('claude', output, { runId: 'failed', model: 'claude-opus-5-5' });
  assert.equal(observations.length, 1);
  assert.equal(observations[0].usage.input, 19);
  assert.equal(observations[0].authoritative, true);
});
test('truncated NDJSON retains earlier usage and treats unknown totals as unknown', () => {
  const output = JSON.stringify({ type: 'turn.failed', turn_id: 't', usage: { input_tokens: 9 } }) + '\n{"broken';
  const values = extractUsageObservations('codex', output);
  assert.equal(values.length, 1);
  assert.equal(values[0].usage.total, null);
  assert.equal(values[0].scope, 'turn');
});
test('Gemini step and cumulative terminal observations remain separate; duplicate identities suppressed', () => {
  const step = { event: 'step_update', step_update: { conversation_id: 'c', step_index: 1, usage: { input_tokens: 10, output_tokens: 2 } } };
  const result = {
    event: 'result',
    result: { conversation_id: 'c', num_turns: 1, status: 'ERROR', usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } },
  };
  const values = extractUsageObservations('gemini', [step, step, result, result].map(JSON.stringify).join('\n'));
  assert.equal(values.length, 2);
  assert.equal(values[0].scope, 'step');
  assert.equal(values[1].scope, 'session-cumulative');
  assert.equal(values[1].usage.total, 12);
});
test('identical anonymous turns are not assumed to be duplicate provider calls', () => {
  const entry = JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10 } });
  assert.equal(extractUsageObservations('codex', entry + '\n' + entry).length, 2);
});
test('Claude model breakdowns are labeled non-additive corroborating detail', () => {
  const output = JSON.stringify({
    type: 'result',
    usage: { input_tokens: 20 },
    modelUsage: { 'claude-sonnet-5-5': { inputTokens: 20, cacheCreationInputTokens: 4 } },
    session_id: 's',
    num_turns: 1,
  });
  const values = extractUsageObservations('claude', output);
  assert.equal(values.length, 2);
  assert.equal(values[1].scope, 'model-breakdown');
  assert.equal(values[1].usage.cacheCreation, 4);
  assert.deepEqual(values[1].usage.invalidFields, []);
});
test('observation count and stdout byte bounds are enforced', () => {
  const values = Array.from({ length: 300 }, (_, i) => ({ type: 'turn.completed', turn_id: 't' + i, usage: { input_tokens: i } }));
  const capped = extractUsageObservations('codex', JSON.stringify(values));
  assert.equal(capped.length, 256);
  assert.equal(capped.truncated, true);
  assert.equal(capped.coverage, 'partial');
  assert.ok(capped.reasonCodes.includes('observation-limit'));
  const oversized = extractUsageObservations('codex', 'x'.repeat(64 * 1024 * 1024 + 1));
  assert.equal(oversized.length, 0);
  assert.equal(oversized.truncated, true);
  assert.equal(oversized.coverage, 'unknown');
  assert.deepEqual(oversized.reasonCodes, ['stdout-byte-limit']);
});
test('tail event capture preserves terminal usage beyond 4096 lines with original ordinal', () => {
  const lines = Array.from({ length: 4200 }, () => JSON.stringify({ type: 'progress' }));
  lines.push(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 17, total_tokens: 20 } }));
  const values = extractUsageObservations('codex', lines.join('\n'));
  assert.equal(values.length, 1);
  assert.equal(values[0].authoritative, true);
  assert.equal(values[0].usage.total, 20);
  assert.equal(values[0].sequence, 4200);
  assert.equal(values.truncated, true);
  assert.equal(values.coverage, 'partial');
  assert.ok(values.reasonCodes.includes('event-limit'));
});
test('terminal usage displaces details when observation capacity is already full', () => {
  const lines = Array.from({ length: 300 }, (_, i) => JSON.stringify({ type: 'assistant', message: { id: 'm' + i, usage: { input_tokens: i } } }));
  lines.push(JSON.stringify({ type: 'result', session_id: 's', num_turns: 1, is_error: true, usage: { input_tokens: 900, total_tokens: 1000 } }));
  const values = extractUsageObservations('claude', lines.join('\n'));
  assert.equal(values.length, 256);
  assert.equal(values.at(-1).authoritative, true);
  assert.equal(values.at(-1).usage.total, 1000);
  assert.equal(values.coverage, 'partial');
});
test('stream ordinal matches final JSONL ordinal despite invalid notices and trailing blanks', () => {
  const first = JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 8, reasoning_output_tokens: 2 } });
  const terminal = JSON.stringify({ type: 'turn.failed', usage: { input_tokens: 12, output_tokens: 3 } });
  const final = extractUsageObservations('codex', 'startup notice\n' + first + '\ninvalid notice\n' + terminal + '\n\n', { source: 'terminal', runId: 'run' });
  const streamFirst = extractUsageObservations('codex', first, { source: 'stream', runId: 'run', sequenceOffset: 1 });
  const streamTerminal = extractUsageObservations('codex', terminal, { source: 'stream', runId: 'run', sequenceOffset: 3 });
  assert.equal(final[0].sequence, 1);
  assert.equal(final[1].sequence, 3);
  assert.equal(final[0].observationId, streamFirst[0].observationId);
  assert.equal(final[1].observationId, streamTerminal[0].observationId);
  assert.equal(final[0].usage.thinking, 2);
  assert.equal(final[0].usage.native.reasoning_output_tokens, 2);
});
test('failed assistant-only consumption is partial rather than authoritative or absent', () => {
  const values = extractUsageObservations(
    'claude',
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 50, output_tokens: 2 } } }) + '\n{"truncated',
  );
  assert.equal(values.length, 1);
  assert.equal(values[0].authoritative, false);
  assert.equal(values.coverage, 'partial');
  assert.ok(values.reasonCodes.includes('terminal-usage-unavailable'));
});
test('metadata rejects secret-shaped model and event labels; source provenance does not duplicate IDs', () => {
  const output = JSON.stringify({
    type: 'result',
    session_id: 's',
    num_turns: 1,
    model: 'sk-' + 'abcdefghijklmnopqrstuvwxyz0123456789',
    usage: { input_tokens: 1 },
  });
  const first = extractUsageObservations('claude', output, { source: 'stream' }),
    second = extractUsageObservations('claude', output, { source: 'terminal' });
  assert.equal(first[0].actualModel, null);
  assert.equal(first[0].source, 'stream');
  assert.equal(first[0].observationId, second[0].observationId);
});
test('measurement preserves exact Unicode/BOM/CRLF bytes and unknown model status', async () => {
  const text = '\uFEFF🙂漢字\r\n';
  const value = await measurePayload(text, { provider: 'claude', model: 'claude-sonnet-5-5', hasImages: true, sections: [{ name: 'source', text }] });
  assert.equal(value.visibleBytes, Buffer.byteLength(text));
  assert.equal(value.visibleCodePoints, 6);
  assert.equal(value.tokens, null);
  assert.equal(value.fullRequestExact, false);
  assert.equal(value.modalities, 'non-text-unmeasured');
  assert.equal(value.sections[0].visibleBytes, value.visibleBytes);
  assert.match(value.payloadSha256, /^[a-f0-9]{64}$/);
});
test('character heuristic must be explicitly requested and remains labeled', async () => {
  const value = await measurePayload('hello', { heuristic: true });
  assert.equal(value.tokens, 2);
  assert.equal(value.method, 'character-heuristic');
  assert.equal(value.mappingStatus, 'unverified');
});
test('a mismatched tokenizer pin never silently falls back to an exact count', async () => {
  const value = await measurePayload('hello', {
    provider: 'codex',
    model: 'gpt-6.1-sol',
    tokenizerPin: { packageRoot: 'Z:/missing-tokenizer', version: '3.4.0', treeSha256: 'bad' },
  });
  assert.equal(value.tokens, null);
  assert.equal(value.method, 'unavailable');
});
test('optional installed tokenizer pin counts visible text but never claims current model mapping', async t => {
  const root = process.env.TEAMLOOP_TEST_TOKENIZER_ROOT;
  if (!root) {
    t.skip('explicit installed dependency test only');
    return;
  }
  const pin = await createTokenizerPin(root);
  const first = await measurePayload('hello world', { provider: 'codex', model: 'gpt-6.1-sol', tokenizerPin: pin });
  assert.ok(first.tokens > 0);
  assert.equal(first.method, 'local-tokenizer-estimate');
  assert.equal(first.mappingStatus, 'unverified-model-mapping');
  assert.equal(first.fullRequestExact, false);
  const altered = await measurePayload('hello', { provider: 'codex', tokenizerPin: { ...pin, treeSha256: '0'.repeat(64) } });
  assert.equal(altered.tokens, null);
});
