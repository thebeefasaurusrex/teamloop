import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const file = args[0] === 'route' ? 'route.mjs' : 'team-loop.mjs';
if (args[0] === 'route') args.shift();
const result = spawnSync(process.execPath, [fileURLToPath(new URL('./runtime/' + file, import.meta.url)), ...args], {
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
});
if (result.error) {
  console.error(result.error.message);
  process.exitCode = 1;
} else process.exitCode = result.status ?? 1;
