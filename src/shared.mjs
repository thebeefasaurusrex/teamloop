// Guards and primitives shared by every runner module. Each security-relevant
// pattern lives here exactly once so the reviewer runner, the plan runner, the
// execution-mode store and the Claude Bridge builder cannot drift apart.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

export const hash = value =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');

export const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

/** Publish JSON by exclusive temporary file plus rename so readers never see a partial record. */
export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  await fs.rename(temporary, file);
}

/** Path segments that are never selected as evidence or edited by a worker. */
export const denyPath =
  /(?:^|[\\/])(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.codex|\.claude|\.gemini|node_modules|user data|login data|cookies|auth\.json|oauth_creds\.json|credentials[^\\/]*)(?:[\\/]|$)/i;

const providerTokens =
  /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|nvapi-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{30,})/;
const credentialAssignment = /["']?(?:access_token|refresh_token|id_token|api_key|password)["']?\s*[:=]\s*["'][^"']{8,}/i;

/** Labeled secret patterns. Labels appear in error messages so operators can see what tripped. */
export const secretPatterns = [
  { label: 'private key block', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'provider token', pattern: providerTokens },
  { label: 'credential assignment', pattern: credentialAssignment },
];

export function findSecretPattern(text) {
  return secretPatterns.find(({ pattern }) => pattern.test(text))?.label ?? null;
}

/**
 * Reject text that looks like a secret, contains a configured blocked literal, or is not text.
 * `context` names the file or field so a 16-file packet failure points at one place.
 */
export function safeText(text, blockedLiterals = [], context = '') {
  const where = context ? ` in ${context}` : '';
  if (text.includes('\0')) throw Error(`Excluded non-text input${where}`);
  const label = findSecretPattern(text);
  if (label) throw Error(`Excluded secret-like material (${label})${where}`);
  const lower = text.toLowerCase();
  if (blockedLiterals.some(value => lower.includes(value.toLowerCase()))) throw Error(`Excluded configured blocked literal${where}`);
  return text;
}

/** Walk a JSON value and apply safeText to every string, reporting the field path on failure. */
export function scanStrings(value, blockedLiterals = [], context = '') {
  if (typeof value === 'string') safeText(value, blockedLiterals, context);
  else if (Array.isArray(value)) value.forEach((item, index) => scanStrings(item, blockedLiterals, `${context}[${index}]`));
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) scanStrings(item, blockedLiterals, context ? `${context}.${key}` : key);
}

