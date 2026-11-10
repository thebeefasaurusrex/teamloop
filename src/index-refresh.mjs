import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { inspectJournalRoot } from './event-journal.mjs';

const executeFile = promisify(execFile),
  dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const stamp = () => new Date().toISOString();
async function physical(file) {
  if ((await fs.realpath(file)).toLowerCase() !== file.toLowerCase()) throw Error('index-path-alias');
}

/** One Python process holds an OS-released lock through selection, build and publication. */
export async function refreshIndexDay(config, selection, { inspectRoot = inspectJournalRoot, execute = executeFile, timeoutMs = 20000, force = false } = {}) {
  if (!dayPattern.test(selection)) throw Error('index accepts one UTC day YYYY-MM-DD');
  if (typeof config.observability?.python !== 'string' || !path.isAbsolute(config.observability.python)) throw Error('Pinned Python executable required');
  const health = await inspectRoot(config);
  if (!health.healthy) throw Error('Private journal root not verified');
  const args = [fileURLToPath(new URL('./index-refresh.py', import.meta.url)), '--root', config.observability.root, '--day', selection];
  if (force) args.push('--force');
  const output = await execute(config.observability.python, args, {
    windowsHide: true,
    timeout: Math.max(100, Math.min(30000, timeoutMs)),
    maxBuffer: 1048576,
  });
  const value = JSON.parse(output.stdout);
  if (value.schemaVersion !== 1 || !['indexed', 'unchanged', 'busy', 'empty', 'unavailable'].includes(value.status))
    throw Error('Invalid index refresh receipt');
  return value;
}

/** Recover existing recent partitions; no ambient history discovery or provider calls. */
export async function refreshRecentIndexes(config, days = 7, options = {}) {
  if (!Number.isInteger(days) || days < 1 || days > 30) throw Error('refresh-indexes accepts 1..30 UTC days');
  const health = await (options.inspectRoot ?? inspectJournalRoot)(config);
  if (!health.healthy) throw Error('Private journal root not verified');
  const now = options.now ?? Date.now(),
    floor = new Date(now - (days - 1) * 86400000).toISOString().slice(0, 10),
    today = new Date(now).toISOString().slice(0, 10);
  const journalRoot = path.join(config.observability.root, 'journals');
  let entries = [];
  try {
    await physical(journalRoot);
    entries = await fs.readdir(journalRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const selected = entries
      .filter(e => e.isDirectory() && dayPattern.test(e.name) && e.name >= floor && e.name <= today)
      .map(e => e.name)
      .sort()
      .reverse(),
    results = [];
  const started = Date.now();
  for (const day of selected) {
    if (Date.now() - started > 30000) {
      results.push({ selection: day, status: 'deferred', reasonCode: 'refresh-time-bound' });
      continue;
    }
    try {
      results.push(
        await refreshIndexDay(config, day, {
          ...options,
          inspectRoot: async () => health,
          timeoutMs: Math.min(options.timeoutMs ?? 20000, Math.max(100, 30000 - (Date.now() - started))),
        }),
      );
    } catch {
      results.push({ selection: day, status: 'unavailable', reasonCode: 'index-refresh-failed' });
    }
  }
  return {
    schemaVersion: 1,
    checkedAt: stamp(),
    status: results.some(r => ['unavailable', 'deferred', 'busy'].includes(r.status)) ? 'partial' : 'ok',
    scope: 'selected-recent-journal-partitions',
    days,
    results,
    providerGenerationCalls: 0,
  };
}

/** Journal path fixes the run's UTC partition even if it closes after midnight. */
export async function refreshClosedJournal(config, journalPath, options = {}) {
  if (config.observability?.enabled !== true || config.observability?.automaticIndexing === false) return { status: 'disabled' };
  if (typeof journalPath !== 'string' || !path.isAbsolute(journalPath) || typeof config.observability?.root !== 'string')
    return { status: 'unavailable', reasonCode: 'journal-path-unavailable' };
  const root = path.join(config.observability.root, 'journals'),
    relative = path.relative(root, journalPath),
    parts = relative.split(path.sep);
  if (parts.length !== 2 || !dayPattern.test(parts[0]) || !parts[1].endsWith('.jsonl') || relative.startsWith('..'))
    return { status: 'unavailable', reasonCode: 'journal-path-outside-scope' };
  try {
    const value = await refreshIndexDay(config, parts[0], { timeoutMs: 5000, ...options });
    return { status: value.status, selection: value.selection, indexedAt: value.indexedAt ?? null, coverageComplete: value.coverageComplete ?? false };
  } catch {
    return { status: 'unavailable', reasonCode: 'index-refresh-failed' };
  }
}
