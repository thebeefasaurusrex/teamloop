import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  discoverTools,
  parseCodexUsage,
  parseCodexBarUsage,
  parseGoogleUsage,
  parseModelOutput,
  runModel,
  collectUsage,
  safeError,
  prepareGoogleReviewer,
  assertGoogleReviewerSettings,
  googleUsageVersionSupported,
} from '../core/providers.mjs';
const fixture = name => JSON.parse(fs.readFileSync(new URL(`../fixtures/provider-${name}.json`, import.meta.url), 'utf8'));
const now = Date.parse('2030-03-17T17:46:40Z');
const settings = {
  paths: { codex: '/tools/codex', claude: '/tools/claude', codexbar: '/tools/codexbar', agy: '/tools/agy' },
  enabledProviders: ['codex', 'claude'],
};
const success = { code: 0, stopped: null, stderr: '' };
async function removeFixtureHome(home) {
  const root = path.resolve(os.tmpdir()),
    target = path.resolve(home);
  assert.equal(path.dirname(target), root);
  assert.ok(path.basename(target).startsWith('teamloop-google-'));
  await fsp.rm(target, { recursive: true, force: true });
}

test('discovery only tests absolute Mac locations', () => {
  const paths = [];
  const tools = discoverTools({
    home: '/Users/test',
    exists: p => {
      paths.push(p);
      return p === '/opt/homebrew/bin/codex';
    },
  });
  assert.equal(tools.codex, '/opt/homebrew/bin/codex');
  assert.equal(tools.claude, '');
  assert.ok(paths.every(p => p.startsWith('/')));
});
test('Codex returns actual duration meters and account', () => {
  const m = parseCodexUsage(fixture('codex'), now);
  assert.equal(m.length, 2);
  assert.equal(m[0].windowId, '300m');
  assert.equal(m[1].usedPercent, 76);
  assert.equal(m[0].observedAtMs, now);
});
test('Codex primary is not assumed five-hour', () => {
  const f = fixture('codex');
  f.limits.rateLimitsByLimitId.codex.primary.windowDurationMins = 15;
  assert.equal(parseCodexUsage(f, now)[0].windowId, '15m');
});
test('Codex rejects alternate auth, missing identity and invalid percent', () => {
  const a = fixture('codex');
  a.account.account.type = 'apiKey';
  assert.throws(() => parseCodexUsage(a, now));
  const b = fixture('codex');
  delete b.account.account.email;
  assert.throws(() => parseCodexUsage(b, now));
  const c = fixture('codex');
  c.limits.rateLimitsByLimitId.codex.primary.usedPercent = '90';
  assert.throws(() => parseCodexUsage(c, now));
});
test('Codex missing quota means no meters, not zero', () => {
  const f = fixture('codex');
  f.limits = { rateLimits: null };
  assert.deepEqual(parseCodexUsage(f, now), []);
});
test('CodexBar preserves provider observation time and CLI source', () => {
  const m = parseCodexBarUsage(fixture('claude'), 'claude', now + 300000);
  assert.equal(m.length, 2);
  assert.equal(m[0].observedAtMs, now);
  assert.equal(m[0].usedPercent, 28);
});
test('CodexBar rejects cookie/OAuth source even valid quota', () => {
  for (const source of ['web', 'oauth', 'claude-oauth', 'auto']) {
    const f = fixture('claude');
    f.source = source;
    assert.throws(() => parseCodexBarUsage(f, 'claude', now));
  }
});
test('CodexBar absent identity or timestamp cannot become current', () => {
  const a = fixture('claude');
  delete a.usage.identity;
  assert.throws(() => parseCodexBarUsage(a, 'claude', now));
  const b = fixture('claude');
  delete b.usage.updatedAt;
  assert.throws(() => parseCodexBarUsage(b, 'claude', now));
});
test('Google documented usage fixture lacks identity and is honestly unavailable', () =>
  assert.throws(() => parseGoogleUsage(fixture('google'), now), /identity/));
