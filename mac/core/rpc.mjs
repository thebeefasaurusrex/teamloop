import { execute as realExecute, cleanEnv } from './process.mjs';

export function parseRPCTranscript(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1048576) throw new Error('Invalid Codex RPC response');
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const item = JSON.parse(line);
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid Codex RPC message');
      return item;
    });
}

/** Sequential initialization and read requests; does not access credential files. */
export async function readCodexAccountAndLimits(command, { execute = realExecute, cwd, signal } = {}) {
  const request = [
    { id: 0, method: 'initialize', params: { clientInfo: { name: 'teamloop_mac', title: 'TeamLoop Mac', version: '0.1.0' } } },
    { id: 1, method: 'account/read', params: {} },
    { id: 2, method: 'account/rateLimits/read', params: {} },
  ];
  let writer,
    sent = 0;
  const handled = new Set();
  const consume = line => {
    const item = JSON.parse(line);
    if (item.id === undefined) {
      if (item.method === 'account/updated' && handled.has(1)) throw new Error('Codex account changed during quota observation');
      return;
    }
    if (!Number.isSafeInteger(item.id) || item.id !== sent || handled.has(item.id)) throw new Error('Unexpected RPC response');
    handled.add(item.id);
    if (item.error) throw new Error('Codex account query failed');
    if (item.id === 0) writer?.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    if (item.id < 2) {
      sent++;
      writer?.write(JSON.stringify(request[sent]) + '\n');
    } else writer?.end();
  };
  const result = await execute(command, ['app-server', '--listen', 'stdio://'], {
    cwd,
    signal,
    env: cleanEnv(),
    timeoutMs: 20000,
    maxBytes: 1048576,
    interactive: true,
    onStart: channel => {
      writer = channel;
      writer.write(JSON.stringify(request[0]) + '\n');
    },
    onLine: consume,
  });
  if (result.stopped || result.code !== 0) throw new Error('Codex quota connection failed');
  const events = parseRPCTranscript(result.stdout);
  const accountIndex = events.findIndex(e => e.id === 1);
  if (events.some((e, i) => i > accountIndex && e.method === 'account/updated')) throw new Error('Codex account changed during quota observation');
  const replies = request.map(r => events.filter(e => e.id === r.id));
  if (replies.some(rows => rows.length !== 1 || rows[0].error || !('result' in rows[0]))) throw new Error('Incomplete Codex account response');
  return { account: replies[1][0].result, limits: replies[2][0].result };
}
