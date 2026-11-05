import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeUsageReport } from '../src/claude-usage-report.mjs';

const fixture = () => [
  { type: 'system', subtype: 'init' },
  {
    type: 'assistant',
    usage_report: {
      session: { total_api_duration_ms: 0, model_usage: {} },
      rate_limits: {
        limits: [
          { kind: 'session', group: 'session', percent: 2, resets_at: '2026-11-05T05:30:00.202190+00:00', scope: null },
          { kind: 'weekly_all', group: 'weekly', percent: 23, resets_at: '2026-11-06T06:00:00.202212+00:00', scope: null },
          {
            kind: 'weekly_scoped',
            group: 'weekly',
            percent: 0,
            resets_at: '2026-11-06T06:00:00+00:00',
            scope: { model: { display_name: 'Fable' }, surface: null },
          },
        ],
        extra_usage: { is_enabled: false },
      },
    },
  },
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 0,
    usage: {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    },
  },
];
const lines = value => value.map(JSON.stringify).join('\n');
test('live-captured zero-turn usage report preserves server meter scope and percent used', () => {
  const value = parseClaudeUsageReport(lines(fixture()));
  assert.equal(value.status, 'observed');
  assert.equal(value.buckets.length, 3);
  assert.equal(value.buckets[1].usedPercent, 23);
  assert.equal(value.buckets[2].bucketId, 'weekly_scoped:model-fable');
  assert.equal(value.buckets[2].modelLabel, 'Fable');
  assert.equal(value.buckets[0].windowDurationMins, null);
  assert.equal(value.zeroModelTurnsVerified, true);
});
test('generation, tools, overage and unsupported versions fail unavailable with no fallback', () => {
  assert.equal(parseClaudeUsageReport('null').status, 'unavailable');
  const turned = fixture();
  turned[2].num_turns = 1;
  assert.equal(parseClaudeUsageReport(lines(turned)).status, 'unavailable');
  const consumed = fixture();
  consumed[2].usage.output_tokens = 1;
  assert.equal(parseClaudeUsageReport(lines(consumed)).reasonCode, 'unexpected-local-command-consumption');
  const hidden = fixture();
  hidden[2].usage.output_tokens_details = { thinking_tokens: 1 };
  assert.equal(parseClaudeUsageReport(lines(hidden)).reasonCode, 'unexpected-local-command-consumption');
  const tool = fixture();
  tool[1].message = { content: [{ type: 'tool_use', name: 'Bash' }] };
  assert.equal(parseClaudeUsageReport(lines(tool)).status, 'unavailable');
  const paid = fixture();
  paid[1].usage_report.rate_limits.extra_usage.is_enabled = true;
  assert.equal(parseClaudeUsageReport(lines(paid)).reasonCode, 'paid-overage-off-not-proven');
  assert.equal(parseClaudeUsageReport(lines(fixture()), { clientVersion: 'future' }).status, 'unavailable');
});
