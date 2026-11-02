import { createHash } from 'node:crypto';
import { meterIdentity } from './quota.mjs';
export function relayURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw Error('Enter a valid HTTPS alert relay URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw Error('Relay must be HTTPS without credentials, query or fragment');
  return url.href;
}
export function emailEnvelope(event) {
  return {
    id: event.id,
    provider: event.provider,
    label: event.label,
    windowId: event.windowId,
    scopeId: event.scopeId ?? null,
    threshold: event.threshold,
    usedPercent: event.usedPercent,
    observedAtMs: event.observedAtMs,
    resetsAtMs: event.resetsAtMs ?? null,
  };
}
export function eventCurrent(event, state, now) {
  if (now - event.observedAtMs > 15 * 60 * 1000 || event.observedAtMs > now + 30000) return false;
  const meter = state.meters.find(m => meterIdentity(m) === event.meterKey);
  if (!meter || meter.availability !== 'available' || !Number.isFinite(meter.observedAtMs) || now - meter.observedAtMs > 600000) return false;
  if (meter.resetsAtMs != null && meter.resetsAtMs <= now) return false;
  return event.cycleId === meter.cycleId && meter.usedPercent >= event.threshold;
}
export async function deliverPending(store, secrets = {}, { fetcher = fetch, now = Date.now(), signal } = {}) {
  const state = await store.read();
  if (!state.settings.emailEnabled) return { sent: 0, failed: 0, expired: 0, status: 'disabled' };
  const endpoint = relayURL(state.settings.relayURL);
  const token = secrets.relay;
  if (typeof token !== 'string' || token.length < 24) throw Error('Save a paired alert relay token in Keychain first');
  let sent = 0,
    failed = 0,
    expired = 0;
  for (const event of state.events.filter(e => ['pending', 'failed', 'sending'].includes(e.emailStatus)).slice(0, 30)) {
    if (signal?.aborted) break;
    let claimed = false,
      body;
    await store.update(s => {
      const current = s.events.find(e => e.id === event.id);
      if (!current || current.emailStatus === 'sent' || current.emailStatus === 'expired' || !s.settings.emailEnabled) return;
      if (!eventCurrent(current, s, now)) {
        current.emailStatus = 'expired';
        expired++;
        return;
      }
      if ((current.nextAttemptAtMs ?? 0) > now || (current.leaseUntilMs ?? 0) > now) return;
      current.emailStatus = 'sending';
      current.leaseUntilMs = now + 60000;
      current.attempts = (current.attempts ?? 0) + 1;
      body = emailEnvelope(current);
      claimed = true;
    });
    if (!claimed) continue;
    let success = false;
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': event.id,
          'X-TeamLoop-Recipient': emailId(state.settings.emailTo.trim().toLowerCase()),
        },
        body: JSON.stringify(body),
      });
      success = response.ok;
    } catch {
      /* Transport details can contain secrets. Retain only a delivery state. */
    }
    await store.update(s => {
      const item = s.events.find(e => e.id === event.id);
      if (!item) return;
      item.leaseUntilMs = 0;
      item.emailStatus = success ? 'sent' : 'failed';
      item.nextAttemptAtMs = success ? null : now + Math.min(3600000, 30000 * 2 ** Math.min(item.attempts, 6));
    });
    if (success) sent++;
    else failed++;
  }
  return { sent, failed, expired, status: failed ? 'delivery-pending' : 'ok' };
}
export const emailId = raw => createHash('sha256').update(String(raw)).digest('hex');

export async function testEmail(store, secrets = {}, { fetcher = fetch, now = Date.now(), signal } = {}) {
  const { settings } = await store.read();
  if (!settings.emailTo || !settings.relayURL) throw Error('Configure the paired email destination and relay first');
  if (typeof secrets.relay !== 'string' || secrets.relay.length < 24) throw Error('Save a paired relay token in Keychain first');
  const id = emailId(`test:${now}:${Math.random()}`);
  let response;
  try {
    response = await fetcher(relayURL(settings.relayURL), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secrets.relay}`,
        'Idempotency-Key': id,
        'X-TeamLoop-Recipient': emailId(settings.emailTo.trim().toLowerCase()),
      },
      body: JSON.stringify({ id, kind: 'test', observedAtMs: now }),
    });
  } catch {
    throw Error('Email relay test could not connect');
  }
  if (!response.ok) throw Error('Email relay did not accept the test; verify token, destination and sender setup');
  return { accepted: true, message: 'Relay accepted the test. Confirm it arrived in the recipient mailbox.' };
}
