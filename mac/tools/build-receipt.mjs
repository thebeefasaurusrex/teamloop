import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const app = path.join(dist, 'TeamLoop.app');
const resources = path.join(app, 'Contents', 'Resources');
const coreLog = await fs.readFile(process.env.TEAMLOOP_CORE_TAP, 'utf8');
const nativeLog = await fs.readFile(process.env.TEAMLOOP_NATIVE_LOG, 'utf8');
const portableTestsPassed = Number(coreLog.match(/^# pass (\d+)$/m)?.[1]);
assert.ok(portableTestsPassed > 0);
assert.match(coreLog, /^# fail 0$/m);
const nativeCounts = [...nativeLog.matchAll(/Executed (\d+) tests?, with 0 failures/g)].map(x => Number(x[1]));
assert.ok(nativeCounts.length && Math.max(...nativeCounts) > 0, 'Missing successful XCTest summary');
const nativeTestsPassed = Math.max(...nativeCounts);
const plist = await fs.readFile(path.join(app, 'Contents', 'Info.plist'), 'utf8');
const version = plist.match(/CFBundleShortVersionString<\/key>\s*<string>([^<]+)/)?.[1];
const build = plist.match(/CFBundleVersion<\/key>\s*<string>([^<]+)/)?.[1];
const executable = await fs.readFile(path.join(app, 'Contents', 'MacOS', 'TeamLoopMac'));
assert.equal(executable.readUInt32LE(0), 0xfeedfacf);
assert.equal(executable.readUInt32LE(4), 0x0100000c);
for (const name of ['TEAMLOOP-LICENSE.txt', 'TEAMLOOP-NOTICE.txt', 'runtime/NODE-LICENSE.txt']) await fs.access(path.join(resources, name));
let bundledCoreFilesMatched = 0;
for (const name of await fs.readdir(path.join(root, 'core'))) {
  if (!name.endsWith('.mjs')) continue;
  assert.deepEqual(await fs.readFile(path.join(root, 'core', name)), await fs.readFile(path.join(resources, 'core', name)));
  bundledCoreFilesMatched++;
}
const zip = await fs.readFile(path.join(dist, 'TeamLoop-macos-arm64.zip'));
const repository = process.env.GITHUB_REPOSITORY;
assert.equal(repository, 'thebeefasaurusrex/teamloop');
const receipt = {
  schemaVersion: 1,
  version,
  build,
  status: 'hosted-build-passed',
  sourceCommit: process.env.GITHUB_SHA,
  workflowURL: `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  target: { architecture: 'arm64', minimumMacOS: '14.0' },
  archive: { file: 'TeamLoop-macos-arm64.zip', bytes: zip.length, sha256: createHash('sha256').update(zip).digest('hex') },
  portableTestsPassed,
  nativeTestsPassed,
  bundledCoreFilesMatched,
  packagedRuntimeCoreSmoke: 'passed',
  archiveIntegrity: 'passed',
  codesignStrictDeep: 'passed, ad-hoc',
  notarized: false,
  releaseGates: {
    cleanStandardUserAcceptance: false,
    realProviderAndModelAcceptance: false,
    liveQuotaAccuracy: false,
    nativeNotificationLifecycleAcceptance: false,
    deployedRelayAndInboxDelivery: false,
  },
  privacy: 'Built from the public source export; no private history, account information, screenshots, raw task material or preconfigured recipient.',
};
await fs.writeFile(path.join(dist, 'PUBLIC-BUILD.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
