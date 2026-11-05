import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { findSecretPattern } from './shared.mjs';
const executeFile = promisify(execFile);

const safeId = value =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,159}$/.test(value) && !findSecretPattern(value) && !/^Bearer[-_:]/i.test(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const contextKeys = [
  'taskId',
  'dispatchId',
  'runId',
  'attemptId',
  'parentRunId',
  'packetHash',
  'provider',
  'requestedModel',
  'actualModel',
  'effort',
  'policyVersion',
  'runnerVersion',
  'dataClass',
  'kind',
];
const enumKeys = [
  'stage',
  'status',
  'failureClass',
  'stopReason',
  'source',
  'operation',
  'reasonCode',
  'verdict',
  'coverage',
  'transport',
  'metric',
  'unit',
  'accountingMode',
  'estimateKind',
  'tokenizerId',
  'tokenizerVersion',
  'scope',
];
const countKeys = [
  'elapsedMs',
  'durationMs',
  'exitCode',
  'stdoutBytes',
  'stderrBytes',
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'cachedTokens',
  'thinkingTokens',
  'cacheCreationTokens',
  'sizeBytes',
  'selectedFiles',
  'unknownFields',
  'droppedEvents',
  'eventCount',
  'estimatedTokens',
  'inputBytes',
];
const boolKeys = ['success', 'observed', 'partial', 'meaningfulOutput', 'fallbackUsed', 'providerCallObserved', 'enabled', 'authoritative', 'cumulative'];

function selectedContext(context) {
  return Object.fromEntries(contextKeys.filter(key => safeId(context[key])).map(key => [key, context[key]]));
}
function selectedDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  const selected = {};
  for (const key of enumKeys) if (safeId(details[key])) selected[key] = details[key];
  for (const key of countKeys) if (count(details[key]) || details[key] === null) selected[key] = details[key];
  for (const key of boolKeys) if (typeof details[key] === 'boolean') selected[key] = details[key];
  if (typeof details.evidenceHash === 'string' && /^[a-f0-9]{64}$/.test(details.evidenceHash)) selected.evidenceHash = details.evidenceHash;
  return selected;
}
async function physicalRoot(root) {
  const resolved = path.resolve(root);
  let cursor = resolved;
  while (true) {
    const info = await fs.lstat(cursor);
    if (info.isSymbolicLink()) throw Error('root-link');
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const physical = await fs.realpath(resolved);
  if (physical.toLowerCase() !== resolved.toLowerCase()) throw Error('root-alias');
  return physical;
}
async function privateWindowsAcl(root) {
  // Inspect, never repair, ACLs. Root is passed as an argument, not executable text.
  const script =
    '$ErrorActionPreference="Stop";$p=$env:TEAMLOOP_JOURNAL_ACL_ROOT;$a=Get-Acl -LiteralPath $p;$me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$allow=@($me,"S-1-5-18","S-1-5-32-544");$bad=@($a.Access|Where-Object {$_.AccessControlType -eq "Allow" -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $allow});if($bad.Count -gt 0){exit 3};$owner=([System.Security.Principal.NTAccount]$a.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value;if($owner -notin $allow){exit 4};Write-Output "private"';
  const aclEnvironment = { ...process.env, TEAMLOOP_JOURNAL_ACL_ROOT: root };
  // Windows PowerShell must resolve its own native modules when launched from PowerShell 7.
  delete aclEnvironment.PSModulePath;
  const result = await executeFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 10000,
    maxBuffer: 2048,
    env: aclEnvironment,
  });
  if (result.stdout.trim() !== 'private') throw Error('root-acl');
}