const redactToken = new RegExp(providerTokens.source + '\\b', 'g');
const redactAssignment = new RegExp('(' + credentialAssignment.source.replace(/\[\^"'\]\{8,\}$/, '') + ')[^"\']+', 'gi');
export const redact = text =>
  String(text ?? '')
    .replace(redactToken, '[REDACTED]')
    .replace(redactAssignment, '$1[REDACTED]');

export function contained(root, target) {
  const rel = path.relative(root, target);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}
export const containedOrEqual = (root, target) => target === root || contained(root, target);

/** Keep only the variables a provider CLI needs to start; drop API keys, base URLs, proxies and Node options. */
export function cleanEnv(original = process.env) {
  const allow = new Set([
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'PATH',
    'PATHEXT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'HOME',
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'PROGRAMDATA',
    'LANG',
    'LC_ALL',
  ]);
  return Object.fromEntries(Object.entries(original).filter(([k]) => allow.has(k.toUpperCase())));
}

/** A manual attestation counts only for the preceding 24 hours and never from the future. */
export function recentAttestation(value, now = Date.now()) {
  const checked = Date.parse(value);
  const age = now - checked;
  return Number.isFinite(checked) && age >= 0 && age <= 86400000;
}

/** Human-readable platform name for prompts handed to workers. */
export function platformName(platform = process.platform) {
  return { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[platform] ?? platform;
}

/**
 * Run one owned child process with no shell, a byte cap, a wall-clock cap, optional cancellation
 * and watch files, and whole-process-tree termination on both Windows and POSIX.
 */
export async function execute(
  command,
  args,
  { cwd, env, input = '', timeoutMs = 180000, maxBytes = 2097152, cancelFile, onStdoutLine, watchFile, checkWatchText } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '',
      bytes = 0,
      stopped = null,
      pollBusy = false,
      pendingLine = '',
      policyError = null;
    const stop = why => {
      if (stopped) return;
      stopped = why;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.on('error', () => child.kill());
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') child.kill('SIGKILL');
        }
      }
    };
    const interrupt = () => stop('interrupted');
    process.on('SIGINT', interrupt);
    process.on('SIGTERM', interrupt);
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const poll =
      cancelFile || watchFile
        ? setInterval(async () => {
            if (pollBusy) return;
            pollBusy = true;
            try {
              if (cancelFile) {
                try {
                  await fs.access(cancelFile);
                  stop('cancelled');
                } catch (error) {
                  if (error.code !== 'ENOENT') stop('cancel-check-failed');
                }
              }
              if (watchFile && checkWatchText) {
                try {
                  checkWatchText(await fs.readFile(watchFile, 'utf8'));
                } catch (error) {
                  if (error.code !== 'ENOENT') {
                    policyError = redact(error.message);
                    stop('worker-policy-violation');
                  }
                }
              }
            } catch (error) {
              policyError = redact(error.message);
              stop('worker-policy-violation');
            } finally {
              pollBusy = false;
            }
          }, 250)
        : null;
    const finish = () => {
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      process.off('SIGINT', interrupt);
      process.off('SIGTERM', interrupt);
    };
    for (const [stream, isOut] of [
      [child.stdout, true],
      [child.stderr, false],
    ]) {
      stream.setEncoding('utf8');
      stream.on('data', chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxBytes) {
          stop('output-limit');
          return;
        }
        if (isOut) stdout += chunk;
        else stderr += chunk;
        if (isOut && onStdoutLine) {
          pendingLine += chunk;
          const lines = pendingLine.split(/\r?\n/);
          pendingLine = lines.pop();
          try {
            for (const line of lines) if (line.trim()) onStdoutLine(line);
          } catch (error) {
            policyError = redact(error.message);
            stop(/model\/provider/i.test(error.message) ? 'worker-provider-error' : 'worker-policy-violation');
          }
        }
      });
    }
    child.on('error', error => {
      finish();
      reject(error);
    });
    child.on('close', (code, signal) => {
      finish();
      resolve({ code, signal, stopped, policyError, stdout: redact(stdout), stderr: redact(stderr) });
    });
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') stop('stdin-error');
    });
    child.stdin.end(input);
  });
}

/** Run a command that must succeed; surface a bounded, redacted stderr excerpt on failure. */
export async function checked(command, args, options, label) {
  const result = await execute(command, args, options);
  if (result.code !== 0 || result.stopped) {
    const detail = result.stderr.trim().replace(/\s+/g, ' ').slice(0, 500);
    throw Error(label + ' failed' + (result.stopped ? ': ' + result.stopped : '') + (detail ? ': ' + detail : ''));
  }
  return result.stdout;
}

/**
 * Take an exclusive lock file. A held lock reports who holds it instead of a raw EEXIST.
 * There is deliberately no stale-lock stealing; see the operating reference.
 */
export async function acquireLock(lock, label, info) {
  await fs.mkdir(path.dirname(lock), { recursive: true });
  let handle;
  try {
    handle = await fs.open(lock, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let holder = 'an unfinished or interrupted run';
    try {
      const current = JSON.parse(await fs.readFile(lock, 'utf8'));
      holder = `run ${current.runId} (runner PID ${current.runnerPid})`;
    } catch {}
    throw Error(`${label} is busy: lock held by ${holder}. Wait for it to finish or reconcile the stale lock manually; no automatic stealing`);
  }
  await handle.writeFile(JSON.stringify(info));
  await handle.close();
  return () => fs.unlink(lock);
}
