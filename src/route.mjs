import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveModel } from './config.mjs';

/** Deterministic recommendation only. Does not call providers or run tools. */
export function route(profile, roster, config) {
  if (
    !profile ||
    !Array.isArray(profile.needs) ||
    profile.needs.some(v => typeof v !== 'string') ||
    new Set(profile.needs).size !== profile.needs.length ||
    !['low', 'medium', 'high'].includes(profile.stakes) ||
    typeof profile.requestedTeam !== 'boolean' ||
    !Number.isSafeInteger(profile.maxReviewers) ||
    profile.maxReviewers < 0 ||
    profile.maxReviewers > 3 ||
    !Array.isArray(profile.availableProviders) ||
    profile.availableProviders.some(v => typeof v !== 'string')
  )
    throw Error('Invalid routing profile');
  if (roster?.schemaVersion !== 1 || !roster.roles || !roster.toolChecks) throw Error('Invalid roster');
  for (const need of profile.needs) {
    if (!Array.isArray(roster.roles[need]) || !Array.isArray(roster.toolChecks[need]) || roster.toolChecks[need].some(v => typeof v !== 'string'))
      throw Error('Unknown role or invalid tool checks: ' + need);
    for (const candidate of roster.roles[need])
      if (!candidate || ['provider', 'model', 'effort', 'family'].some(k => typeof candidate[k] !== 'string' || !candidate[k]))
        throw Error('Invalid role candidate');
  }
  const output = {
    mode: 'lead-only',
    toolChecks: [...new Set(profile.needs.flatMap(n => roster.toolChecks[n]))],
    workers: [],
    unfilled: [],
    note: 'Recommendations only. No provider calls, retries, votes or automatic fallbacks.',
  };
  if (!profile.requestedTeam && profile.stakes === 'low') return output;
  const selected = new Set();
  for (const need of profile.needs) {
    const reasons = [];
    if (output.workers.length >= profile.maxReviewers) {
      output.unfilled.push({ role: need, reasons: ['Reviewer budget reached; lead decides whether to defer or handle locally.'] });
      continue;
    }
    let picked = null;
    for (const candidate of roster.roles[need]) {
      const key = [candidate.provider, candidate.model].join(':');
      if (selected.has(key)) {
        reasons.push('Same worker already assigned; no duplicated dispatch.');
        continue;
      }
      if (!profile.availableProviders.includes(candidate.provider)) {
        reasons.push(candidate.provider + ' unavailable under the supplied availability snapshot.');
        continue;
      }
      try {
        resolveModel(config, candidate.provider, candidate.model, candidate.effort);
      } catch (error) {
        reasons.push(candidate.provider + ': ' + error.message);
        continue;
      }
      picked = {
        ...candidate,
        role: need,
        why: 'First available, explicitly configured candidate for ' + need + '.',
        sameFamilyAsLead: profile.leadFamily === candidate.family,
      };
      selected.add(key);
      break;
    }
    if (picked) output.workers.push(picked);
    else output.unfilled.push({ role: need, reasons });
  }
  output.mode = output.workers.length ? 'team' : 'lead-only';
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [profile, roster, config] = process.argv.slice(2);
    console.log(
      JSON.stringify(route(JSON.parse(await fs.readFile(profile, 'utf8')), JSON.parse(await fs.readFile(roster, 'utf8')), await loadConfig(config)), null, 2),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
