/** Optional metadata-only email relay. Deploy behind HTTPS; never embed its mail key in the Mac app. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

function tokenEqual(a, b) {
  const aa = Buffer.from(a ?? '');
  const bb = Buffer.from(b ?? '');
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function validateAlert(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid alert');
  if (input.kind === 'test') {
    if (
      Object.keys(input).some(k => !['id', 'kind', 'observedAtMs'].includes(k)) ||
      !/^[a-f0-9]{64}$/.test(input.id ?? '') ||
      !Number.isFinite(input.observedAtMs) ||
      now - input.observedAtMs > 900000 ||
      input.observedAtMs > now + 30000
    )
      throw Error('Invalid test');
    return input;
  }
  const allowed = new Set(['id', 'provider', 'label', 'windowId', 'scopeId', 'threshold', 'usedPercent', 'observedAtMs', 'resetsAtMs']);
  if (Object.keys(input).some(k => !allowed.has(k))) throw Error('Unknown alert field');
  if (!/^[a-f0-9]{64}$/.test(input.id ?? '')) throw Error('Invalid alert identifier');
  if (!['codex', 'claude', 'gemini', 'deepseek', 'nvidia'].includes(input.provider)) throw Error('Unknown provider');
  for (const k of ['label', 'windowId'])
    if (typeof input[k] !== 'string' || input[k].length > 120 || /[\r\n\0]/.test(input[k])) throw Error('Invalid meter label');
  if (input.scopeId != null && (typeof input.scopeId !== 'string' || input.scopeId.length > 200)) throw Error('Invalid scope');
  if (![50, 75, 90].includes(input.threshold) || !Number.isFinite(input.usedPercent) || input.usedPercent < input.threshold || input.usedPercent > 10000)
    throw Error('Invalid threshold');
  if (!Number.isFinite(input.observedAtMs) || now - input.observedAtMs > 900000 || input.observedAtMs > now + 30000) throw Error('Expired alert');
  if (input.resetsAtMs != null && (!Number.isFinite(input.resetsAtMs) || input.resetsAtMs <= now)) throw Error('Expired quota window');
  return input;
}
export function createRelay({ deviceToken, mailKey, from, to, ledgerDir, fetcher = fetch, now = Date.now } = {}) {
  if (typeof deviceToken !== 'string' || deviceToken.length < 32 || !mailKey || !from || !to || !ledgerDir)
    throw Error('Configure a per-device token, mail key, fixed sender/recipient and durable ledger');
  if (/[\r\n]/.test(from + to) || !to.includes('@')) throw Error('Invalid fixed mail destination');
  let accepted = 0,
    windowStart = now();
  const inFlight = new Set();
  return http.createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.url !== '/alerts' || req.method !== 'POST') return reply(404, { error: 'Not found' });
    if (!tokenEqual(req.headers.authorization, `Bearer ${deviceToken}`)) return reply(401, { error: 'Unauthorized' });
    const recipientHash = createHash('sha256').update(to.trim().toLowerCase()).digest('hex');
    if (!tokenEqual(req.headers['x-teamloop-recipient'], recipientHash)) return reply(403, { error: 'Destination does not match the paired recipient' });
    let raw = '';
    let alert;
    try {
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 4096) throw Error('Alert too large');
      }
      alert = validateAlert(JSON.parse(raw), now());
      if (req.headers['idempotency-key'] !== alert.id) throw Error('Identifier mismatch');
    } catch {
      return reply(400, { error: 'Invalid or expired alert' });
    }
    try {
      await fs.mkdir(ledgerDir, { recursive: true, mode: 0o700 });
    } catch {
      return reply(503, { error: 'Durable alert ledger unavailable' });
    }
    const receipt = path.join(ledgerDir, alert.id + '.json');
    try {
      await fs.access(receipt);
      return reply(200, { accepted: true, duplicate: true });
    } catch (e) {
      if (e.code !== 'ENOENT') return reply(503, { error: 'Durable alert ledger unavailable' });
    }
    if (inFlight.has(alert.id)) return reply(409, { error: 'Delivery in progress' });
    if (now() - windowStart > 3600000) {
      windowStart = now();
      accepted = 0;
    }
    if (accepted >= 30) return reply(429, { error: 'Device alert rate exceeded' });
    accepted++;
    inFlight.add(alert.id);
    try {
      const reset = alert.resetsAtMs == null ? 'Not reported' : new Date(alert.resetsAtMs).toISOString();
      const body =
        alert.kind === 'test'
          ? {
              from,
              to: [to],
              subject: 'TeamLoop email connection test',
              text: 'This is your requested TeamLoop alert connection test. No quota threshold was reached and no model was called.',
            }
          : {
              from,
              to: [to],
              subject: `TeamLoop: ${alert.provider} ${alert.windowId} reached ${alert.threshold}% used`,
              text: `${alert.provider}: ${alert.label}\n${alert.usedPercent}% used.\nReset (UTC): ${reset}\nObserved (UTC): ${new Date(alert.observedAtMs).toISOString()}\n\nUsage metadata only. No new spending was enabled by TeamLoop.`,
            };
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${mailKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'teamloop/' + alert.id },
        body: JSON.stringify(body),
      });
      if (!response.ok) return reply(502, { error: 'Mail service did not accept the message' });
      await fs.writeFile(receipt, JSON.stringify({ id: alert.id, acceptedAt: now() }), { mode: 0o600, flag: 'wx' });
      return reply(200, { accepted: true });
    } catch {
      return reply(502, { error: 'Delivery incomplete; safe to retry with the same identifier' });
    } finally {
      inFlight.delete(alert.id);
    }
  });
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const server = createRelay({
    deviceToken: process.env.TEAMLOOP_DEVICE_TOKEN,
    mailKey: process.env.RESEND_API_KEY,
    from: process.env.TEAMLOOP_MAIL_FROM,
    to: process.env.TEAMLOOP_MAIL_TO,
    ledgerDir: process.env.TEAMLOOP_RELAY_LEDGER,
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT ?? 8787), '127.0.0.1', () => process.stdout.write('TeamLoop alert relay ready behind HTTPS proxy\n'));
}
