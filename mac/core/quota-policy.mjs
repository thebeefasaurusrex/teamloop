/** Reference policy only. No provider adapters, persistence, notifications or email. */
export const thresholds = Object.freeze([50, 75, 90]);

function meterKey(s) {
  const ids = ['provider', 'accountId', 'poolId', 'windowId'];
  if (ids.some(k => typeof s[k] !== 'string' || !s[k])) return null;
  if (s.workspaceId != null && typeof s.workspaceId !== 'string') return null;
  if (s.scopeId != null && typeof s.scopeId !== 'string') return null;
  return JSON.stringify([s.provider, s.accountId, s.workspaceId ?? '', s.poolId, s.scopeId ?? '', s.windowId]);
}

/** Inputs must already be mapped by a qualified provider adapter; never infer quota from tokens. */
export function evaluateQuota(previous = {}, snapshot, nowMs, maxAgeMs = 600000) {
  const key = meterKey(snapshot);
  const base = { state: previous, alerts: [], status: 'unknown' };
  if (!key || !Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) return base;
  if (snapshot.availability !== 'available') return { ...base, status: snapshot.availability || 'unknown' };
  if (!Number.isFinite(snapshot.observedAtMs)) return base;
  if (snapshot.observedAtMs > nowMs + 30000) return { ...base, status: 'clock-skew' };
  if (nowMs - snapshot.observedAtMs > maxAgeMs) return { ...base, status: 'stale' };
  if (!Number.isFinite(snapshot.usedPercent) || snapshot.usedPercent < 0) return base;
  if (snapshot.resetsAtMs != null && !Number.isFinite(snapshot.resetsAtMs)) return base;
  // A provider reset timestamp alone is not a trusted cycle identifier. The adapter must
  // reconcile reset corrections, plan changes, earned resets and fresh provider readings.
  const cycle = snapshot.cycleConfirmed === true && typeof snapshot.cycleId === 'string' && snapshot.cycleId ? snapshot.cycleId : 'unconfirmed';
  const old = previous[key];
  if (old && snapshot.observedAtMs < old.observedAtMs) return { ...base, status: 'out-of-order' };
  // Losing cycle metadata cannot re-arm already emitted warnings. A new confirmed
  // cycle can re-arm; an unconfirmed-to-confirmed transition preserves warnings.
  const newConfirmedCycle = cycle !== 'unconfirmed' && old && old.cycle !== 'unconfirmed' && cycle !== old.cycle;
  // A temporarily omitted field must not erase known expiry in the same cycle.
  const resetsAtMs = snapshot.resetsAtMs ?? (old && !newConfirmedCycle ? old.resetsAtMs : null) ?? null;
  if (resetsAtMs != null && resetsAtMs <= nowMs) return { ...base, status: 'refresh-required' };
  const covered = new Set(old && !newConfirmedCycle ? old.covered : []);
  const crossed = thresholds.filter(t => snapshot.usedPercent >= t && !covered.has(t));
  crossed.forEach(t => covered.add(t));
  const record = { cycle: cycle === 'unconfirmed' && old ? old.cycle : cycle, covered: [...covered], observedAtMs: snapshot.observedAtMs, resetsAtMs };
  const alerts = crossed.length
    ? [
        {
          // Fixed metadata allowlist. Never forward a raw adapter payload to notifications/email.
          provider: snapshot.provider,
          accountId: snapshot.accountId,
          workspaceId: snapshot.workspaceId ?? null,
          poolId: snapshot.poolId,
          scopeId: snapshot.scopeId ?? null,
          windowId: snapshot.windowId,
          cycleId: record.cycle,
          threshold: Math.max(...crossed),
          crossed,
          usedPercent: snapshot.usedPercent,
          observedAtMs: snapshot.observedAtMs,
          resetsAtMs,
          budgetKind: snapshot.budgetKind === 'local' ? 'local' : 'provider',
          eventId: JSON.stringify([key, record.cycle, Math.max(...crossed)]),
        },
      ]
    : [];
  const status = cycle === 'unconfirmed' ? 'current-cycle-unknown' : resetsAtMs == null ? 'current-reset-unknown' : 'current';
  return { state: { ...previous, [key]: record }, alerts, status };
}

export function usedFromRemainingFraction(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? Math.round((1 - value) * 100 * 1e9) / 1e9 : null;
}
