import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node scripts/install-skill.mjs [--host codex|claude] [--dest <new-skill-folder>]';
const args = process.argv.slice(2);
let host = 'codex';
let dest = null;
for (let i = 0; i < args.length; i += 2) {
  const flag = args[i];
  const value = args[i + 1];
  if (value === undefined) throw Error(usage);
  if (flag === '--host' && ['codex', 'claude'].includes(value)) host = value;
  else if (flag === '--dest') dest = value;
  else throw Error(usage);
}
// Codex reads skills from CODEX_HOME (default ~/.codex); Claude Code from CLAUDE_CONFIG_DIR (default ~/.claude).
const home =
  host === 'claude' ? process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude') : process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const destination = path.resolve(dest ?? path.join(home, 'skills', 'team-loop'));
// Exclusive creation protects an existing personal installation, including empty folders.
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.mkdir(destination);
const skill = path.join(root, 'skills', 'team-loop');
// Both hosts share the reference and runner; only the lead's instructions differ.
const skillFile = host === 'claude' ? path.join(root, 'skills', 'team-loop-claude', 'SKILL.md') : path.join(skill, 'SKILL.md');
await fs.cp(skillFile, path.join(destination, 'SKILL.md'), { errorOnExist: true, force: false });
for (const name of ['references', 'scripts'])
  await fs.cp(path.join(skill, name), path.join(destination, name), { recursive: true, errorOnExist: true, force: false });
for (const name of ['LICENSE', 'NOTICE']) await fs.cp(path.join(root, name), path.join(destination, name), { errorOnExist: true, force: false });
await fs.cp(path.join(root, 'src'), path.join(destination, 'scripts', 'runtime'), { recursive: true, errorOnExist: true, force: false });
console.log(
  JSON.stringify({ installed: destination, host, note: 'No login, model call, provider-settings edit, or background service was started.' }, null, 2),
);
