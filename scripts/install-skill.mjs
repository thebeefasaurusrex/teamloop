import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args[0] !== '--dest' || args.length !== 2)) throw Error('Usage: node scripts/install-skill.mjs [--dest <new-skill-folder>]');
const destination = path.resolve(args[1] ?? path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills', 'team-loop'));
// Exclusive creation protects an existing personal installation, including empty folders.
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.mkdir(destination);
const skill = path.join(root, 'skills', 'team-loop');
for (const name of ['SKILL.md', 'references', 'scripts'])
  await fs.cp(path.join(skill, name), path.join(destination, name), { recursive: true, errorOnExist: true, force: false });
for (const name of ['LICENSE', 'NOTICE']) await fs.cp(path.join(root, name), path.join(destination, name), { errorOnExist: true, force: false });
await fs.cp(path.join(root, 'src'), path.join(destination, 'scripts', 'runtime'), { recursive: true, errorOnExist: true, force: false });
console.log(JSON.stringify({ installed: destination, note: 'No login, model call, provider-settings edit, or background service was started.' }, null, 2));
