import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJson } from './shared.mjs';

export const STANDARD_MODE = 'standard';

const stateFile = config => path.join(path.resolve(config.stateRoot), 'execution-mode.json');
const validName = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value);
const validVersion = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);

export function validateExecutionModes(config) {
  if (typeof config?.stateRoot !== 'string' || !path.isAbsolute(config.stateRoot)) throw Error('Execution modes require an absolute stateRoot');
  if (!validVersion(config.standardPolicyVersion)) throw Error('Execution modes require a standardPolicyVersion');
  const modes = config.executionModes;
  if (!modes || typeof modes !== 'object' || Array.isArray(modes)) throw Error('Execution modes are not configured');
  for (const [name, mode] of Object.entries(modes)) {
    if (name === STANDARD_MODE || !validName(name) || !mode || typeof mode !== 'object' || Array.isArray(mode))
      throw Error('Invalid execution mode definition');
    if (
      typeof mode.enabled !== 'boolean' ||
      typeof mode.provider !== 'string' ||
      !validVersion(mode.builderVersion) ||
      !validVersion(mode.validatedBuilderVersion)
    )
      throw Error('Execution mode requires enabled, provider, builderVersion, and validatedBuilderVersion');
    if (mode.builderVersion !== mode.validatedBuilderVersion) throw Error('Execution mode builder version is not validated');
  }
  return modes;
}

export async function resolveExecutionMode(config, now = Date.now()) {
  const base = {
    requestedMode: STANDARD_MODE,
    effectiveMode: STANDARD_MODE,
    standardPolicyVersion: config.standardPolicyVersion ?? null,
    overlay: null,
    reason: 'no-selection',
  };
  let state;
  try {
    state = JSON.parse(await fs.readFile(stateFile(config), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return base;
    if (error instanceof SyntaxError) return { ...base, requestedMode: null, reason: 'invalid-state' };
    throw error;
  }
  if (!state || typeof state !== 'object' || Array.isArray(state) || !validName(state.requestedMode))
    return { ...base, requestedMode: null, reason: 'invalid-state' };
  if (state.requestedMode === STANDARD_MODE) return { ...base, reason: 'explicit-standard' };
  const mode = config.executionModes?.[state.requestedMode];
  const expires = Date.parse(state.expiresAt);
  if (!mode || mode.enabled !== true) return { ...base, requestedMode: state.requestedMode, reason: 'unsupported-or-disabled' };
  if (
    !validVersion(mode.builderVersion) ||
    mode.builderVersion !== mode.validatedBuilderVersion ||
    state.validatedBuilderVersion !== mode.validatedBuilderVersion
  )
    return { ...base, requestedMode: state.requestedMode, reason: 'unvalidated-builder' };
  if (!Number.isFinite(expires) || expires <= now) return { ...base, requestedMode: state.requestedMode, reason: 'expired' };
  if (state.standardPolicyVersion !== config.standardPolicyVersion) return { ...base, requestedMode: state.requestedMode, reason: 'standard-policy-changed' };
  return {
    requestedMode: state.requestedMode,
    effectiveMode: state.requestedMode,
    standardPolicyVersion: config.standardPolicyVersion,
    overlay: {
      provider: mode.provider,
      builderVersion: mode.builderVersion,
      activatedAt: state.activatedAt,
      expiresAt: state.expiresAt,
      activatedBy: state.activatedBy,
    },
    reason: 'active',
  };
}

export async function activateExecutionMode(config, name, expiresAt, { now = Date.now(), activatedBy = 'explicit-user-decision' } = {}) {
  const modes = validateExecutionModes(config);
  if (name === STANDARD_MODE || !modes[name] || modes[name].enabled !== true) throw Error('Execution mode is not enabled');
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires) || expires <= now) throw Error('Execution mode expiry must be in the future');
  if (expires - now > 31 * 86400000) throw Error('Temporary execution modes cannot exceed 31 days');
  const state = {
    schemaVersion: 1,
    requestedMode: name,
    activatedAt: new Date(now).toISOString(),
    expiresAt: new Date(expires).toISOString(),
    activatedBy,
    validatedBuilderVersion: modes[name].validatedBuilderVersion,
    standardPolicyVersion: config.standardPolicyVersion,
  };
  await atomicJson(stateFile(config), state);
  return resolveExecutionMode(config, now);
}

export async function selectStandardMode(config, { now = Date.now(), activatedBy = 'explicit-user-decision' } = {}) {
  if (typeof config?.stateRoot !== 'string' || !path.isAbsolute(config.stateRoot)) throw Error('Standard mode requires an absolute stateRoot');
  const state = {
    schemaVersion: 1,
    requestedMode: STANDARD_MODE,
    activatedAt: new Date(now).toISOString(),
    activatedBy,
    standardPolicyVersion: config.standardPolicyVersion ?? null,
  };
  await atomicJson(stateFile(config), state);
  return resolveExecutionMode(config, now);
}

export function formatExecutionMode(status, now = Date.now()) {
  const remaining = status.overlay ? Math.max(0, Date.parse(status.overlay.expiresAt) - now) : 0;
  return { ...status, remainingMs: remaining };
}
