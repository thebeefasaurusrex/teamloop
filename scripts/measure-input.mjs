import fs from 'node:fs/promises';
import { loadConfig } from '../src/config.mjs';
import { measurePayload } from '../src/accounting.mjs';

const [configFile, provider, model, filename] = process.argv.slice(2);
try {
  if (process.argv.length !== 6 || !['claude', 'gemini', 'codex'].includes(provider)) {
    throw Error('Usage: node scripts/measure-input.mjs CONFIG PROVIDER MODEL TEXT_FILE');
  }
  const config = await loadConfig(configFile);
  const file = await fs.open(filename, 'r');
  let text;
  try {
    const buffer = Buffer.alloc(1048577);
    if (!(await file.stat()).isFile()) throw Error('Expected a regular file');
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!chunk.bytesRead) break;
      bytesRead += chunk.bytesRead;
    }
    if (bytesRead > 1048576) throw Error('Text exceeds 1 MiB');
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, bytesRead));
  } finally {
    await file.close();
  }
  const result = await measurePayload(text, {
    provider,
    model,
    tokenizerPin: config.observability?.tokenizerPin,
    localTokenizers: config.observability?.localTokenizers,
  });
  console.log(JSON.stringify(result, null, 2));
} catch {
  console.error('Measurement unavailable. Check the configuration, provider, and selected UTF-8 file (up to 1 MiB).');
  process.exitCode = 1;
}
