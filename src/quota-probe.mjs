/** Offline installed-schema capability inspection. Does not open an account or start a model turn. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { findSecretPattern } from './shared.mjs';

const readMethods = ['account/rateLimits/read', 'account/usage/read'];
const percent = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null);
const integer = value => (Number.isSafeInteger(value) && value >= 0 ? value : null);
const label = value => (typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,160}$/.test(value) && !findSecretPattern(value) ? value : null);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export async function inspectCodexSchema(directory) {
  const root = await fs.realpath(directory),
    files = [],
    methods = new Set();
  let bytes = 0;
  async function walk(dir, depth = 0) {
    if (depth > 8) throw Error('Schema depth bound exceeded');
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw Error('Schema links unsupported');
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(next, depth + 1);
      else if (entry.name.endsWith('.json')) files.push(next);
      if (files.length > 1024) throw Error('Schema file bound exceeded');
    }
  }
  await walk(root);
  const hashes = [];
  function visit(value, depth = 0) {
    if (depth > 128) throw Error('Schema nesting bound exceeded');
    if (!object(value) && !Array.isArray(value)) return;
    const method = value.properties?.method;
    if (object(method)) for (const name of readMethods) if (method.const === name || method.enum?.includes(name)) methods.add(name);
    for (const item of Object.values(value)) visit(item, depth + 1);
  }
  for (const file of files.sort()) {
    const stat = await fs.stat(file);
    bytes += stat.size;
    if (stat.size > 8 * 1024 * 1024 || bytes > 64 * 1024 * 1024) throw Error('Schema size bound exceeded');
    const content = await fs.readFile(file);
    visit(JSON.parse(content.toString('utf8')));
    hashes.push({ path: path.relative(root, file).split(path.sep).join('/'), sha256: createHash('sha256').update(content).digest('hex') });
  }
  return {
    schemaVersion: 1,
    provider: 'codex',
    mode: 'offline-schema-only',
    fileCount: files.length,
    schemaTreeSha256: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'),
    readOnlyMethods: readMethods.filter(name => methods.has(name)),
    liveAccountVerified: false,
    quota: null,
  };
}

export async function probeCodexCapabilities({ executable, outputDirectory, timeoutMs = 15000 }) {
  if (!path.isAbsolute(executable) || !path.isAbsolute(outputDirectory)) throw Error('Absolute executable/output paths required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw Error('Invalid schema probe timeout');
  // A new output directory prevents replacing retained evidence or a live profile.
  await fs.mkdir(outputDirectory, { recursive: false });
  const result = await new Promise(resolve => {
    let settled = false,
      bytes = 0;
    const child = spawn(executable, ['app-server', 'generate-json-schema', '--out', outputDirectory], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = status => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(status);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ status: 'unavailable', reason: 'schema-probe-timeout' });
    }, timeoutMs);
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          child.kill();
          finish({ status: 'unavailable', reason: 'schema-probe-output-limit' });
        }
      });
    child.on('error', () => finish({ status: 'unavailable', reason: 'schema-probe-executable-failed' }));
    child.on('close', code => finish(code === 0 ? { status: 'generated' } : { status: 'unavailable', reason: 'schema-generation-failed' }));
  });
  if (result.status !== 'generated') return { ...result, quota: null, liveAccountVerified: false };
  try {
    return { status: 'inspected', ...(await inspectCodexSchema(outputDirectory)) };
  } catch {
    return { status: 'unavailable', reason: 'generated-schema-unreadable', quota: null, liveAccountVerified: false };
  }
}

/** Normalize explicitly supplied supported native quota snapshots, never infer from token totals. */
export function normalizeQuotaSnapshot(provider, payload, context = {}) {
  const observedAt =
    typeof context.observedAt === 'string' && Number.isFinite(Date.parse(context.observedAt)) ? new Date(context.observedAt).toISOString() : null;
  const result = {
    schemaVersion: 1,
    provider,
    observedAt,
    source: label(context.source),
    scope: 'account',
    attribution: 'not-per-run',
    status: 'unavailable',
    buckets: [],
    reason: 'supported-quota-fields-unavailable',
  };
  const bucket = (id, window, value) => {
    if (!object(value)) return;
    const usedPercent = percent(value.usedPercent ?? value.used_percentage);
    if (usedPercent === null) return;
    result.buckets.push({
      bucketId: label(id),
      window: label(window),
      unit: 'percent-used',
      usedPercent,
      windowDurationMins: integer(value.windowDurationMins),
      resetsAt: integer(value.resetsAt ?? value.resets_at),
    });
  };
  if (provider === 'codex' && object(payload)) {
    const body = payload.result ?? payload;
    const groups = object(body.rateLimitsByLimitId)
      ? Object.entries(body.rateLimitsByLimitId).slice(0, 32)
      : object(body.rateLimits)
        ? [[body.rateLimits.limitId ?? 'codex', body.rateLimits]]
        : [];
    for (const [id, value] of groups) for (const window of ['primary', 'secondary']) bucket(id, window, value?.[window]);
  } else if (provider === 'claude' && object(payload?.rate_limits)) {
    for (const window of ['five_hour', 'seven_day']) bucket('claude', window, payload.rate_limits[window]);
  }
  if (result.buckets.length) {
    result.status = observedAt ? 'observed' : 'unverified-time';
    delete result.reason;
  }
  return result;
}
