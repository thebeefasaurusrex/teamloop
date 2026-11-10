import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeClaudeProgress } from '../src/claude-progress.mjs';
import { diagnosticExcerpt } from '../src/verification-isolation.mjs';
test('progress summary preserves reasoning/non-delivery metadata without text or IDs', () => {
  const events = [
    { type: 'system', subtype: 'thinking_tokens', estimated_tokens: 99 },
    { type: 'assistant', thinking_duration_ms: 216440, message: { content: [{ type: 'thinking', thinking: 'PRIVATE REASONING' }] }, session_id: 'private-id' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'PRIVATE TEXT' }] } },
    { type: 'result', subtype: 'success', result: 'PRIVATE RESULT' },
  ];
  const s = summarizeClaudeProgress(events.map(x => JSON.stringify(x)).join('\n') + '\nbad line');
  assert.deepEqual(s, { thinkingProgressEvents: 1, thinkingBlocks: 1, textBlocks: 1, toolBlocks: 0, resultEvents: 1, reportedThinkingDurationMs: 216440 });
  assert.ok(!JSON.stringify(s).includes('PRIVATE'));
  assert.ok(!JSON.stringify(s).includes('private-id'));
});
test('diagnostic excerpts preserve ending failure on the same noisy stdout stream', () => {
  const s = diagnosticExcerpt('IMPORT'.repeat(6000) + 'FINAL ASSERTION FAILED');
  assert.ok(s.truncated);
  assert.match(s.text, /FINAL ASSERTION FAILED$/);
  assert.equal(diagnosticExcerpt('short').truncated, false);
});

test('progress inspection tolerates malformed envelopes without changing worker acceptance', () => {
  assert.doesNotThrow(() =>
    summarizeClaudeProgress('null\n42\n{"type":"assistant","message":{"content":{}}}\n{"type":"assistant","message":{"content":[null]}}'),
  );
});
