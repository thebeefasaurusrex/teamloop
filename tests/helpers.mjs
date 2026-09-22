// Disposable fixture directories. Removed when the test file finishes unless
// TEAMLOOP_KEEP_FIXTURES=1 is set, in which case their paths are printed for inspection.
import { after } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const created = [];
export const keepFixtures = process.env.TEAMLOOP_KEEP_FIXTURES === '1';

export async function tempDir(prefix) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(folder);
  return folder;
}

after(async () => {
  if (keepFixtures) {
    if (created.length) console.log('Disposable fixtures retained (TEAMLOOP_KEEP_FIXTURES=1):\n  ' + created.join('\n  '));
    return;
  }
  for (const folder of created) await fs.rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
