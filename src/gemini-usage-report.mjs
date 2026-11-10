/** Qualified Antigravity 1.5.0 CLI-handled /usage metadata, never a generation prompt. */

const QUALIFIED_VERSION = '1.5.0';
const nativeGroups = new Map([
  ['Gemini Models', 'gemini-models'],
  ['Claude and GPT models', 'claude-and-gpt-models'],
  ['Gemini 4 Argon', 'gemini-4-argon'],
]);
const unavailable = (reasonCode, observedAt = new Date().toISOString()) => ({
  schemaVersion: 1,
  status: 'unavailable',
  provider: 'gemini',
  reasonCode,
  buckets: [],
  observedAt,
  transport: 'antigravity-cli-usage',
  scope: 'shared-account',
  perRunAttribution: false,
  weeklyTokenConversion: false,
});

/** Strict grammar captured from the first-party 1.5.0 /usage report; no guessed text scraping. */
export function parseGeminiUsageReport(text, { observedAt = new Date().toISOString(), clientVersion = QUALIFIED_VERSION } = {}) {
  if (clientVersion !== QUALIFIED_VERSION) return unavailable('client-version-not-qualified', observedAt);
  if (typeof text !== 'string' || Buffer.byteLength(text) > 262144) return unavailable('usage-report-size-invalid', observedAt);
  if (!Number.isFinite(Date.parse(observedAt))) return unavailable('observation-time-invalid', null);
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (!lines.length || lines.length > 32) return unavailable('usage-report-shape-unavailable', observedAt);
  const buckets = [],
    seen = new Map();
  let ambiguousRows = 0;
  for (const line of lines) {
    const columns = line.split('\t');
    if (columns.length !== 4) return unavailable('usage-report-shape-unavailable', observedAt);
    const [group, windowName, percentage, reset] = columns,
      bucketId = nativeGroups.get(group);
    if (
      !bucketId ||
      !/^(?:100(?:\.0+)?|[0-9]{1,2}(?:\.[0-9]+)?)%$/.test(percentage) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(reset) ||
      !Number.isFinite(Date.parse(reset)) ||
      new Date(reset).toISOString().replace('.000Z', 'Z') !== reset
    )
      return unavailable('usage-report-field-unqualified', observedAt);
    let window, windowDurationMins, direction;
    if (windowName === 'Weekly Limit Remaining') {
      window = 'weekly';
      windowDurationMins = 10080;
      direction = 'remaining';
    } else if (windowName === 'Five Hour Limit Remaining') {
      window = 'five-hour';
      windowDurationMins = 300;
      direction = 'remaining';
    } else if (group === 'Gemini 4 Argon' && windowName === 'Gemini 4 Argon Weekly Limit') {
      window = 'weekly';
      windowDurationMins = 10080;
      direction = 'unspecified';
    } else return unavailable('usage-window-unqualified', observedAt);
    const reportedPercent = Number(percentage.slice(0, -1)),
      key = bucketId + '/' + window;
    const bucket = {
      bucketId,
      window,
      unit: direction === 'remaining' ? 'percent-used' : 'percent-unknown-direction',
      usedPercent: direction === 'remaining' ? 100 - reportedPercent : null,
      remainingPercent: direction === 'remaining' ? reportedPercent : null,
      reportedPercent,
      nativePercentageDirection: direction,
      derivation: direction === 'remaining' ? '100-minus-native-remaining-percent' : null,
      windowDurationMins,
      resetsAt: Date.parse(reset) / 1000,
    };
    if (seen.has(key)) {
      if (JSON.stringify(seen.get(key)) !== JSON.stringify(bucket)) return unavailable('conflicting-quota-rows', observedAt);
      continue;
    }
    seen.set(key, bucket);
    buckets.push(bucket);
    if (direction === 'unspecified') ambiguousRows++;
  }
  if (!buckets.some(bucket => bucket.usedPercent !== null)) return unavailable('quota-direction-unavailable', observedAt);
  return {
    schemaVersion: 1,
    status: 'observed',
    provider: 'gemini',
    observedAt: new Date(observedAt).toISOString(),
    transport: 'antigravity-cli-usage',
    clientVersion: QUALIFIED_VERSION,
    accountAlias: 'personal-gemini',
    scope: 'shared-account',
    perRunAttribution: false,
    weeklyTokenConversion: false,
    coverage: ambiguousRows ? 'partial' : 'observed-report',
    ...(ambiguousRows ? { reasonCode: 'native-percentage-direction-unknown' } : {}),
    unknownDirectionBuckets: ambiguousRows,
    buckets,
  };
}

/** Existing personal identity/settings gates remain mandatory before and after the read. */
