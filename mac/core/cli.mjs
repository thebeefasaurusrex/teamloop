import { action } from './service.mjs';
import { cleanError } from './policy.mjs';
const abort = new AbortController();
process.once('SIGTERM', () => abort.abort());
process.once('SIGINT', () => abort.abort());
try {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 3 * 1024 * 1024) throw Error('IPC request too large');
  }
  const request = input.trim() ? JSON.parse(input) : {};
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw Error('Invalid IPC request');
  const result = await action(process.argv[2] ?? 'snapshot', request, { signal: abort.signal });
  process.stdout.write(JSON.stringify(result) + '\n');
} catch (e) {
  process.stdout.write(JSON.stringify({ error: cleanError(e) }) + '\n');
  process.exitCode = 1;
}
