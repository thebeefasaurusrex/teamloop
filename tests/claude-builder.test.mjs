import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { CLAUDE_DESIGN_COMPLETION_LIMITS, claudeFileToolRules, cleanClaudeBuilderEnv, decodeClaudeBuilder, failClaudeBridge } from '../src/claude-builder.mjs';
import { activateExecutionMode, resolveExecutionMode } from '../src/execution-mode.mjs';
import { tempDir } from './helpers.mjs';

const root = path.join(os.tmpdir(), 'synthetic-worktree');
const resultEvent = overrides => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  terminal_reason: 'completed',
  permission_denials: [],
  usage: { server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 } },
  modelUsage: { 'claude-sonnet-5': {}, 'claude-haiku-4-5-20251001': {} },
  structured_output: { summary: 'Implemented the bounded change.', uncertainties: [] },
  ...overrides,
});
const rate = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed',
    rateLimitType: 'five_hour',
    overageStatus: 'rejected',
    overageDisabledReason: 'org_level_disabled',
    isUsingOverage: false,
  },
};
const stream = (tool, result = resultEvent(), rateEvent = rate) =>
  [
    tool ? JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: tool.name, input: tool.input ?? {} }] } }) : null,
    JSON.stringify(rateEvent),
    JSON.stringify(result),
  ]
    .filter(Boolean)
    .join('\n');

test('Claude builder environment strips API and provider overrides', () => {
  const env = cleanClaudeBuilderEnv({
    PATH: 'safe',
    USERPROFILE: 'test-profile',
    ANTHROPIC_API_KEY: 'secret',
    CLAUDE_CODE_OAUTH_TOKEN: 'secret',
    CLAUDE_CODE_USE_BEDROCK: '1',
  });
  assert.equal(env.PATH, 'safe');
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(env.DISABLE_TELEMETRY, '1');
});

test('Claude builder emits exact current-worktree Read and Edit permission rules', () => {
  assert.deepEqual(claudeFileToolRules(['README.md', 'docs/guide.md']), [
    'Read(/README.md)',
    'Edit(/README.md)',
    'Read(/docs/guide.md)',
    'Edit(/docs/guide.md)',
  ]);
});

test('Claude builder accepts only bounded file tools and requested plus approved auxiliary models', () => {
  const decoded = decodeClaudeBuilder(
    stream({ name: 'Edit', input: { file_path: path.join(root, 'README.md') } }),
    root,
    'sonnet',
    ['claude-haiku-4-5'],
    ['README.md'],
  );
  assert.deepEqual(decoded.actualModels, ['claude-sonnet-5', 'claude-haiku-4-5-20251001']);
  assert.deepEqual(decoded.tools, ['Edit']);
});

test('Claude builder rejects prohibited tools, escaped paths, billing tools, denials, and model drift', () => {
  assert.throws(() => decodeClaudeBuilder(stream({ name: 'Bash' }), root, 'sonnet', ['claude-haiku-4-5'], ['README.md']));
  assert.throws(() =>
    decodeClaudeBuilder(stream({ name: 'Read', input: { file_path: '../secret.txt' } }), root, 'sonnet', ['claude-haiku-4-5'], ['README.md']),
  );
  assert.throws(() =>
    decodeClaudeBuilder(stream({ name: 'Read', input: { file_path: path.join(root, 'OTHER.md') } }), root, 'sonnet', ['claude-haiku-4-5'], ['README.md']),
  );
  assert.throws(() =>
    decodeClaudeBuilder(
      stream(null, resultEvent({ usage: { server_tool_use: { web_search_requests: 1 } } })),
      root,
      'sonnet',
      ['claude-haiku-4-5'],
      ['README.md'],
    ),
  );
  assert.throws(() =>
    decodeClaudeBuilder(stream(null, resultEvent({ permission_denials: [{ tool_name: 'Bash' }] })), root, 'sonnet', ['claude-haiku-4-5'], ['README.md']),
  );
  assert.throws(() =>
    decodeClaudeBuilder(stream(null, resultEvent({ modelUsage: { 'claude-opus-5': {} } })), root, 'sonnet', ['claude-haiku-4-5'], ['README.md']),
  );
  assert.throws(() =>
    decodeClaudeBuilder(
      stream(null, resultEvent(), { type: 'rate_limit_event', rate_limit_info: { overageStatus: 'allowed', isUsingOverage: true } }),
      root,
      'sonnet',
      ['claude-haiku-4-5'],
      ['README.md'],
    ),
  );
});

test('Claude builder failure immediately selects standard mode', async () => {
  const stateRoot = await tempDir('claude-bridge-failure-');
  const config = {
    stateRoot,
    standardPolicyVersion: '1.0.0',
    executionModes: { 'claude-bridge': { enabled: true, provider: 'claude', builderVersion: '1.0.3', validatedBuilderVersion: '1.0.3' } },
  };
  await activateExecutionMode(config, 'claude-bridge', new Date(Date.now() + 60000).toISOString());
  const record = {};
  await failClaudeBridge(config, record, new Error('synthetic failure'));
  assert.equal(record.status, 'failed');
  assert.equal(record.modeAfterFailure.effectiveMode, 'standard');
  assert.equal((await resolveExecutionMode(config)).effectiveMode, 'standard');
});

const receipt = { summary: 'Saved selected design files.', uncertainties: [] };
function decodeDesignReceipt(raw, overrides = {}) {
  return decodeClaudeBuilder(
    [
      { type: 'system', subtype: 'init', model: 'claude-opus-5-5', tools: ['Read', 'Write', 'Edit'] },
      rate,
      resultEvent({ modelUsage: { 'claude-opus-5-5': {} }, result: raw, ...overrides }),
    ]
      .map(JSON.stringify)
      .join('\n'),
    root,
    'claude-opus-5-5',
    [],
    ['README.md'],
    true,
  );
}

