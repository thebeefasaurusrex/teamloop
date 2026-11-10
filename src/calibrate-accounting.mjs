/** Selected metadata only. Never reads prompts, invokes a provider, or tunes allowance conversion. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { findSecretPattern } from './shared.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const valid = value => Number.isSafeInteger(value) && value >= 0;
const label = value => (typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,160}$/.test(value) && !findSecretPattern(value) ? value : null);
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function buildCalibrationReport(records) {
  if (!Array.isArray(records) || records.length > 256) throw Error('Calibration sample bound exceeded');
  const samples = [],
    groups = new Map(),
    seen = new Set();
  for (const record of records) {
    const measurement = record?.inputMeasurement ?? {},
      reference = record?.referenceMeasurement;
    const id = label(record?.runId ?? record?.id),
      provider = label(measurement.provider ?? record?.provider),
      model = label(measurement.model ?? record?.requestedModel);
    const reasonCodes = [];
    const observation = record?.usageObservations?.findLast?.(item => item.authoritative);
    const sample = {
      id,
      provider,
      model,
      method: label(measurement.method),
      visibleBytes: valid(measurement.visibleBytes) ? measurement.visibleBytes : null,
      estimatedVisibleTokens: valid(measurement.tokens) ? measurement.tokens : null,
      nativeInputTokens: valid(observation?.usage?.input) ? observation.usage.input : null,
      comparable: false,
      reasonCodes,
    };
    if (sample.estimatedVisibleTokens === null) reasonCodes.push('estimate-unavailable');
    if (!reference) reasonCodes.push('scope-matched-reference-unavailable');
    else {
      if (reference.authority !== 'provider-tokenizer') reasonCodes.push('reference-authority-unqualified');
      if (reference.scope !== 'visible-text-only' || measurement.scope !== 'visible-text-only' || reference.hiddenInputIncluded !== false)
        reasonCodes.push('reference-scope-mismatch');
      if (!sha(measurement.payloadSha256) || reference.payloadSha256 !== measurement.payloadSha256) reasonCodes.push('payload-identity-mismatch');
      if (reference.provider !== provider || reference.model !== model) reasonCodes.push('model-identity-mismatch');
      if (!valid(reference.tokens)) reasonCodes.push('reference-tokens-unavailable');
    }
    if (!reasonCodes.length) {
      const tokenizer = measurement.tokenizer ?? {};
      const groupKey = JSON.stringify([
        provider,
        model,
        label(record.transport),
        label(measurement.method),
        label(tokenizer.engine),
        label(tokenizer.version),
        label(tokenizer.encoding),
        sha(tokenizer.treeSha256) ? tokenizer.treeSha256 : null,
      ]);
      const identity = JSON.stringify([groupKey, measurement.payloadSha256]);
      if (seen.has(identity)) reasonCodes.push('duplicate-payload-sample');
      else {
        seen.add(identity);
        sample.comparable = true;
        sample.referenceTokens = reference.tokens;
        sample.errorTokens = measurement.tokens - reference.tokens;
        sample.relativeError = reference.tokens > 0 ? sample.errorTokens / reference.tokens : null;
        if (!groups.has(groupKey))
          groups.set(groupKey, {
            provider,
            model,
            transport: label(record.transport),
            method: label(measurement.method),
            tokenizer: {
              engine: label(tokenizer.engine),
              version: label(tokenizer.version),
              encoding: label(tokenizer.encoding),
              treeSha256: sha(tokenizer.treeSha256) ? tokenizer.treeSha256 : null,
            },
            errors: [],
            relativeErrors: [],
          });
        const group = groups.get(groupKey);
        group.errors.push(sample.errorTokens);
        if (sample.relativeError !== null) group.relativeErrors.push(sample.relativeError);
      }
    }
    // Full provider input and visible estimates remain side by side, never subtracted as tokenizer error.
    samples.push(sample);
  }
  const summaries = [...groups.values()].map(({ errors, relativeErrors, ...group }) => ({
    ...group,
    comparableSamples: errors.length,
    meanAbsoluteErrorTokens: errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length,
    maximumAbsoluteErrorTokens: Math.max(...errors.map(Math.abs)),
    meanAbsoluteRelativeError: relativeErrors.length ? relativeErrors.reduce((sum, value) => sum + Math.abs(value), 0) / relativeErrors.length : null,
  }));
  return {
    schemaVersion: 1,
    status: summaries.length ? 'descriptive-comparison-only' : 'insufficient-comparable-evidence',
    selectedSamples: samples.length,
    comparableSamples: samples.filter(item => item.comparable).length,
    groups: summaries,
    samples,
    automaticTuningApplied: false,
    subscriptionConversion: false,
    fullAccountCoverage: false,
  };
}

export async function calibrateSelectedMetadata(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 256) throw Error('Invalid calibration manifest');
  const records = [],
    sources = [],
    seen = new Set();
  for (const item of manifest.files) {
    if (
      !item ||
      typeof item.path !== 'string' ||
      !path.isAbsolute(item.path) ||
      path.extname(item.path).toLowerCase() !== '.json' ||
      !sha(item.sha256) ||
      seen.has(item.path)
    )
      throw Error('Invalid selected metadata source');
    seen.add(item.path);
    const stat = await fs.stat(item.path);
    if (stat.size > 1048576) throw Error('Selected metadata source too large');
    const first = await fs.readFile(item.path);
    if (hash(first) !== item.sha256) throw Error('Selected metadata source drift');
    const second = await fs.readFile(item.path);
    if (hash(second) !== item.sha256) throw Error('Selected metadata source changed during read');
    records.push(JSON.parse(first.toString('utf8')));
    sources.push({ sha256: item.sha256 });
  }
  return { ...buildCalibrationReport(records), selectedSourceHashes: sources };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node calibrate-accounting.mjs selected-metadata-manifest.json');
    const source = await fs.readFile(process.argv[2]);
    if (source.length > 262144) throw Error('Manifest too large');
    console.log(JSON.stringify(await calibrateSelectedMetadata(JSON.parse(source.toString('utf8'))), null, 2));
  } catch {
    console.error('Calibration unavailable: invalid, changed, or unsupported selected metadata.');
    process.exitCode = 1;
  }
}
