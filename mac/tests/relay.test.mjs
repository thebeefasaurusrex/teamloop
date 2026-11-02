import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAlert, createRelay } from '../relay/server.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
const now = 1800000000000;
const alert = {
  id: 'a'.repeat(64),
  provider: 'claude',
  label: 'weekly',
  windowId: '10080m',
  scopeId: null,
  threshold: 75,
  usedPercent: 76,
  observedAtMs: now,
  resetsAtMs: now + 100000,
};
test('relay accepts bounded metadata only', () => {
  assert.equal(validateAlert(alert, now), alert);
  assert.throws(() => validateAlert({ ...alert, prompt: 'private' }, now));
});
test('relay rejects stale/future/expired reset', () => {
  for (const p of [{ observedAtMs: now - 900001 }, { observedAtMs: now + 30001 }, { resetsAtMs: now - 1 }])
    assert.throws(() => validateAlert({ ...alert, ...p }, now));
});
test('relay cannot become arbitrary recipient mail gateway', () => assert.throws(() => validateAlert({ ...alert, to: 'other@example.test' }, now)));
test('relay requires fixed sender recipient and strong per-device credential', () => assert.throws(() => createRelay({ deviceToken: 'short' })));
test('test message has separate strict shape', () => {
  assert.equal(validateAlert({ kind: 'test', id: 'b'.repeat(64), observedAtMs: now }, now).kind, 'test');
  assert.throws(() => validateAlert({ kind: 'test', id: 'b'.repeat(64), observedAtMs: now, prompt: 'bad' }, now));
});
async function relay(t, override = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'teamloop-relay-'));
  let calls = 0;
  let mail;
  const server = createRelay({
    deviceToken: 'd'.repeat(32),
    mailKey: 'synthetic-send-key',
    from: 'sender@example.test',
    to: 'recipient@example.test',
    ledgerDir: dir,
    now: () => now,
    fetcher: async (url, r) => {
      calls++;
      mail = JSON.parse(r.body);
      assert.equal(url, 'https://api.resend.com/emails');
      return { ok: true };
    },
    ...override,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}/alerts`;
  const request = async (body = alert, headers = {}) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + 'd'.repeat(32),
        'Idempotency-Key': body.id,
        'X-TeamLoop-Recipient': createHash('sha256').update('recipient@example.test').digest('hex'),
        ...headers,
      },
      body: JSON.stringify(body),
    });
  return { request, calls: () => calls, mail: () => mail };
}
test('relay fixes recipient and deduplicates accepted idempotent event', async t => {
  const s = await relay(t);
  assert.equal((await s.request()).status, 200);
  assert.equal((await s.request()).status, 200);
  assert.equal(s.calls(), 1);
  assert.deepEqual(s.mail().to, ['recipient@example.test']);
});
test('wrong device or recipient is rejected before mail transport', async t => {
  const s = await relay(t);
  assert.equal((await s.request(alert, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await s.request(alert, { 'X-TeamLoop-Recipient': 'wrong' })).status, 403);
  assert.equal(s.calls(), 0);
});
test('unknown payload field cannot send prompt or arbitrary mail', async t => {
  const s = await relay(t);
  assert.equal((await s.request({ ...alert, prompt: 'do not send' })).status, 400);
  assert.equal(s.calls(), 0);
});
test('ledger failure returns bounded 503 and does not send mail', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'teamloop-relay-bad-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'not-directory');
  await fs.writeFile(file, 'fixture');
  const s = await relay(t, { ledgerDir: path.join(file, 'child') });
  assert.equal((await s.request()).status, 503);
  assert.equal(s.calls(), 0);
});
