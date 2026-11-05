import { findSecretPattern } from './shared.mjs';
/** Qualified Claude 2.1.302 local /usage command; no model-turn fallback. */

const QUALIFIED_VERSION = '2.1.302 (Claude Code)';
const key = value => (typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,160}$/.test(value) && !findSecretPattern(value) ? value : null);
const display = value => (typeof value === 'string' && value.length <= 100 && !/[\r\n\0]/.test(value) && !findSecretPattern(value) ? value : null);
const slug = value =>
  value
    ?.toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-|-$/g, '');
const unavailable = (reasonCode, observedAt = new Date().toISOString()) => ({
  schemaVersion: 1,
  status: 'unavailable',
  provider: 'claude',
  reasonCode,
  buckets: [],
  observedAt,
  transport: 'claude-local-usage',
  scope: 'shared-account',
  perRunAttribution: false,
  weeklyTokenConversion: false,
});

export function parseClaudeUsageReport(stdout, { observedAt = new Date().toISOString(), clientVersion = QUALIFIED_VERSION } = {}) {
  if (clientVersion !== QUALIFIED_VERSION) return unavailable('client-version-not-qualified', observedAt);
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 524288 || !Number.isFinite(Date.parse(observedAt)))
    return unavailable('usage-report-invalid', observedAt);
  let events;
  try {
    events = stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch {
    return unavailable('usage-report-json-unavailable', observedAt);
  }
  if (
    !events.length ||
    events.length > 32 ||
    events.some(event => !event || typeof event !== 'object' || !['system', 'assistant', 'result'].includes(event.type))
  )
    return unavailable('unexpected-local-command-protocol', observedAt);
  if (events.some(event => event.message?.content?.some?.(block => block.type === 'tool_use')))
    return unavailable('unexpected-local-command-tool-use', observedAt);
  const terminals = events.filter(event => event.type === 'result'),
    terminal = terminals[0];
  if (terminals.length !== 1 || events.at(-1) !== terminal || terminal.subtype !== 'success' || terminal.is_error !== false || terminal.num_turns !== 0)
    return unavailable('local-command-zero-turn-not-proven', observedAt);
  const usage = terminal.usage ?? {};
  const thinking = [
    usage.thinking_tokens,
    usage.reasoning_tokens,
    usage.output_tokens_details?.thinking_tokens,
    usage.output_tokens_details?.reasoning_tokens,
  ].filter(value => value !== undefined);
  if (
    ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'].some(name => usage[name] !== 0) ||
    thinking.some(value => value !== 0) ||
    Object.values(usage.server_tool_use ?? {}).some(value => value !== 0) ||
    Object.keys(terminal.modelUsage ?? {}).length
  )
    return unavailable('unexpected-local-command-consumption', observedAt);
  const reports = events.flatMap(event => (event.usage_report ? [event.usage_report] : event.message?.usage_report ? [event.message.usage_report] : []));
  if (reports.length !== 1) return unavailable('structured-usage-report-unavailable', observedAt);
  const report = reports[0];
  if (report.session?.total_api_duration_ms !== 0 || Object.keys(report.session?.model_usage ?? {}).length)
    return unavailable('unexpected-local-command-consumption', observedAt);
  if (report.rate_limits?.extra_usage?.is_enabled !== false) return unavailable('paid-overage-off-not-proven', observedAt);
  const limits = report.rate_limits?.limits;
  if (!Array.isArray(limits) || limits.length > 32) return unavailable('native-plan-meters-unavailable', observedAt);
  const buckets = [],
    seen = new Map();
  let omittedRows = 0;
  for (const row of limits) {
    const kind = key(row?.kind),
      group = key(row?.group),
      percent = row?.percent;
    if (!kind || !group || typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
      omittedRows++;
      continue;
    }
    const modelLabel = display(row.scope?.model?.display_name),
      surfaceLabel = display(row.scope?.surface?.display_name);
    // A scoped meter without its scope cannot be merged into a global allowance.
    if ((row.scope?.model?.display_name != null && !modelLabel) || (row.scope?.surface?.display_name != null && !surfaceLabel)) {
      omittedRows++;
      continue;
    }
    const bucketId = [kind, modelLabel ? 'model-' + slug(modelLabel) : null, surfaceLabel ? 'surface-' + slug(surfaceLabel) : null].filter(Boolean).join(':');
    if (!key(bucketId)) {
      omittedRows++;
      continue;
    }
    let resetsAt = null;
    if (row.resets_at !== null && row.resets_at !== undefined) {
      const timestamp = Date.parse(row.resets_at);
      if (typeof row.resets_at !== 'string' || !Number.isFinite(timestamp)) {
        omittedRows++;
        continue;
      }
      resetsAt = Math.floor(timestamp / 1000);
    }
    const bucket = {
      bucketId,
      window: kind,
      unit: 'percent-used',
      usedPercent: percent,
      windowDurationMins: null,
      resetsAt,
      nativeKind: kind,
      nativeGroup: group,
      modelLabel,
      surfaceLabel,
    };
    if (seen.has(bucketId)) {
      if (JSON.stringify(seen.get(bucketId)) !== JSON.stringify(bucket)) return unavailable('conflicting-plan-meter-rows', observedAt);
      continue;
    }
    seen.set(bucketId, bucket);
    buckets.push(bucket);
  }
  if (!buckets.length && limits.length) return unavailable('native-plan-meters-unqualified', observedAt);
  return {
    schemaVersion: 1,
    status: 'observed',
    provider: 'claude',
    observedAt: new Date(observedAt).toISOString(),
    transport: 'claude-local-usage',
    clientVersion: QUALIFIED_VERSION,
    accountAlias: 'personal-claude',
    scope: 'shared-account',
    perRunAttribution: false,
    weeklyTokenConversion: false,
    coverage: omittedRows ? 'partial' : 'observed-report',
    omittedRows,
    ...(omittedRows ? { reasonCode: 'unqualified-native-meter-rows' } : {}),
    zeroModelTurnsVerified: true,
    paidOverageEnabled: false,
    buckets,
  };
}
