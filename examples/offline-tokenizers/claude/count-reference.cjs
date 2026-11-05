/* Offline legacy reference only. This is not the current Claude tokenizer. */
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const fail = () => {
  process.stdout.write(JSON.stringify({ status: 'unavailable', reasonCode: 'counter-unavailable' }));
  process.exitCode = 1;
};
try {
  const pinFile = process.argv[2];
  if (!pinFile || !path.isAbsolute(pinFile)) throw Error('pin');
  const pinBytes = fs.readFileSync(pinFile);
  if (pinBytes.length > 65536) throw Error('pin');
  const pin = JSON.parse(pinBytes);
  if (pin.engine !== 'anthropic-legacy-tokenizer' || pin.version !== '0.0.4' || !Array.isArray(pin.files) || pin.files.length > 128) throw Error('pin');
  const root = path.resolve(__dirname);
  let total = 0;
  for (const item of pin.files) {
    if (typeof item.path !== 'string' || path.isAbsolute(item.path) || item.path.split(/[\\/]/).includes('..')) throw Error('pin');
    const file = path.join(root, item.path);
    if (fs.realpathSync(file).toLowerCase() !== file.toLowerCase()) throw Error('alias');
    const bytes = fs.readFileSync(file);
    total += bytes.length;
    if (total > 16777216 || crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw Error('integrity');
  }
  // Deny every network/process API used by these audited local dependencies before loading them.
  const denied = () => {
    throw Error('offline-only');
  };
  const net = require('node:net'),
    tls = require('node:tls'),
    http = require('node:http'),
    https = require('node:https'),
    http2 = require('node:http2'),
    dns = require('node:dns'),
    cp = require('node:child_process');
  net.Socket.prototype.connect = denied;
  net.connect = net.createConnection = denied;
  tls.connect = denied;
  for (const mod of [http, https]) mod.request = mod.get = denied;
  http2.connect = denied;
  for (const key of Object.keys(dns)) if (typeof dns[key] === 'function' && /^(lookup|resolve|reverse)/.test(key)) dns[key] = denied;
  for (const key of Object.keys(dns.promises)) if (typeof dns.promises[key] === 'function') dns.promises[key] = denied;
  for (const key of ['spawn', 'exec', 'execFile', 'fork', 'spawnSync', 'execSync', 'execFileSync']) cp[key] = denied;
  globalThis.fetch = denied;
  globalThis.WebSocket = class {
    constructor() {
      denied();
    }
  };
  let input = '',
    size = 0;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    size += Buffer.byteLength(chunk);
    if (size > 8388608) {
      process.stdin.destroy();
      fail();
    } else input += chunk;
  });
  process.stdin.on('end', () => {
    try {
      const request = JSON.parse(input);
      if (typeof request.text !== 'string' || Buffer.byteLength(request.text) > 1048576) throw Error('input');
      let blocked = 0;
      if (request.testOfflineGuards === true) {
        for (const probe of [
          () => http.get('http://127.0.0.1'),
          () => https.get('https://example.com'),
          () => net.connect(1, '127.0.0.1'),
          () => dns.lookup('example.com'),
          () => fetch('https://example.com'),
          () => cp.spawn('anything'),
        ]) {
          try {
            probe();
            throw Error('guard');
          } catch (error) {
            if (error.message !== 'offline-only') throw error;
            blocked++;
          }
        }
      }
      const entry = path.join(root, 'node_modules/@anthropic-ai/tokenizer/dist/cjs/index.js');
      if (
        require.resolve('tiktoken/lite', { paths: [path.dirname(entry)] }).toLowerCase() !==
        path.join(root, 'node_modules/tiktoken/lite/tiktoken.cjs').toLowerCase()
      )
        throw Error('resolution');
      const counter = require(entry);
      const tokens = counter.countTokens(request.text);
      if (!Number.isSafeInteger(tokens) || tokens < 0) throw Error('count');
      process.stdout.write(
        JSON.stringify({
          status: 'observed',
          referenceCount: {
            status: 'observed',
            tokens,
            engine: pin.engine,
            version: pin.version,
            referenceModel: 'claude-legacy',
            scope: 'visible-text-only',
            verifiedForRequestedModel: false,
            mappingStatus: 'unsupported-current-model',
            warningCode: 'legacy-tokenizer-inaccurate-current-claude',
            normalization: 'NFKC',
            specialTokens: 'legacy-library-recognized',
          },
          ...(blocked ? { offlineGuardsBlocked: blocked } : {}),
        }),
      );
    } catch {
      fail();
    }
  });
} catch {
  fail();
}