test('design receipt accepts plain JSON or exactly one surrounding json fence', () => {
  const raw = JSON.stringify(receipt);
  for (const text of [raw, ' \r\n' + raw + '\t', '```json\n' + raw + '\n```', '\n```json\r\n' + raw + '\r\n```\n'])
    assert.deepEqual(decodeDesignReceipt(text).result, receipt);
  for (const text of [
    'Saved files.\n' + raw,
    raw + '\nDone.',
    '```\n' + raw + '\n```',
    '```JSON\n' + raw + '\n```',
    '```json ' + raw + '```',
    '```json\n' + raw + '\n```\n```json\n' + raw + '\n```',
    'prefix\n```json\n' + raw + '\n```',
    '```json\n' + raw + '\n```\nsuffix',
    '```json\n' + raw,
    raw.slice(0, -1),
    '{"summary":"saved","uncertainties":[],}',
    '',
  ])
    assert.throws(() => decodeDesignReceipt(text), SyntaxError);
});

test('design bounds original UTF-8 receipt bytes before parsing, including whitespace and fences', () => {
  const { jsonBytes } = CLAUDE_DESIGN_COMPLETION_LIMITS;
  const raw = JSON.stringify(receipt);
  assert.deepEqual(decodeDesignReceipt(raw + ' '.repeat(jsonBytes - Buffer.byteLength(raw))).result, receipt);
  assert.throws(() => decodeDesignReceipt(raw + ' '.repeat(jsonBytes - Buffer.byteLength(raw) + 1)), /small completion limits/);
  const fenced = '```json\n' + raw + '\n```';
  assert.deepEqual(decodeDesignReceipt(fenced + ' '.repeat(jsonBytes - Buffer.byteLength(fenced))).result, receipt);
  assert.throws(() => decodeDesignReceipt(fenced + ' '.repeat(jsonBytes - Buffer.byteLength(fenced) + 1)), /small completion limits/);
  const unicode = JSON.stringify({ summary: '中'.repeat(4096), uncertainties: ['中'.repeat(512), '中'.repeat(512), '中'.repeat(512)] });
  assert.ok(unicode.length < jsonBytes);
  assert.ok(Buffer.byteLength(unicode) > jsonBytes);
  assert.throws(() => decodeDesignReceipt(unicode), /small completion limits/);
  // An oversized malformed response proves the byte gate precedes receipt JSON.parse.
  assert.throws(() => decodeDesignReceipt('{'.repeat(jsonBytes + 1)), /small completion limits/);
});

test('design requires exact nonempty summary and uncertainty schema with bounded fields', () => {
  assert.deepEqual(CLAUDE_DESIGN_COMPLETION_LIMITS, { summaryChars: 4096, uncertainties: 16, uncertaintyChars: 512, jsonBytes: 16384 });
  decodeDesignReceipt(JSON.stringify({ summary: 'x'.repeat(4096), uncertainties: Array(16).fill('x'.repeat(512)) }));
  for (const value of [
    null,
    [],
    'text',
    1,
    { summary: 'ok' },
    { uncertainties: [] },
    { summary: '', uncertainties: [] },
    { summary: ' \n\t', uncertainties: [] },
    { summary: 42, uncertainties: [] },
    { summary: 'ok', uncertainties: 'none' },
    { summary: 'ok', uncertainties: [null] },
    { ...receipt, artifact: '<html>contents</html>' },
  ])
    assert.throws(() => decodeDesignReceipt(JSON.stringify(value)), /invalid structured output/);
  for (const value of [
    { summary: 'x'.repeat(4097), uncertainties: [] },
    { summary: 'ok', uncertainties: Array(17).fill('x') },
    { summary: 'ok', uncertainties: ['x'.repeat(513)] },
  ])
    assert.throws(() => decodeDesignReceipt(JSON.stringify(value)), /small completion limits/);
  assert.throws(() => decodeDesignReceipt(undefined), /native final JSON receipt/);
});

test('native terminal and exact model evidence remain required even for a valid fenced receipt', () => {
  const raw = '```json\n' + JSON.stringify(receipt) + '\n```';
  for (const overrides of [
    { terminal_reason: 'max_tokens' },
    { subtype: 'error', is_error: true },
    { modelUsage: {} },
    { modelUsage: { 'claude-opus-5-5-preview': {} } },
    { modelUsage: { 'claude-opus-5-5': {}, 'claude-sonnet-5-5': {} } },
    { result: undefined, structured_output: receipt },
  ])
    assert.throws(() => decodeDesignReceipt(raw, overrides));
});

test('legacy exact Sonnet decoder keeps structured-output precedence and existing receipt behavior', () => {
  const value = { summary: 'x'.repeat(4097), uncertainties: [] };
  const decode = result => decodeClaudeBuilder(stream(null, resultEvent({ modelUsage: { 'claude-sonnet-5-5': {} }, ...result })), root, 'claude-sonnet-5-5');
  assert.deepEqual(decode({ structured_output: value, result: 'malformed ignored legacy text' }).result, value);
  assert.deepEqual(decode({ structured_output: undefined, result: JSON.stringify(receipt) }).result, receipt);
  assert.throws(() => decode({ structured_output: undefined, result: '```json\n' + JSON.stringify(receipt) + '\n```' }), SyntaxError);
});
