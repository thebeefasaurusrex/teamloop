import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const findings = [];
const files = [];
async function walk(folder) {
  for (const e of await fs.readdir(folder, { withFileTypes: true })) {
    const p = path.join(folder, e.name);
    if (e.isDirectory()) await walk(p);
    else files.push(p);
  }
}
for (const name of ['core', 'Sources', 'relay']) await walk(path.join(root, name));
for (const file of files) {
  const text = await fs.readFile(file, 'utf8');
  const rel = path.relative(root, file);
  if (/(?:C:[/\\]Users|taskkill\.exe|powershell(?:\.exe)?|cmd\.exe|SystemRoot|USERPROFILE|HOMEDRIVE|HOMEPATH)/i.test(text))
    findings.push(`${rel}: foreign platform dependency`);
  if (/billingCheckedAt|recentAttestation|claudeUsageCreditsOff/.test(text)) findings.push(`${rel}: removed daily maintenance mechanism returned`);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) || /\b(?:sk-ant-[A-Za-z0-9_-]{35,}|nvapi-[A-Za-z0-9_-]{35,})/.test(text))
    findings.push(`${rel}: secret-like source material`);
  if (file.endsWith('.mjs')) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) findings.push(`${rel}: JavaScript syntax invalid`);
  }
}
for (const required of ['Package.swift', 'Sources/TeamLoopMac/TeamLoopApp.swift', 'core/cli.mjs', 'core/policy.mjs']) {
  try {
    await fs.access(path.join(root, required));
  } catch {
    findings.push(`Missing ${required}`);
  }
}
const native = files.filter(f => f.endsWith('.swift')).map(f => path.relative(root, f));
const result = {
  status: findings.length ? 'failed' : 'passed',
  filesChecked: files.length,
  nativeSourceFiles: native,
  findings,
  nativeCompilation: 'not performed by this audit',
  liveProviders: 'not contacted',
  email: 'not sent',
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (findings.length) process.exitCode = 1;
