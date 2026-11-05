import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = 'node_modules/@anthropic-ai/tokenizer';
const wasmRoot = 'node_modules/tiktoken';
const read = name => fs.readFile(path.join(root, name));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (JSON.parse(await read(packageRoot + '/package.json')).version !== '0.0.4' || JSON.parse(await read(wasmRoot + '/package.json')).version !== '1.0.22') {
  throw Error('Install the qualified versions first');
}
const engine = 'anthropic-legacy-tokenizer';
const version = '0.0.4';
const referenceModel = 'claude-legacy';
const files = [
  'package.json',
  'package-lock.json',
  packageRoot + '/package.json',
  packageRoot + '/dist/cjs/index.js',
  packageRoot + '/dist/cjs/claude.json',
  wasmRoot + '/package.json',
  wasmRoot + '/lite/tiktoken.cjs',
  wasmRoot + '/lite/tiktoken_bg.cjs',
  wasmRoot + '/lite/tiktoken_bg.wasm',
];
const pin = JSON.stringify(
  { schemaVersion: 1, engine, version, referenceModel, files: await Promise.all(files.map(async name => ({ path: name, sha256: sha(await read(name)) }))) },
  null,
  2,
);
const pinFile = path.join(root, 'engine-pin.json');
await fs.writeFile(pinFile, pin, { flag: 'wx' });
const executable = await fs.realpath(process.execPath);
const helper = path.join(root, 'count-reference.cjs');
console.log(
  JSON.stringify(
    {
      enabled: true,
      engine,
      version,
      referenceModel,
      executable,
      executableSha256: sha(await fs.readFile(executable)),
      helper,
      helperSha256: sha(await fs.readFile(helper)),
      pinFile,
      pinSha256: sha(pin),
    },
    null,
    2,
  ),
);
