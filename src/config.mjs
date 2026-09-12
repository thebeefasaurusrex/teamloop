import fs from 'node:fs/promises';
import path from 'node:path';

const providerIds = new Set(['mock', 'codex', 'claude', 'gemini', 'nvidia']);
const accountProviders = ['codex', 'claude', 'gemini'];
const paths = ['stateRoot', 'codexHome', 'antigravityHome', 'nvidiaKeyFile'];
const commands = ['codex', 'claude', 'antigravity'];

/** Load only an explicitly selected configuration. Relative paths use its directory. */
export async function loadConfig(filename) {
  const absolute = path.resolve(filename);
  const config = JSON.parse(await fs.readFile(absolute, 'utf8'));
  for (const key of paths) if (typeof config[key] === 'string') config[key] = path.resolve(path.dirname(absolute), config[key]);
  for (const key of commands) if (typeof config[key] === 'string' && /[\\/]/.test(config[key])) config[key] = path.resolve(path.dirname(absolute), config[key]);
  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  if (config?.schemaVersion !== 1 || typeof config.stateRoot !== 'string' || !path.isAbsolute(config.stateRoot)) throw Error('Configuration requires schemaVersion 1 and a stateRoot path');
  if (!config.providers || typeof config.providers !== 'object' || Array.isArray(config.providers)) throw Error('providers must be an object');
  if (!Array.isArray(config.blockedLiterals) || config.blockedLiterals.some(v => typeof v !== 'string' || !v.trim())) throw Error('blockedLiterals must be an array of nonempty strings');
  const limits = config.limits;
  if (!limits || !Number.isSafeInteger(limits.maxTaskTimeoutMs) || limits.maxTaskTimeoutMs < 30000 || limits.maxTaskTimeoutMs > 900000 || !Number.isSafeInteger(limits.maxRunsPerProviderPacket) || limits.maxRunsPerProviderPacket < 1 || limits.maxRunsPerProviderPacket > 10) throw Error('Set limits: maxTaskTimeoutMs (30000-900000), maxRunsPerProviderPacket (1-10)');
  for (const [provider, settings] of Object.entries(config.providers)) {
    if (!providerIds.has(provider) || !settings || typeof settings.enabled !== 'boolean') throw Error('Unsupported provider or missing enabled flag: ' + provider);
    if (!settings.models || typeof settings.models !== 'object' || Array.isArray(settings.models)) throw Error('Each provider requires a models object');
    for (const [model, profile] of Object.entries(settings.models)) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(model) || !profile || !Array.isArray(profile.efforts) || !profile.efforts.length || profile.efforts.some(e => !/^[a-z][a-z0-9-]{0,23}$/.test(e)) || typeof profile.imageInput !== 'boolean') throw Error('Invalid model profile');
      if (profile.resolvedModels !== undefined && (!Array.isArray(profile.resolvedModels) || !profile.resolvedModels.length || profile.resolvedModels.some(m => typeof m !== 'string' || !m))) throw Error('resolvedModels must be a nonempty list');
    }
    if (!settings.enabled) continue;
    if (!Object.keys(settings.models).length) throw Error('Enabled provider needs an explicit model allowlist');
    if (accountProviders.includes(provider) && (!Array.isArray(settings.allowedAccounts) || !settings.allowedAccounts.length || settings.allowedAccounts.some(email => typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)))) throw Error('Enabled subscription provider requires allowedAccounts');
    if (provider === 'nvidia' && config.allowApiSpend !== true) throw Error('API transport requires explicit allowApiSpend; it is not a subscription fallback');
  }
  return config;
}

export function resolveModel(config, provider, model, effort = 'default') {
  validateConfig(config);
  const settings = config.providers[provider];
  if (settings?.enabled !== true) throw Error('Provider not enabled; no automatic fallback');
  const profile = settings.models[model];
  if (!profile) throw Error('Unsupported model: configure an explicit model allowlist');
  if (!profile.efforts.includes(effort)) throw Error('Unsupported reasoning effort for this configured model');
  return profile;
}
