import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function summarize(rows) {
  if (!Array.isArray(rows)) throw Error('Expected attempt rows');
  const ids = new Set();
  for (const row of rows) {
    if (
      !row ||
      ['attemptId', 'taskId', 'configurationId', 'requestedModel', 'effort', 'notes'].some(k => typeof row[k] !== 'string' || !row[k]) ||
      ids.has(row.attemptId) ||
      !/^\d{4}-\d{2}-\d{2}T/.test(row.date) ||
      !Number.isFinite(Date.parse(row.date)) ||
      !/^[a-f0-9]{64}$/.test(row.packetHash)
    )
      throw Error('Invalid or duplicate attempt identity');
    ids.add(row.attemptId);
    if (
      !['completed', 'failed', 'not-started'].includes(row.delivery) ||
      !['unassisted', 'assisted', 'salvage'].includes(row.mode) ||
      !['passed', 'failed', 'not-run', 'not-applicable'].includes(row.verification) ||
      !['none', 'harness', 'provider', 'worker', 'unknown'].includes(row.failureAttribution)
    )
      throw Error('Invalid attempt classification');
    if (
      !Number.isSafeInteger(row.timeoutMs) ||
      row.timeoutMs < 1 ||
      !Number.isSafeInteger(row.elapsedMs) ||
      row.elapsedMs < 0 ||
      !(row.reportedModel === null || typeof row.reportedModel === 'string')
    )
      throw Error('Invalid timing or model identity');
    if (
      !(row.score === null || (typeof row.score === 'number' && Number.isFinite(row.score) && row.score >= 0 && row.score <= 100)) ||
      (row.delivery !== 'completed' && row.score !== null)
    )
      throw Error('Scores require completed delivery; use a separate salvage row');
    if (row.mode === 'unassisted' ? row.parentAttemptId !== null : typeof row.parentAttemptId !== 'string')
      throw Error('Assisted/salvage rows require a parent attempt');
    if (
      row.usage !== null &&
      (!row.usage ||
        typeof row.usage !== 'object' ||
        ['inputTokens', 'outputTokens'].some(k => !(row.usage[k] === null || (Number.isSafeInteger(row.usage[k]) && row.usage[k] >= 0))))
    )
      throw Error('Invalid usage: unknown counts must be null');
  }
  for (const row of rows)
    if (row.parentAttemptId !== null && (!ids.has(row.parentAttemptId) || row.parentAttemptId === row.attemptId))
      throw Error('Missing or self-referencing parent attempt');
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.taskId, row.configurationId, row.mode]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map(attempts => {
    const dispatched = attempts.filter(a => a.delivery !== 'not-started');
    const completed = dispatched.filter(a => a.delivery === 'completed');
    const allScored = completed.every(a => a.score !== null);
    const sum = completed.reduce((s, a) => s + (a.score ?? 0), 0);
    const mean = (total, n) => (n ? Math.round(total / n) : null);
    return {
      taskId: attempts[0].taskId,
      configurationId: attempts[0].configurationId,
      mode: attempts[0].mode,
      attempts: dispatched.length,
      notStarted: attempts.length - dispatched.length,
      completed: completed.length,
      reliabilityPercent: mean(completed.length * 100, dispatched.length),
      completedWorkMean: allScored ? mean(sum, completed.length) : null,
      reliabilityAdjustedMean: allScored ? mean(sum, dispatched.length) : null,
      strictVerifiedDeliveryMean: allScored
        ? mean(
            completed.filter(a => a.verification === 'passed').reduce((s, a) => s + a.score, 0),
            dispatched.length,
          )
        : null,
      raw: attempts,
    };
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(summarize(JSON.parse(await fs.readFile(process.argv[2], 'utf8'))), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