/** Optional diagnostic journal only; no provider/acceptance decisions. Each emit resolves boolean and never throws. */
export async function openJournal(config, context = {}, testing = {}) {
  const options = config?.observability;
  const state = {
    enabled: options?.enabled === true,
    healthy: false,
    coverageComplete: true,
    written: 0,
    dropped: 0,
    errorCodes: [],
    closed: false,
    journalPath: null,
  };
  let handle,
    chain = Promise.resolve(),
    queued = 0,
    closed = false,
    seq = 0,
    closePending = false;
  const started = performance.now(),
    producerId = randomUUID();
  const fail = code => {
    state.healthy = false;
    state.coverageComplete = false;
    if (!state.errorCodes.includes(code)) state.errorCodes.push(code);
  };
  const maxQueue = 64 * 1024;
  const write =
    testing.write ??
    (async (file, line) => {
      await file.writeFile(line);
    });
  const bounded = (promise, code) =>
    new Promise(resolve => {
      const timer = setTimeout(() => {
        fail(code);
        resolve(false);
      }, testing.waitMs ?? 2000);
      promise.then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          clearTimeout(timer);
          fail(code);
          resolve(false);
        },
      );
    });
  const api = {
    health: () => ({ ...state, errorCodes: [...state.errorCodes], producerId, pendingBytes: queued, closePending }),
    emit(eventType, details = {}) {
      try {
        if (!state.enabled) return Promise.resolve(false);
        if (closed || !state.healthy || !/^[a-z][a-z0-9_.-]{0,79}$/.test(eventType)) {
          state.dropped++;
          state.coverageComplete = false;
          if (closed) fail('emit-after-close');
          return Promise.resolve(false);
        }
        const severity = ['debug', 'info', 'warning', 'error'].includes(details?.severity) ? details.severity : 'info';
        const record = {
          schemaVersion: 1,
          eventId: randomUUID(),
          producerId,
          producerSeq: ++seq,
          eventType,
          severity,
          observedAt: new Date().toISOString(),
          elapsedMs: Math.max(0, Math.round(performance.now() - started)),
          provenance: 'runner_observed',
          ...selectedContext(context),
          details: selectedDetails(details),
        };
        const omitted = contextKeys.filter(key => context[key] != null && !safeId(context[key])).length;
        if (omitted) {
          record.details.unknownFields = (record.details.unknownFields ?? 0) + omitted;
          state.coverageComplete = false;
        }
        const line = JSON.stringify(record) + '\n',
          bytes = Buffer.byteLength(line);
        if (queued + bytes > maxQueue) {
          state.dropped++;
          state.coverageComplete = false;
          if (!state.errorCodes.includes('queue-overflow')) state.errorCodes.push('queue-overflow');
          return Promise.resolve(false);
        }
        queued += bytes;
        const pending = chain.then(async () => {
          if (!handle) {
            state.dropped++;
            return false;
          }
          try {
            await write(handle, line);
            state.written++;
            return true;
          } catch {
            state.dropped++;
            fail('write-failed');
            return false;
          } finally {
            queued -= bytes;
          }
        });
        chain = pending.then(
          () => undefined,
          () => undefined,
        );
        return bounded(pending, 'write-pending-timeout');
      } catch {
        state.dropped++;
        fail('event-rejected');
        return Promise.resolve(false);
      }
    },
    async close() {
      if (closed) return api.health();
      closed = true;
      closePending = true;
      // An OS write cannot be cancelled safely. Retain the serialized cleanup even when exposed wait expires.
      const finishing = chain.then(async () => {
        if (handle) {
          try {
            await handle.sync();
            await handle.close();
            handle = null;
          } catch {
            fail('close-failed');
          }
        }
        state.closed = true;
        // Never seal after a timeout or other unknown coverage condition.
        if (state.journalPath && state.healthy)
          try {
            await fs.writeFile(
              state.journalPath + '.closed',
              JSON.stringify({ schemaVersion: 1, producerId, written: state.written, dropped: state.dropped, coverageComplete: state.coverageComplete }) + '\n',
              { flag: 'wx' },
            );
          } catch {
            fail('seal-failed');
          }
        closePending = false;
        return true;
      });
      await bounded(finishing, 'close-pending-timeout');
      return api.health();
    },
  };
  if (!state.enabled) return api;
  try {
    if (typeof options.root !== 'string' || !path.isAbsolute(options.root)) throw Error('invalid-root');
    const root = await physicalRoot(options.root);
    if (testing.fixtureRoot) {
      // Test seam is not read from config; caller explicitly controls test code.
      if (root !== (await fs.realpath(testing.fixtureRoot))) throw Error('fixture-root');
    } else {
      if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) throw Error('unsupported-root');
      // Packaged Windows apps can redirect LocalAppData without a filesystem symlink.
      // Resolve the fixed approved location, never accept an arbitrary caller-selected root.
      const approved = await fs.realpath(path.resolve(process.env.LOCALAPPDATA, 'TeamLoop', 'observability', 'v1'));
      if (root.toLowerCase() !== approved.toLowerCase()) throw Error('unapproved-root');
      await privateWindowsAcl(root);
    }
    if (testing.inspectOnly) {
      state.healthy = true;
      state.closed = true;
      return api;
    }
    const day = new Date().toISOString().slice(0, 10),
      dir = path.join(root, 'journals', day);
    for (const partition of [path.join(root, 'journals'), dir]) {
      try {
        await fs.mkdir(partition);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      await physicalRoot(partition);
    }
    // Verify the writable partition after creation to reject preexisting junctions.
    await physicalRoot(dir);
    if (!testing.fixtureRoot) await privateWindowsAcl(dir);
    state.journalPath = path.join(dir, producerId + '.jsonl');
    handle = await fs.open(state.journalPath, 'wx', 0o600);
    state.healthy = true;
  } catch (error) {
    fail(
      ['invalid-root', 'root-link', 'root-alias', 'fixture-root', 'unsupported-root', 'unapproved-root', 'root-acl'].includes(error?.message)
        ? error.message
        : 'journal-open-failed',
    );
  }
  return api;
}

/** Read-only storage preflight; creates no producer, file or directory. */
export async function inspectJournalRoot(config) {
  return (await openJournal(config, {}, { inspectOnly: true })).health();
}
