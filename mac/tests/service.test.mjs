import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../core/state.mjs';
import { defaults, policy } from '../core/policy.mjs';
import { validateSettings, configure, refresh, acknowledge, runTask, selectedEvidence, action } from '../core/service.mjs';
import { deliverPending, relayURL, emailEnvelope, testEmail } from '../core/mail.mjs';
const now = 1800000000000;
async function store(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teamloop-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return new Store(root);
}
const meter = (patch = {}) => ({
  provider: 'codex',
  accountId: 'test-account',
  workspaceId: null,
  poolId: 'codex',
  scopeId: null,
  windowId: '300m',
  cycleId: 'cycle-1',
  cycleConfirmed: true,
  availability: 'available',
  observedAtMs: now,
  resetsAtMs: now + 3600000,
  usedPercent: 76,
  label: 'Codex five-hour',
  source: 'fixture',
  ...patch,
});
const collect = meters => async () => ({ meters, health: [{ provider: 'codex', status: 'ready', message: 'fixture' }] });

test('daily maintenance absent and sleep prevention enabled by default', () => {
  assert.equal(policy.dailyClaudeRecheck, false);
  assert.equal(defaults.preventSleep, true);
  assert.equal(defaults.monitoringEnabled, true);
  assert.equal(policy.paidAPIFallback, false);
  assert.equal(policy.automaticRetries, false);
  assert.throws(() => validateSettings({ billingCheckedAt: '2026-01-01' }));
});
test('unknown and inherited settings rejected', () => {
  for (const value of [{ secret: 'bad' }, { constructor: 'bad' }, JSON.parse('{"__proto__":{"secret":"bad"}}')]) assert.throws(() => validateSettings(value));
});
test('settings input strictly bounded', () => {
  assert.throws(() => validateSettings({ pollSeconds: 0 }));
  assert.throws(() => validateSettings({ models: { codex: 'bad\ncommand' } }));
  assert.throws(() => validateSettings({ paths: { codex: 'relative' } }));
  assert.throws(() => validateSettings({ enabledProviders: ['other'] }));
  assert.throws(() => validateSettings({ emailEnabled: true }));
});
test('state serializes concurrent updates without loss', async t => {
  const s = await store(t);
  await Promise.all(Array.from({ length: 12 }, (_, i) => s.update(x => x.runs.push({ id: String(i) }))));
  assert.equal((await s.read()).runs.length, 12);
  assert.equal((await s.read()).version, 1);
});
test('unreadable state is preserved rather than silently reset', async t => {
  const s = await store(t);
  await s.init();
  await fs.writeFile(s.file, 'broken');
  await assert.rejects(s.read(), /preserve/i);
  assert.equal(await fs.readFile(s.file, 'utf8'), 'broken');
});
test('nested settings merge preserves default models', async t => {
  const s = await store(t);
  const result = await configure(s, { models: { claude: 'custom-model' } });
  assert.equal(result.settings.models.claude, 'custom-model');
  assert.equal(result.settings.models.codex, defaults.models.codex);
});
test('refresh transaction creates durable once-per-threshold event', async t => {
  const s = await store(t);
  await refresh(s, {}, { collect: collect([meter()]), now });
  await refresh(s, {}, { collect: collect([meter()]), now });
  const saved = await s.read();
  assert.equal(saved.events.length, 1);
  assert.equal(saved.events[0].threshold, 75);
  assert.equal(saved.events[0].localStatus, 'pending');
  assert.equal(saved.events[0].emailStatus, 'disabled');
  assert.equal(saved.events[0].accountId, 'test-account');
  assert.equal(saved.events[0].poolId, 'codex');
});
test('failed provider leaves old meter visibly stale', async t => {
  const s = await store(t);
  await refresh(s, {}, { collect: collect([meter()]), now });
  const failed = await refresh(
    s,
    {},
    { collect: async () => ({ meters: [], health: [{ provider: 'codex', status: 'unavailable', message: 'Network' }] }), now: now + 1000 },
  );
  assert.equal(failed.meters[0].availability, 'stale');
  assert.equal(failed.events.length, 1);
});
test('acknowledging native notification does not acknowledge email', async t => {
  const s = await store(t);
  await configure(s, { emailTo: 'recipient@example.test', relayURL: 'https://relay.example.test/alerts', emailEnabled: true });
  const state = await refresh(s, {}, { collect: collect([meter()]), now });
  const result = await acknowledge(s, { eventId: state.events[0].id, channel: 'local' });
  assert.equal(result.events[0].localStatus, 'sent');
  assert.equal(result.events[0].emailStatus, 'pending');
});
test('relay URL disallows embedded secrets, redirects implicit via fetch settings', () => {
  for (const v of ['http://example.test', 'https://user:pass@example.test', 'https://example.test/?token=secret', 'https://example.test/#secret'])
    assert.throws(() => relayURL(v));
});
test('email payload excludes account identity, keys and prompts', () => {
  const e = emailEnvelope({
    id: 'id',
    provider: 'claude',
    label: 'weekly',
    windowId: '7d',
    threshold: 75,
    usedPercent: 76,
    observedAtMs: now,
    accountId: 'private-account',
    secret: 'never-mail-this',
    prompt: 'private-prompt',
  });
  assert.ok(!JSON.stringify(e).includes('private'));
  assert.ok(!Object.hasOwn(e, 'secret'));
  assert.ok(!Object.hasOwn(e, 'accountId'));
});
async function emailState(t) {
  const s = await store(t);
  await configure(s, { emailEnabled: true, emailTo: 'recipient@example.test', relayURL: 'https://relay.example.test/alerts' });
  await refresh(s, {}, { collect: collect([meter()]), now });
  return s;
}
test('email delivery uses stable idempotency and recipient binding', async t => {
  const s = await emailState(t);
  let calls = 0;
  const fetcher = async (url, request) => {
    calls++;
    assert.equal(request.redirect, 'error');
    assert.match(request.headers['X-TeamLoop-Recipient'], /^[a-f0-9]{64}$/);
    assert.equal(request.headers['Idempotency-Key'], JSON.parse(request.body).id);
    return { ok: true };
  };
  assert.equal((await deliverPending(s, { relay: 'x'.repeat(32) }, { fetcher, now })).sent, 1);
  await deliverPending(s, { relay: 'x'.repeat(32) }, { fetcher, now });
  assert.equal(calls, 1);
});
test('failed email remains retryable without repeating local acceptance', async t => {
  const s = await emailState(t);
  const e = (await s.read()).events[0];
  await acknowledge(s, { eventId: e.id, channel: 'local' });
  const result = await deliverPending(s, { relay: 'x'.repeat(32) }, { fetcher: async () => ({ ok: false }), now });
  assert.equal(result.failed, 1);
  const saved = (await s.read()).events[0];
  assert.equal(saved.emailStatus, 'failed');
  assert.equal(saved.localStatus, 'sent');
  assert.ok(saved.nextAttemptAtMs > now);
});
test('concurrent email workers claim an event only once', async t => {
  const s = await emailState(t);
  let calls = 0;
  const fetcher = async () => {
    calls++;
    await new Promise(r => setTimeout(r, 60));
    return { ok: true };
  };
  await Promise.all([deliverPending(s, { relay: 'x'.repeat(32) }, { fetcher, now }), deliverPending(s, { relay: 'x'.repeat(32) }, { fetcher, now })]);
  assert.equal(calls, 1);
});
test('stale queued emails expire without network request', async t => {
  const s = await emailState(t);
  let called = false;
  const r = await deliverPending(
    s,
    { relay: 'x'.repeat(32) },
    {
      fetcher: async () => {
        called = true;
        return { ok: true };
      },
      now: now + 901000,
    },
  );
  assert.equal(r.expired, 1);
  assert.equal(called, false);
});
test('old-cycle email expires after provider reset', async t => {
  const s = await emailState(t);
  await refresh(s, {}, { collect: collect([meter({ cycleId: 'cycle-2', usedPercent: 5 })]), now });
  let calls = 0;
  await deliverPending(
    s,
    { relay: 'x'.repeat(32) },
    {
      fetcher: async () => {
        calls++;
        return { ok: true };
      },
      now,
    },
  );
  assert.equal(calls, 0);
});
test('explicit email test is clearly labeled and has no quota fabrication', async t => {
  const s = await emailState(t);
  let body;
  const result = await testEmail(
    s,
    { relay: 'x'.repeat(32) },
    {
      fetcher: async (_, r) => {
        body = JSON.parse(r.body);
        return { ok: true };
      },
      now,
    },
  );
  assert.equal(body.kind, 'test');
  assert.equal(body.threshold, undefined);
  assert.equal(result.accepted, true);
});
test('runs primary reviewers then planned synthesis, no fallback', async t => {
  const s = await store(t);
  const calls = [];
  const output = await runTask(
    s,
    { prompt: 'Explain a public idea', providers: ['codex', 'claude'], dataClass: 'public' },
    {
      runModel: async spec => {
        calls.push(spec.provider);
        return { provider: spec.provider, model: spec.model, text: `answer ${calls.length}` };
      },
    },
  );
  assert.deepEqual(calls, ['codex', 'claude', 'codex']);
  assert.equal(output.run.text, 'answer 3');
  assert.equal(output.run.status, 'completed');
});
test('primary failure does not substitute another provider', async t => {
  const s = await store(t);
  const calls = [];
  const r = await runTask(
    s,
    { prompt: 'test', providers: ['codex', 'claude'] },
    {
      runModel: async spec => {
        calls.push(spec.provider);
        throw Error('Unavailable');
      },
    },
  );
  assert.deepEqual(calls, ['codex']);
  assert.equal(r.run.status, 'failed');
});
test('API specialists reject private work before any provider call', async t => {
  const s = await store(t);
  await assert.rejects(
    runTask(s, { prompt: 'Private task', providers: ['deepseek'], dataClass: 'private' }, { runModel: async () => assert.fail() }),
    /public or synthetic/,
  );
});
test('cancelled tasks retain visible cancellation state', async t => {
  const s = await store(t);
  const signal = AbortSignal.abort();
  const r = await runTask(
    s,
    { prompt: 'test' },
    {
      signal,
      runModel: async () => {
        throw Error('Cancelled');
      },
    },
  );
  assert.equal(r.run.status, 'cancelled');
});
test('file selection enforces explicit UTF8 text, max sizes and secret paths', async t => {
  const s = await store(t);
  const good = path.join(s.root, 'good.txt');
  await fs.writeFile(good, 'reference');
  assert.equal((await selectedEvidence([good], s.root)).length, 1);
  const secret = path.join(s.root, '.env');
  await fs.writeFile(secret, 'secret');
  await assert.rejects(selectedEvidence([secret], s.root));
  const binary = path.join(s.root, 'binary');
  await fs.writeFile(binary, Buffer.from([0, 255]));
  await assert.rejects(selectedEvidence([binary], s.root));
});
test('diagnostics contain no raw prompt, task output or credentials', async t => {
  const s = await store(t);
  await s.update(x => x.runs.push({ text: 'private output', prompt: 'private task' }));
  const d = await action('diagnostics', {}, { store: s });
  assert.ok(!JSON.stringify(d).includes('private'));
});
test('reset timestamp correction through adapter/service does not rearm', async t => {
  const s = await store(t);
  await refresh(s, {}, { collect: collect([meter({ cycleId: String(now + 3600000) })]), now });
  await refresh(s, {}, { collect: collect([meter({ cycleId: String(now + 3660000), resetsAtMs: now + 3660000 })]), now });
  assert.equal((await s.read()).events.length, 1);
});
test('real elapsed window reset rearms after new confirmed observation', async t => {
  const s = await store(t);
  await refresh(s, {}, { collect: collect([meter()]), now });
  const later = now + 3601000;
  await refresh(s, {}, { collect: collect([meter({ cycleId: 'cycle-2', resetsAtMs: later + 3600000, observedAtMs: later })]), now: later });
  assert.equal((await s.read()).events.length, 2);
});
test('configuration edit during quota probe is not overwritten by old result', async t => {
  const s = await store(t);
  await configure(s, { paths: { codex: '/old/codex' } });
  const result = await refresh(
    s,
    {},
    {
      collect: async () => {
        await configure(s, { paths: { codex: '/new/codex' } });
        return { meters: [meter()], health: [] };
      },
      now,
    },
  );
  assert.equal(result.settings.paths.codex, '/new/codex');
  assert.equal(result.meters.length, 0);
});
test('cancel signal travels through refresh to quota collector', async t => {
  const s = await store(t);
  const control = new AbortController();
  let received;
  await refresh(
    s,
    {},
    {
      signal: control.signal,
      collect: async (_, options) => {
        received = options.signal;
        return { meters: [], health: [] };
      },
      now,
    },
  );
  assert.equal(received, control.signal);
});
test('state revision rises transactionally for UI stale-response rejection', async t => {
  const s = await store(t);
  const a = await action('snapshot', {}, { store: s });
  const b = await configure(s, { preventSleep: false });
  const c = await configure(s, { preventSleep: true });
  assert.ok(b.revision > a.revision);
  assert.ok(c.revision > b.revision);
});
test('atomic lock publishes complete owner metadata', async t => {
  const s = await store(t);
  await s.update(async () => {
    const owner = JSON.parse(await fs.readFile(s.lock, 'utf8'));
    assert.equal(owner.pid, process.pid);
    assert.ok(owner.nonce);
  });
  const files = await fs.readdir(s.root);
  assert.ok(!files.some(f => f.startsWith('.lock-candidate-')));
  assert.ok(!files.includes('.state-lock'));
});
test('pre-cancelled email worker does not start network', async t => {
  const s = await emailState(t);
  let calls = 0;
  await deliverPending(
    s,
    { relay: 'x'.repeat(32) },
    {
      now,
      signal: AbortSignal.abort(),
      fetcher: async () => {
        calls++;
        return { ok: true };
      },
    },
  );
  assert.equal(calls, 0);
});
test('UTF8 byte limit cannot create a state that its own reader rejects', async t => {
  const s = await store(t);
  await s.update(() => {});
  const before = await fs.readFile(s.file, 'utf8');
  await assert.rejects(
    s.update(x => x.runs.push({ text: '漢'.repeat(3 * 1024 * 1024) })),
    /retention limit/,
  );
  assert.equal(await fs.readFile(s.file, 'utf8'), before);
  assert.equal((await s.read()).version, 1);
});
test('full result artifact persists while history is kept lightweight', async t => {
  const s = await store(t);
  const output = await runTask(s, { prompt: 'test' }, { runModel: async () => ({ text: 'x'.repeat(25000) }) });
  const saved = JSON.parse(await fs.readFile(output.run.artifact, 'utf8'));
  assert.equal(saved.text.length, 25000);
  await runTask(s, { prompt: 'next' }, { runModel: async () => ({ text: 'next' }) });
  assert.equal((await s.read()).runs[0].text.length, 16000);
  assert.equal(saved.text.length, 25000);
});
test('credential-like task input cannot reach a model', async t => {
  const s = await store(t);
  await assert.rejects(runTask(s, { prompt: 'my password = "synthetic-private-passphrase"' }, { runModel: async () => assert.fail() }), /secret-like/);
});