test('Google maps actual remaining fractions only with identity', () => {
  const f = fixture('google');
  f.command.data.identity = { accountEmail: 'person@example.test' };
  const m = parseGoogleUsage(f, now);
  assert.equal(m[0].usedPercent, 14);
  assert.equal(m[1].usedPercent, 5);
});
test('Google requires literal no-inference usage envelope', () => {
  for (const change of [{ status: 'ERROR' }, { num_turns: 1 }, { command: { name: 'model' } }, { usage: { input_tokens: 1 } }]) {
    const f = { ...fixture('google'), ...change };
    assert.throws(() => parseGoogleUsage(f, now));
  }
});
test('Google invalid/absent remaining fraction is not zero', () => {
  for (const value of [null, -1, 1.1, '0.1']) {
    const f = fixture('google');
    f.command.data.identity = { email: 'a' };
    f.command.data.groups[0].buckets[0].remaining_fraction = value;
    assert.throws(() => parseGoogleUsage(f, now));
  }
});
test('Claude successful advisory response and usage allowlist', () => {
  const r = parseModelOutput(
    'claude',
    JSON.stringify({ type: 'result', subtype: 'success', num_turns: 1, result: 'Done', usage: { input_tokens: 12, credential: 'never-forward' } }),
    'model',
  );
  assert.equal(r.text, 'Done');
  assert.deepEqual(r.usage, { input_tokens: 12 });
});
test('Claude rejects failure, overage and server tool activity', () => {
  for (const extra of [
    { subtype: 'error' },
    { isUsingOverage: true },
    { usage: { server_tool_use: { web_search_requests: 1 } } },
    { permission_denials: [{}] },
  ]) {
    assert.throws(() => parseModelOutput('claude', JSON.stringify({ type: 'result', subtype: 'success', num_turns: 1, result: 'Done', ...extra }), 'model'));
  }
});
test('Codex advisory requires terminal completion and rejects operational items', () => {
  const good = [
    { type: 'item.completed', item: { type: 'agent_message', text: 'Done' } },
    { type: 'turn.completed', usage: { input_tokens: 4 } },
  ];
  assert.equal(parseModelOutput('codex', good.map(JSON.stringify).join('\n'), 'model').text, 'Done');
  assert.throws(() => parseModelOutput('codex', JSON.stringify(good[0]), 'model'));
  for (const type of ['command_execution', 'file_change', 'mcp_tool_call', 'web_search'])
    assert.throws(() => parseModelOutput('codex', [{ type: 'item.started', item: { type } }, ...good].map(JSON.stringify).join('\n'), 'model'));
});
test('Google rejects operational tools and model identity mismatch', () => {
  const good = [
    { event: 'init', init: { model: 'model' } },
    { event: 'result', result: { status: 'SUCCESS', response: 'Done' } },
  ];
  assert.equal(parseModelOutput('gemini', good.map(JSON.stringify).join('\n'), 'model').text, 'Done');
  assert.throws(() => parseModelOutput('gemini', good.map(JSON.stringify).join('\n'), 'other'));
  assert.throws(() =>
    parseModelOutput(
      'gemini',
      [good[0], { event: 'step_update', step_update: { step_type: 'tool', tool_name: 'read_file' } }, good[1]].map(JSON.stringify).join('\n'),
      'model',
    ),
  );
});
test('Claude launcher has no daily gate and strips alternate auth', async () => {
  const calls = [];
  const result = await runModel(
    { provider: 'claude', model: 'claude-sonnet-5-5', prompt: 'Synthetic review', cwd: '/probe' },
    {
      settings,
      execute: async (c, a, o) => {
        calls.push({ c, a, o });
        return {
          ...success,
          stdout:
            a[0] === 'auth'
              ? JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })
              : JSON.stringify({ type: 'result', subtype: 'success', num_turns: 1, result: 'Reviewed' }),
        };
      },
    },
  );
  assert.equal(result.text, 'Reviewed');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].a.includes('--safe-mode'));
  assert.ok(calls[1].a.includes('--strict-mcp-config'));
  assert.ok(calls[1].a.includes('mcp__*'));
  assert.equal(calls[1].o.env.CLAUDE_CODE_DISABLE_FAST_MODE, '1');
});
test('Claude wrong auth never starts model', async () => {
  let n = 0;
  await assert.rejects(
    runModel(
      { provider: 'claude', model: 'model', prompt: 'x', cwd: '/probe' },
      {
        settings,
        execute: async () => {
          n++;
          return { ...success, stdout: '{"loggedIn":true,"authMethod":"api_key"}' };
        },
      },
    ),
  );
  assert.equal(n, 1);
});
test('API private input fails before network or key use', async () => {
  await assert.rejects(
    runModel(
      { provider: 'deepseek', model: 'deepseek-flash', prompt: 'private', dataClass: 'private', cwd: '/probe' },
      { settings, secrets: { deepseek: 'synthetic' } },
    ),
    /public or synthetic/,
  );
});
test('collectUsage returns failed health without invented percentages', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'teamloop-google-'));
  try {
    const r = await collectUsage(settings, { probeDir: home, now, execute: async () => ({ ...success, code: 1, stdout: '' }) });
    assert.deepEqual(r.meters, []);
    assert.equal(r.health.length, 2);
    assert.ok(r.health.every(h => h.status === 'unavailable'));
  } finally {
    await removeFixtureHome(home);
  }
});
test('collectUsage explicit Claude CLI flags never choose cookie mode', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'teamloop-google-'));
  try {
    const r = await collectUsage(
      { ...settings, enabledProviders: ['claude'] },
      {
        probeDir: home,
        now,
        execute: async (c, a, o) => {
          assert.deepEqual(a, ['usage', '--provider', 'claude', '--source', 'cli', '--format', 'json']);
          assert.equal(o.env.CLAUDE_CLI_PATH, '/tools/claude');
          const config = JSON.parse(await fsp.readFile(o.env.CODEXBAR_CONFIG));
          assert.equal(config.providers[0].cookieSource, 'off');
          assert.equal(config.providers[0].tokenAccounts, null);
          assert.equal(config.hooks.enabled, false);
          return { ...success, stdout: JSON.stringify(fixture('claude')) };
        },
      },
    );
    assert.equal(r.meters.length, 2);
    assert.equal(r.health[0].status, 'ready');
  } finally {
    await removeFixtureHome(home);
  }
});
test('syntax errors cannot leak raw payload excerpt', () => assert.equal(safeError(new SyntaxError('secret payload')), 'Provider payload was not understood'));

