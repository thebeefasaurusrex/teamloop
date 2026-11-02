import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { defaults } from './policy.mjs';

export const initialState = () => ({
  version: 1,
  revision: 0,
  settingsRevision: 0,
  settings: structuredClone(defaults),
  meters: [],
  health: [],
  events: [],
  runs: [],
  quotaState: {},
});
export function stateRoot(env = process.env) {
  return env.TEAMLOOP_STATE_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'TeamLoop');
}
export class Store {
  constructor(root = stateRoot()) {
    this.root = path.resolve(root);
    this.file = path.join(this.root, 'state.json');
    this.lock = path.join(this.root, '.state-lock');
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await fs.lstat(this.root)).isSymbolicLink()) throw Error('State folder cannot be a symbolic link');
  }
  async read() {
    await this.init();
    let stat;
    try {
      stat = await fs.lstat(this.file);
    } catch (e) {
      if (e.code === 'ENOENT') return initialState();
      throw e;
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 8 * 1024 * 1024) throw Error('Invalid or oversized state file');
    let value;
    try {
      value = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      throw Error('State file is unreadable; preserve it and use recovery, not a reset');
    }
    if (
      value.version !== 1 ||
      !value.settings ||
      !Array.isArray(value.events) ||
      !Array.isArray(value.meters) ||
      !Array.isArray(value.runs) ||
      !value.quotaState
    )
      throw Error('State format unsupported; preserve the existing file');
    return value;
  }
  async update(change) {
    await this.init();
    const nonce = randomUUID();
    let acquired = false;
    // Publish fully written owner metadata with an exclusive hard link. A crash between
    // creation and metadata write can no longer leave a permanently empty lock.
    const candidate = path.join(this.root, `.lock-candidate-${nonce}`);
    const prepared = await fs.open(candidate, 'wx', 0o600);
    try {
      await prepared.writeFile(JSON.stringify({ pid: process.pid, nonce, at: Date.now() }));
      await prepared.sync();
    } finally {
      await prepared.close();
    }
    try {
      for (let attempt = 0; attempt < 60; attempt++) {
        try {
          await fs.link(candidate, this.lock);
          acquired = true;
          break;
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
          try {
            const prior = JSON.parse(await fs.readFile(this.lock, 'utf8'));
            let alive = true;
            if (Number.isInteger(prior.pid) && prior.pid > 0) {
              try {
                process.kill(prior.pid, 0);
              } catch (err) {
                if (err.code === 'ESRCH') alive = false;
              }
            }
            if (!alive && Date.now() - prior.at > 5000) {
              await fs.unlink(this.lock);
              continue;
            }
          } catch {
            /* Never remove an unreadable or partly-created live lock. */
          }
          await new Promise(resolve => setTimeout(resolve, 30));
        }
      }
      if (!acquired) throw Error('Another TeamLoop operation is updating state; try again');
    } finally {
      await fs.unlink(candidate).catch(() => {});
    }
    let temporary;
    try {
      const state = await this.read();
      const result = await change(state);
      state.revision = (state.revision ?? 0) + 1;
      const body = JSON.stringify(state);
      if (Buffer.byteLength(body, 'utf8') > 8 * 1024 * 1024) throw Error('State retention limit reached; export history before continuing');
      temporary = path.join(this.root, `.state-${nonce}.tmp`);
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(body);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, this.file);
      temporary = null;
      return result ?? state;
    } finally {
      if (temporary) await fs.unlink(temporary).catch(() => {});
      const owned = await fs
        .readFile(this.lock, 'utf8')
        .then(JSON.parse)
        .catch(() => null);
      if (owned?.nonce === nonce) await fs.unlink(this.lock).catch(() => {});
    }
  }
}
