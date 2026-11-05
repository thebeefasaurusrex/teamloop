/** Optional local reference counts; no provider client, network, auth or runtime install. */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';

const engines = {
  claude: { engine: 'anthropic-legacy-tokenizer', version: '0.0.4', referenceModel: 'claude-legacy' },
  gemini: { engine: 'google-sentencepiece-gemma3', version: '0.2.2', referenceModel: 'gemini-2.5-flash' },
};
const sha = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
async function verify(file, expected) {
  if (!path.isAbsolute(file) || !sha(expected) || (await fs.realpath(file)).toLowerCase() !== path.resolve(file).toLowerCase()) throw Error('pin');
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 268435456) throw Error('pin');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw Error('integrity');
}
export async function countOfflineReference(text, { provider, model, descriptor, timeoutMs = 10000, launch = spawn } = {}) {
  const expected = engines[provider];
  if (!expected || descriptor?.enabled !== true) return null;
  const unavailable = reasonCode => ({
    status: 'unavailable',
    tokens: null,
    ...expected,
    scope: 'visible-text-only',
    verifiedForRequestedModel: false,
    reasonCode,
  });
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1048576) return unavailable('counter-input-bound');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 15000) return unavailable('counter-timeout-invalid');
  let child, timer;
  try {
    if (Object.keys(expected).some(key => descriptor[key] !== expected[key])) throw Error('descriptor');
    await Promise.all(
      [
        [descriptor.executable, descriptor.executableSha256],
        [descriptor.helper, descriptor.helperSha256],
        [descriptor.pinFile, descriptor.pinSha256],
      ].map(([file, hash]) => verify(file, hash)),
    );
  } catch {
    return unavailable('counter-integrity-unavailable');
  }
  try {
    const args = provider === 'gemini' ? ['-I', '-S', descriptor.helper, descriptor.pinFile] : [descriptor.helper, descriptor.pinFile];
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => ['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP'].includes(name.toUpperCase())));
    child = launch(descriptor.executable, args, { env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    return await new Promise(resolve => {
      let stdout = '',
        bytes = 0,
        settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      timer = setTimeout(() => {
        child.kill();
        finish(unavailable('counter-timeout'));
      }, timeoutMs);
      child.on('error', () => finish(unavailable('counter-unavailable')));
      child.stdin.on('error', () => {});
      child.stderr.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 16384) {
          child.kill();
          finish(unavailable('counter-output-bound'));
        }
      });
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 16384) {
          child.kill();
          finish(unavailable('counter-output-bound'));
        } else stdout += chunk;
      });
      child.on('close', code => {
        if (code !== 0) return finish(unavailable('counter-unavailable'));
        try {
          const parsed = JSON.parse(stdout),
            value = parsed.referenceCount;
          if (
            parsed.status !== 'observed' ||
            !value ||
            value.status !== 'observed' ||
            !Number.isSafeInteger(value.tokens) ||
            value.tokens < 0 ||
            Object.keys(expected).some(key => value[key] !== expected[key]) ||
            (value.verifiedForRequestedModel !== false &&
              !(value.verifiedForRequestedModel === true && provider === 'gemini' && model === expected.referenceModel)) ||
            value.scope !== 'visible-text-only'
          )
            throw Error('counter-contract');
          finish({
            status: 'observed',
            tokens: value.tokens,
            ...expected,
            scope: 'visible-text-only',
            verifiedForRequestedModel: false,
            mappingStatus: 'unverified-model-mapping',
            warningCode: provider === 'claude' ? 'legacy-tokenizer-inaccurate-current-claude' : 'reference-tokenizer-not-requested-model',
            ...(provider === 'claude' ? { normalization: 'NFKC', specialTokens: 'legacy-library-recognized' } : {}),
            pinSha256: descriptor.pinSha256,
          });
        } catch {
          finish(unavailable('counter-contract-unavailable'));
        }
      });
      child.stdin.end(JSON.stringify({ text, requestedModel: typeof model === 'string' ? model.slice(0, 160) : null }));
    });
  } catch {
    return unavailable('counter-unavailable');
  } finally {
    clearTimeout(timer);
    try {
      child?.stdin.end();
      if (child?.exitCode === null) child.kill();
    } catch {}
  }
}