test('quota cancellation signal is propagated to every provider subprocess', async () => {
  const signal = new AbortController().signal;
  const seen = [];
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'teamloop-google-'));
  try {
    await collectUsage(settings, {
      probeDir: home,
      now,
      signal,
      execute: async (c, a, o) => {
        seen.push(o.signal);
        return { ...success, code: 1, stdout: '' };
      },
    });
    assert.equal(seen.length, 2);
    assert.ok(seen.every(v => v === signal));
  } finally {
    await removeFixtureHome(home);
  }
});
test('Google setup preserves settings, backs up originals, and disables credits', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'teamloop-google-'));
  try {
    const settingsFile = path.join(home, '.gemini', 'antigravity-cli', 'settings.json');
    await fsp.mkdir(path.dirname(settingsFile), { recursive: true });
    await fsp.writeFile(
      settingsFile,
      JSON.stringify({ colorScheme: 'custom', useG1Credits: true, permissions: { deny: ['command(sudo)'], allow: ['command(git)'] } }),
    );
    const result = await prepareGoogleReviewer({ home });
    assert.equal(result.status, 'prepared');
    assert.equal(result.backupCreated, true);
    const s = JSON.parse(await fsp.readFile(settingsFile));
    const cfg = JSON.parse(await fsp.readFile(path.join(home, '.gemini', 'config', 'config.json')));
    assert.equal(s.colorScheme, 'custom');
    assert.deepEqual(s.permissions.allow, ['command(git)']);
    assert.ok(s.permissions.deny.includes('command(sudo)'));
    assert.equal(s.useG1Credits, false);
    assert.equal(cfg.userSettings.useAiCredits, false);
    assert.equal(assertGoogleReviewerSettings(s, cfg), true);
    assert.ok((await fsp.readdir(path.dirname(settingsFile))).some(n => n.startsWith('settings.json.teamloop-backup-')));
    assert.equal((await prepareGoogleReviewer({ home })).status, 'prepared');
  } finally {
    await removeFixtureHome(home);
  }
});
test('Google setup refuses silently converting API provider mode', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'teamloop-google-'));
  try {
    const file = path.join(home, '.gemini', 'antigravity-cli', 'settings.json');
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, '{"modelProvider":"gemini"}');
    await assert.rejects(prepareGoogleReviewer({ home }), /API-provider/);
    assert.equal(await fsp.readFile(file, 'utf8'), '{"modelProvider":"gemini"}');
  } finally {
    await removeFixtureHome(home);
  }
});
test('Google model path runs only prepared public pilot with declared agent', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'teamloop-google-'));
  try {
    await prepareGoogleReviewer({ home });
    let called = 0;
    const r = await runModel(
      { provider: 'gemini', model: 'gemini-3.8-flash-high', prompt: 'Synthetic text', dataClass: 'synthetic', cwd: '/probe' },
      {
        settings,
        home,
        execute: async (c, a, o) => {
          called++;
          assert.ok(a.includes('--agent'));
          assert.ok(a.includes('teamloop-mac-reviewer'));
          assert.ok(a.includes('--disable-slash-commands'));
          assert.equal(JSON.parse(o.input).event, 'user');
          return {
            ...success,
            stdout: [
              { event: 'init', init: { model: 'gemini-3.8-flash-high', agent: 'teamloop-mac-reviewer' } },
              { event: 'result', result: { status: 'SUCCESS', response: 'Reviewed' } },
            ]
              .map(JSON.stringify)
              .join('\n'),
          };
        },
      },
    );
    assert.equal(r.text, 'Reviewed');
    assert.equal(called, 1);
    await assert.rejects(
      runModel({ provider: 'gemini', model: 'gemini-3.8-flash-high', prompt: 'private', cwd: '/probe' }, { settings, home }),
      /public or synthetic/,
    );
  } finally {
    await removeFixtureHome(home);
  }
});
test('Google model rejects modified guard settings before execution', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'teamloop-google-'));
  try {
    await prepareGoogleReviewer({ home });
    const p = path.join(home, '.gemini', 'antigravity-cli', 'settings.json');
    const s = JSON.parse(await fsp.readFile(p));
    s.permissions.deny = [];
    await fsp.writeFile(p, JSON.stringify(s));
    await assert.rejects(
      runModel(
        { provider: 'gemini', model: 'model', prompt: 'x', dataClass: 'public', cwd: '/probe' },
        {
          settings,
          home,
          execute: () => {
            throw Error('must not start');
          },
        },
      ),
      /Prepare/,
    );
  } finally {
    await removeFixtureHome(home);
  }
});
test('DeepSeek memory-only key, fixed endpoint, no-store and bounded output', async () => {
  const result = await runModel(
    { provider: 'deepseek', model: 'deepseek-flash', prompt: 'Synthetic', dataClass: 'synthetic', cwd: '/probe' },
    {
      settings,
      secrets: { deepseek: 'synthetic-test-key' },
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://api.deepseek.com/responses');
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Authorization, 'Bearer synthetic-test-key');
        assert.equal(JSON.parse(options.body).store, false);
        return new Response(
          JSON.stringify({
            status: 'completed',
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'Reviewed' }] }],
            usage: { input_tokens: 3, credential: 'not-forwarded' },
          }),
        );
      },
    },
  );
  assert.equal(result.text, 'Reviewed');
  assert.deepEqual(result.usage, { input_tokens: 3 });
});
test('NVIDIA rejects truncated or tool output, never retries', async () => {
  let n = 0;
  await assert.rejects(
    runModel(
      { provider: 'nvidia', model: 'nvidia/model', prompt: 'Synthetic', dataClass: 'public', cwd: '/probe' },
      {
        settings,
        secrets: { nvidia: 'synthetic-test-key' },
        fetchImpl: async () => {
          n++;
          return new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }));
        },
      },
    ),
    /incomplete/,
  );
  assert.equal(n, 1);
});
test('Google read-only gate accepts supported stable versions only', () => {
  for (const v of ['1.1.11', '1.2.2', '1.4.7', '2.0.0', ' 1.2.2\n']) assert.equal(googleUsageVersionSupported(v), true, v);
  for (const v of ['1.1.10', '1.0.99', 'running', '', '1.2.2-preview', '1.2.2.3', '+1.2.2', '1.2.2+build', '01.2.2', 'v1.2.2'])
    assert.equal(googleUsageVersionSupported(v), false, v);
});
test('Google unsupported versions never dispatch a print command', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'teamloop-google-'));
  try {
    await prepareGoogleReviewer({ home });
    for (const version of ['1.1.10', 'unknown', '1.2.2-preview', '1.2.2.3', '+1.2.2']) {
      const calls = [];
      const r = await collectUsage(
        { ...settings, enabledProviders: ['gemini'] },
        {
          home,
          probeDir: home,
          now,
          execute: async (c, a) => {
            calls.push({ c, a });
            return { ...success, stdout: version };
          },
        },
      );
      assert.deepEqual(calls, [{ c: '/tools/agy', a: ['--version'] }]);
      assert.equal(r.meters.length, 0);
      assert.equal(r.health[0].status, 'unavailable');
    }
  } finally {
    await removeFixtureHome(home);
  }
});
test('Google preflight and print use the same selected executable', async () => {
  const home = await fsp.mkdtemp(path.join(os.tmpdir(), 'teamloop-google-'));
  try {
    await prepareGoogleReviewer({ home });
    const calls = [];
    const r = await collectUsage(
      { ...settings, enabledProviders: ['gemini'] },
      {
        home,
        probeDir: home,
        now,
        execute: async (c, a, o) => {
          calls.push({ c, a });
          assert.equal(o.env.AGY_CLI_DISABLE_AUTO_UPDATE, 'true');
          assert.ok(o.env.BROWSER.startsWith(home));
          return { ...success, stdout: a[0] === '--version' ? '1.4.7' : JSON.stringify(fixture('google')) };
        },
      },
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0].c, calls[1].c);
    assert.deepEqual(calls[1].a, ['-p', '/usage', '--output-format', 'json', '--print-timeout', '15s']);
    assert.equal(r.health[0].status, 'identity-unverified');
  } finally {
    await removeFixtureHome(home);
  }
});
