import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = JSON.parse(await fs.readFile(path.join(root, 'release-files.json'), 'utf8'));
if (
  !Array.isArray(files) ||
  new Set(files).size !== files.length ||
  files.some(f => typeof f !== 'string' || !f || path.isAbsolute(f) || f.split('/').some(part => ['..', '.', ''].includes(part)) || f.includes('\\'))
)
  throw Error('Invalid explicit release allowlist');
const allowed = new Set(files);
const ignoredDirectories = new Set(['.git', 'node_modules', '.teamloop']);
const errors = [];
async function inventory(folder = '') {
  for (const item of await fs.readdir(path.join(root, folder), { withFileTypes: true })) {
    const relative = folder ? folder + '/' + item.name : item.name;
    if (item.name === '.git') continue;
    if (item.isSymbolicLink()) {
      errors.push('Symlink not allowed: ' + relative);
      continue;
    }
    if (item.isDirectory()) {
      if (!ignoredDirectories.has(item.name)) await inventory(relative);
    } else if (!allowed.has(relative) && !relative.endsWith('.local.json')) errors.push('Unlisted file: ' + relative);
  }
}
await inventory();
const receipts = [];
const secret = /\b(?:nvapi-[A-Za-z0-9_-]{20,}|sk-(?:ant-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{30,})\b/;
const privatePath = /[A-Z]:[\\/]+Users[\\/]+(?!example(?:[\\/\s"'<>]|$))[^\s"'<>]+/i;
// Any email address that is not a documentation placeholder or a GitHub no-reply address is a personal identifier.
const emailAddress = /\b[A-Za-z0-9._%+-]+@(?!example\.(?:test|com|org|net)\b)(?!users\.noreply\.github\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
for (const name of files) {
  const absolute = path.join(root, name);
  let bytes;
  try {
    const stat = await fs.lstat(absolute);
    const real = await fs.realpath(absolute);
    if (!stat.isFile() || !real.startsWith(root + path.sep)) throw Error('not a contained regular file');
    bytes = await fs.readFile(absolute);
  } catch {
    errors.push('Missing or unsafe release file: ' + name);
    continue;
  }
  const extension = path.extname(name).toLowerCase();
  const binaryHeaders = {
    '.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    '.ttf': Buffer.from([0, 1, 0, 0]),
    '.woff2': Buffer.from('wOF2'),
  };
  let text = '';
  if (Object.hasOwn(binaryHeaders, extension)) {
    const header = binaryHeaders[extension];
    if (bytes.length <= header.length || !bytes.subarray(0, header.length).equals(header)) errors.push('Invalid binary header in ' + name);
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      errors.push('Non-UTF8 file without an approved binary type: ' + name);
    }
  }
  if (secret.test(text)) errors.push('Possible credential in ' + name);
  if (privatePath.test(text)) errors.push('Personal OS path in ' + name);
  if (emailAddress.test(text)) errors.push('Personal email address in ' + name + ': ' + text.match(emailAddress)[0].replace(/^(.).*(@.*)$/, '$1***$2'));
  if (text.includes(String.fromCharCode(0x2014))) errors.push('Em dash in ' + name);
  if (name.endsWith('.md'))
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      const resolved = path.resolve(path.dirname(absolute), decodeURIComponent(target));
      const relative = path.relative(root, resolved).split(path.sep).join('/');
      if (!allowed.has(relative)) errors.push('Unlisted or missing Markdown target in ' + name + ': ' + target);
    }
  receipts.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify(
      {
        status: 'passed',
        files: receipts.length,
        totalBytes: receipts.reduce((sum, f) => sum + f.bytes, 0),
        limits:
          'Allowlist and text-pattern checks are not proof of absence of every secret. PNG/TTF/WOFF2 files receive signature and hash checks, not text screening or complete format validation; inspect their source and rendered content separately.',
        manifest: receipts,
      },
      null,
      2,
    ),
  );
