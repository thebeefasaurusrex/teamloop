import { createHash } from 'node:crypto';
// Reviewed reference reducer, copied into the Mac product with its regression tests.
export { evaluateQuota, usedFromRemainingFraction } from './quota-policy.mjs';
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const meterIdentity = s => JSON.stringify([s.provider, s.accountId, s.workspaceId ?? '', s.poolId, s.scopeId ?? '', s.windowId]);
export function publicMeter(m) {
  const result = {};
  for (const k of [
    'provider',
    'accountId',
    'workspaceId',
    'poolId',
    'scopeId',
    'windowId',
    'cycleId',
    'cycleConfirmed',
    'availability',
    'observedAtMs',
    'resetsAtMs',
    'usedPercent',
    'label',
    'source',
  ])
    if (m[k] !== undefined) result[k] = m[k];
  return result;
}
