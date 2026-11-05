import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { countOfflineReference } from '../src/offline-reference.mjs';
import { measurePayload } from '../src/accounting.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t, body) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tl-reference-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const helper = path.join(root, 'helper.cjs'),
    pinFile = path.join(root, 'pin.json');
  await fs.writeFile(
    helper,
    body ||
      `let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>process.stdout.write(JSON.stringify({status:'observed',referenceCount:{status:'observed',tokens:0,engine:'anthropic-legacy-tokenizer',version:'0.0.4',referenceModel:'claude-legacy',scope:'visible-text-only',verifiedForRequestedModel:false}})));`,
  );
  await fs.writeFile(pinFile, '{}');
  return {
    enabled: true,
    engine: 'anthropic-legacy-tokenizer',
    version: '0.0.4',
    referenceModel: 'claude-legacy',
    executable: process.execPath,
    executableSha256: hash(await fs.readFile(process.execPath)),
    helper,
    helperSha256: hash(await fs.readFile(helper)),
    pinFile,
    pinSha256: hash(await fs.readFile(pinFile)),
  };
}
test('offline references keep known zero separate from requested-model tokens', async t => {
  const descriptor = await fixture(t),
    localTokenizers = { claude: descriptor };
  const value = await measurePayload('', { provider: 'claude', model: 'claude-sonnet-5-5', localTokenizers });
  assert.equal(value.visibleBytes, 0);
  assert.equal(value.tokens, null);
  assert.equal(value.mappingStatus, 'unverified');
  assert.equal(value.referenceCount.tokens, 0);
  assert.equal(value.referenceCount.verifiedForRequestedModel, false);
  assert.equal(value.referenceCount.normalization, 'NFKC');
});
test('pin drift stops execution without erasing exact visible measurements', async t => {
  const descriptor = await fixture(t);
  await fs.appendFile(descriptor.helper, '// drift');
  let launched = false;
  const ref = await countOfflineReference('hello', {
    provider: 'claude',
    descriptor,
    launch: () => {
      launched = true;
    },
  });
  assert.equal(ref.reasonCode, 'counter-integrity-unavailable');
  assert.equal(launched, false);
  const measured = await measurePayload('🙂', { provider: 'claude', model: 'current', localTokenizers: { claude: descriptor } });
  assert.equal(measured.visibleBytes, 4);
  assert.equal(measured.referenceCount.tokens, null);
  assert.equal(measured.tokens, null);
});
test('current-model exactness claims from a helper are rejected', async t => {
  const descriptor = await fixture(
    t,
    `process.stdout.write(JSON.stringify({status:'observed',referenceCount:{status:'observed',tokens:99,engine:'anthropic-legacy-tokenizer',version:'0.0.4',referenceModel:'claude-legacy',scope:'visible-text-only',verifiedForRequestedModel:true}}));`,
  );
  const value = await countOfflineReference('text', { provider: 'claude', descriptor });
  assert.equal(value.tokens, null);
  assert.equal(value.reasonCode, 'counter-contract-unavailable');
});
test('input limits are explicit rather than silently truncating reference text', async t => {
  const descriptor = await fixture(t);
  let launched = false;
  const value = await countOfflineReference('a'.repeat(1048577), {
    provider: 'claude',
    descriptor,
    launch: () => {
      launched = true;
    },
  });
  assert.equal(value.reasonCode, 'counter-input-bound');
  assert.equal(launched, false);
});
test('counter timeouts and oversized output stay optional and sanitized', async t => {
  const slow = await fixture(t, `setTimeout(()=>{},30000);`);
  assert.equal((await countOfflineReference('x', { provider: 'claude', descriptor: slow, timeoutMs: 100 })).reasonCode, 'counter-timeout');
  const noisy = await fixture(t, `process.stdout.write('PRIVATE'.repeat(10000));`);
  const value = await countOfflineReference('x', { provider: 'claude', descriptor: noisy });
  assert.equal(value.reasonCode, 'counter-output-bound');
  assert.ok(!JSON.stringify(value).includes('PRIVATE'));
});
test('disabled and unknown providers do not launch a counter', async () => {
  assert.equal(await countOfflineReference('x', { provider: 'claude', descriptor: { enabled: false } }), null);
  assert.equal(await countOfflineReference('x', { provider: 'unknown', descriptor: { enabled: true } }), null);
});
