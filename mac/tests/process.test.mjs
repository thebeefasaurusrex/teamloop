import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execute, cleanEnv } from '../core/process.mjs';
import { readCodexAccountAndLimits, parseRPCTranscript } from '../core/rpc.mjs';

function fakeSpawn(work) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.pid = 12345;
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => work(child, options));
    return child;
  };
}
test('clean environment excludes API and alternate cloud auth', () => {
  const e = cleanEnv({
    HOME: '/Users/test',
    PATH: '/evil',
    ANTHROPIC_API_KEY: 'synthetic',
    OPENAI_API_KEY: 'synthetic',
    SSH_CONNECTION: 'synthetic',
    AGY_ADC_AUTH: 'true',
    NODE_OPTIONS: '--inspect',
    LANG: 'en_US.UTF-8',
  });
  assert.equal(e.CLAUDE_CODE_DISABLE_FAST_MODE, '1');
  assert.equal(e.AGY_CLI_DISABLE_AUTO_UPDATE, 'true');
  assert.ok(!JSON.stringify(e).includes('synthetic'));
  assert.ok(!e.PATH.includes('/evil'));
  assert.equal(e.NODE_OPTIONS, undefined);
  assert.equal(e.AGY_ADC_AUTH, undefined);
});
test('execute uses owned detached process group and no shell', async () => {
  const r = await execute('/tools/provider', [], {
    spawnProcess: fakeSpawn((c, o) => {
      assert.equal(o.shell, false);
      assert.equal(o.detached, true);
      c.stdout.write('hello');
      c.emit('close', 0);
    }),
  });
  assert.equal(r.stdout, 'hello');
  assert.equal(r.code, 0);
});
test('execute rejects relative and foreign executable paths', async () => {
  await assert.rejects(execute('provider', []));
  await assert.rejects(execute('/tool', ['bad\0arg']));
});
test('stdout byte overflow stops the group', async () => {
  const kills = [];
  const r = await execute('/tools/provider', [], {
    maxBytes: 4,
    killGroup: (...a) => kills.push(a),
    spawnProcess: fakeSpawn(c => {
      c.stdout.write('12345');
      c.emit('close', null);
    }),
  });
  assert.equal(r.stopped, 'output-limit');
  assert.deepEqual(kills[0], [-12345, 'SIGKILL']);
  assert.equal(r.stdout, '');
});
test('timeout stops owned group', async () => {
  const kills = [];
  const r = await execute('/tools/provider', [], {
    timeoutMs: 5,
    killGroup: (...a) => kills.push(a),
    spawnProcess: fakeSpawn(c => setTimeout(() => c.emit('close', null), 15)),
  });
  assert.equal(r.stopped, 'timeout');
  assert.deepEqual(kills[0], [-12345, 'SIGKILL']);
});
test('pre-aborted signal does not spawn', async () => {
  const c = new AbortController();
  c.abort();
  assert.equal(
    (
      await execute('/tools/provider', [], {
        signal: c.signal,
        spawnProcess: () => {
          throw Error('should not spawn');
        },
      })
    ).stopped,
    'cancelled',
  );
});
test('abort after spawn stops owned group', async () => {
  const c = new AbortController();
  const kills = [];
  const r = await execute('/tools/provider', [], {
    signal: c.signal,
    killGroup: (...a) => kills.push(a),
    spawnProcess: fakeSpawn(p => {
      c.abort();
      p.emit('close', null);
    }),
  });
  assert.equal(r.stopped, 'cancelled');
  assert.equal(kills.length, 1);
});
test('leader close cannot cancel descendant group termination', async () => {
  const controller = new AbortController(),
    kills = [];
  await execute('/tools/provider', [], {
    signal: controller.signal,
    killGroup: (...a) => kills.push(a),
    spawnProcess: fakeSpawn(c => {
      controller.abort();
      c.emit('close', 0);
    }),
  });
  assert.deepEqual(kills, [[-12345, 'SIGKILL']]);
});
test('line decoder preserves split UTF8 and final line', async () => {
  const seen = [];
  const bytes = Buffer.from('é\nlast');
  await execute('/tools/provider', [], {
    onLine: s => seen.push(s),
    spawnProcess: fakeSpawn(c => {
      c.stdout.write(bytes.subarray(0, 1));
      c.stdout.write(bytes.subarray(1));
      c.emit('close', 0);
    }),
  });
  assert.deepEqual(seen, ['é', 'last']);
});
test('protocol callback error ends operation', async () => {
  const r = await execute('/tools/provider', [], {
    killGroup: () => {},
    onLine: () => {
      throw Error('bad JSON');
    },
    spawnProcess: fakeSpawn(c => {
      c.stdout.write('bad\n');
      c.emit('close', null);
    }),
  });
  assert.equal(r.stopped, 'protocol-error');
});
test('stdin closed for normal one-shot execution', async () => {
  const seen = [];
  await execute('/tools/provider', [], {
    input: 'prompt',
    spawnProcess: fakeSpawn(c => {
      c.stdin.on('data', d => seen.push(d.toString()));
      c.stdin.on('end', () => c.emit('close', 0));
    }),
  });
  assert.deepEqual(seen, ['prompt']);
});
test('RPC sequences initialize, initialized, then account and quota', async () => {
  const sent = [];
  let output = '';
  const result = await readCodexAccountAndLimits('/tools/codex', {
    execute: async (command, args, o) => {
      o.onStart({
        write: line => {
          const req = JSON.parse(line);
          sent.push(req.method);
          if (req.id === undefined) return;
          const reply = {
            id: req.id,
            result: req.id === 1 ? { account: { type: 'chatgpt', email: 'person@example.test' } } : req.id === 2 ? { rateLimits: null } : {},
          };
          const lineOut = JSON.stringify(reply);
          output += lineOut + '\n';
          queueMicrotask(() => o.onLine(lineOut));
        },
        end: () => {},
      });
      await new Promise(r => setTimeout(r, 5));
      return { code: 0, stdout: output, stderr: '', stopped: null };
    },
  });
  assert.deepEqual(sent, ['initialize', 'initialized', 'account/read', 'account/rateLimits/read']);
  assert.equal(result.account.account.type, 'chatgpt');
});
test('RPC rejects missing, duplicate and error replies', async () => {
  for (const raw of ['{"id":0,"result":{}}\n', '{"id":0,"error":{"message":"bad"}}\n', '{"id":0,"result":{}}\n{"id":0,"result":{}}\n']) {
    await assert.rejects(readCodexAccountAndLimits('/tools/codex', { execute: async () => ({ code: 0, stdout: raw, stopped: null }) }));
  }
});
test('RPC rejects nonobject or oversized wire messages', () => {
  assert.throws(() => parseRPCTranscript('null'));
  assert.throws(() => parseRPCTranscript('x'.repeat(1048577)));
});
test('RPC rejects account change between account and quota snapshots', async () => {
  const stdout = [
    { id: 0, result: {} },
    { id: 1, result: { account: { type: 'chatgpt', email: 'old@example.test' } } },
    { method: 'account/updated', params: { authMode: 'chatgpt' } },
    { id: 2, result: { rateLimits: null } },
  ]
    .map(JSON.stringify)
    .join('\n');
  await assert.rejects(readCodexAccountAndLimits('/tools/codex', { execute: async () => ({ code: 0, stdout, stopped: null }) }), /account changed/);
});
