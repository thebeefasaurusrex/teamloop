import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { buildCalibrationReport, calibrateSelectedMetadata } from '../src/calibrate-accounting.mjs';
const payload = 'a'.repeat(64);
const sample = () => ({
  id: 'sample',
  provider: 'codex',
  requestedModel: 'gpt-6.1-sol',
  inputMeasurement: {
    provider: 'codex',
    model: 'gpt-6.1-sol',
    tokens: 12,
    visibleBytes: 48,
    scope: 'visible-text-only',
    method: 'local-tokenizer-estimate',
    payloadSha256: payload,
  },
  referenceMeasurement: {
    provider: 'codex',
    model: 'gpt-6.1-sol',
    tokens: 10,
    scope: 'visible-text-only',
    hiddenInputIncluded: false,
    authority: 'provider-tokenizer',
    payloadSha256: payload,
  },
});
test('native full input never becomes fabricated visible-text calibration', () => {
  const record = sample();
  delete record.referenceMeasurement;
  record.usageObservations = [{ authoritative: true, usage: { input: 1000 } }];
  record.prompt = 'private raw text';
  const report = buildCalibrationReport([record]);
  assert.equal(report.comparableSamples, 0);
  assert.equal(report.status, 'insufficient-comparable-evidence');
  assert.equal(report.samples[0].nativeInputTokens, 1000);
  assert.ok(!JSON.stringify(report).includes('private raw text'));
});
test('only matched payload, model, authority and visible scope enter descriptive groups', () => {
  const valid = sample(),
    wrongModel = sample(),
    wrongHash = sample(),
    wrongScope = sample();
  wrongModel.referenceMeasurement.model = 'other';
  wrongHash.referenceMeasurement.payloadSha256 = 'b'.repeat(64);
  wrongScope.referenceMeasurement.scope = 'request';
  const report = buildCalibrationReport([valid, wrongModel, wrongHash, wrongScope]);
  assert.equal(report.comparableSamples, 1);
  assert.equal(report.groups[0].meanAbsoluteErrorTokens, 2);
  assert.equal(report.subscriptionConversion, false);
  assert.equal(report.automaticTuningApplied, false);
});
test('duplicate identical payloads do not inflate calibration evidence; zero reference avoids infinity', () => {
  const first = sample(),
    second = sample(),
    zero = sample();
  zero.inputMeasurement.payloadSha256 = 'c'.repeat(64);
  zero.referenceMeasurement.payloadSha256 = 'c'.repeat(64);
  zero.referenceMeasurement.tokens = 0;
  const report = buildCalibrationReport([first, second, zero]);
  assert.equal(report.comparableSamples, 2);
  assert.ok(report.samples[1].reasonCodes.includes('duplicate-payload-sample'));
  assert.equal(report.samples[2].relativeError, null);
});
test('selected file manifests pin hashes and reject source drift without following other files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teamloop-calibration-'));
  try {
    const file = path.join(root, 'metadata.json'),
      text = JSON.stringify(sample());
    await fs.writeFile(file, text);
    const manifest = { schemaVersion: 1, files: [{ path: file, sha256: createHash('sha256').update(text).digest('hex') }] };
    assert.equal((await calibrateSelectedMetadata(manifest)).comparableSamples, 1);
    await fs.writeFile(file, '{}');
    await assert.rejects(calibrateSelectedMetadata(manifest), /drift/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
