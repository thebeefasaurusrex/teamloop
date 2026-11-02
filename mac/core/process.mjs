import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import os from 'node:os';

/** Allowlist environment; subscription subprocesses never inherit provider keys or cloud auth. */
export function cleanEnv(original = process.env) {
  const env = {};
  for (const key of ['HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM']) {
    if (typeof original[key] === 'string') env[key] = original[key];
  }
  env.HOME ||= os.homedir();
  env.PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin', '/opt/homebrew/bin', `${env.HOME}/.local/bin`].join(':');
  env.CLAUDE_CODE_DISABLE_FAST_MODE = '1';
  env.AGY_CLI_DISABLE_AUTO_UPDATE = 'true';
  return env;
}

/** No shell. This Mac-only runtime owns a detached POSIX process group. */
export function execute(
  command,
  args,
  {
    cwd,
    input = '',
    timeoutMs = 30000,
    maxBytes = 1048576,
    env = cleanEnv(),
    signal,
    interactive = false,
    onStart,
    onLine,
    spawnProcess = spawn,
    killGroup = process.kill.bind(process),
  } = {},
) {
  if (
    typeof command !== 'string' ||
    !command.startsWith('/') ||
    command.includes('\0') ||
    !Array.isArray(args) ||
    args.some(a => typeof a !== 'string' || a.includes('\0'))
  ) {
    return Promise.reject(new Error('An absolute Mac executable and string arguments are required'));
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 1800000 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 8388608) {
    return Promise.reject(new Error('Invalid process bounds'));
  }
  if (signal?.aborted) return Promise.resolve({ code: null, stdout: '', stderr: '', stopped: 'cancelled' });
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(command, args, { cwd, env, shell: false, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      reject(new Error('Could not start installed provider tool'));
      return;
    }
    let stdout = '',
      stderr = '',
      stopped = null,
      bytes = 0,
      pending = '',
      finished = false,
      forcedTimer;
    const decoder = new StringDecoder('utf8');
    const finish = code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(forcedTimer);
      signal?.removeEventListener('abort', abort);
      resolve({ code, stdout, stderr, stopped });
    };
    const stop = reason => {
      if (finished || stopped) return;
      stopped = reason;
      // Kill the currently owned group while its leader is still tracked. A delayed
      // TERM->KILL timer can be cancelled by leader exit and orphan grandchildren,
      // or target a reused identifier after the old group disappears.
      try {
        if (child.pid) killGroup(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
      forcedTimer = setTimeout(() => {
        // Bound a hung or inherited stdout pipe even if the provider never closes it.
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.stdin?.destroy();
        finish(null);
      }, 1000);
    };
    const abort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const accept = chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        stop('output-limit');
        return false;
      }
      return !stopped;
    };
    const lines = value => {
      pending += value;
      let n;
      while ((n = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, n).replace(/\r$/, '');
        pending = pending.slice(n + 1);
        if (line && onLine) {
          try {
            onLine(line);
          } catch {
            stop('protocol-error');
            return;
          }
        }
      }
    };
    child.stdout.on('data', chunk => {
      if (accept(chunk)) {
        const text = decoder.write(chunk);
        stdout += text;
        lines(text);
      }
    });
    child.stderr.on('data', chunk => {
      if (accept(chunk)) stderr += chunk.toString('utf8');
    });
    child.stdin.on('error', () => {
      /* EPIPE is represented by process exit/timeout, not an uncaught event. */
    });
    child.on('error', () => {
      if (!stopped) stopped = 'launch-error';
      finish(null);
    });
    child.on('close', code => {
      if (!stopped) {
        const tail = decoder.end();
        stdout += tail;
        pending += tail;
        if (pending && onLine) {
          try {
            onLine(pending);
          } catch {
            stopped = 'protocol-error';
          }
        }
      }
      finish(code);
    });
    try {
      onStart?.({ write: value => child.stdin.write(value), end: () => child.stdin.end(), stop });
      if (input) child.stdin.write(input);
      if (!interactive) child.stdin.end();
    } catch {
      stop('protocol-error');
    }
  });
}
