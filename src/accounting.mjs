/** Observation-only accounting. No network, credential access, generation, or quota conversion. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { findSecretPattern } from './shared.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const providers = new Set(['codex', 'claude', 'gemini', 'deepseek', 'nvidia']);
const MAX_STDOUT_BYTES = 64 * 1024 * 1024,
  MAX_EVENTS = 4096,
  MAX_OBSERVATIONS = 256;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const valid = value => Number.isSafeInteger(value) && value >= 0;
const numericFields = [
  'input_tokens',
  'prompt_tokens',
  'cached_input_tokens',
  'cache_read_input_tokens',
  'cache_read_tokens',
  'cache_creation_input_tokens',
  'cache_creation_tokens',
  'output_tokens',
  'completion_tokens',
  'thinking_tokens',
  'reasoning_tokens',
  'reasoning_output_tokens',
  'total_tokens',
];
const detailsFields = {
  prompt_tokens_details: ['cached_tokens'],
  input_tokens_details: ['cached_tokens'],
  output_tokens_details: ['reasoning_tokens', 'thinking_tokens'],
  completion_tokens_details: ['reasoning_tokens'],
};
const cleanLabel = value => (typeof value === 'string' && /^[A-Za-z0-9_.:/-]{1,160}$/.test(value) && !findSecretPattern(value) ? value : null);
const withoutUndefined = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
const codePoints = text => {
  let count = 0;
  for (const unused of text) count++;
  return count;
};

/** Preserve native fields; missing, malformed and unsafe counts are unknown, never zero. */
export function normalizeUsage(provider, usage) {
  if (!providers.has(provider)) throw Error('Unsupported accounting provider');
  const native = {},
    invalidFields = [];
  const source = object(usage) ? usage : {};
  for (const key of numericFields)
    if (Object.hasOwn(source, key)) {
      native[key] = valid(source[key]) ? source[key] : null;
      if (native[key] === null) invalidFields.push(key);
    }
  for (const [key, fields] of Object.entries(detailsFields))
    if (Object.hasOwn(source, key)) {
      if (!object(source[key])) {
        invalidFields.push(key);
        continue;
      }
      native[key] = {};
      for (const field of fields)
        if (Object.hasOwn(source[key], field)) {
          native[key][field] = valid(source[key][field]) ? source[key][field] : null;
          if (native[key][field] === null) invalidFields.push(key + '.' + field);
        }
    }
  // First present field wins, including invalid values: never conceal conflicts with an alias.
  const pick = (...keys) => {
    for (const key of keys) {
      const [top, child] = key.split('.');
      if (child ? object(source[top]) && Object.hasOwn(source[top], child) : Object.hasOwn(source, top)) {
        const value = child ? source[top][child] : source[top];
        return valid(value) ? value : null;
      }
    }
    return null;
  };
  return {
    schemaVersion: 1,
    provider,
    input: pick('input_tokens', 'prompt_tokens'),
    cached: pick(
      'cached_input_tokens',
      'cache_read_input_tokens',
      'cache_read_tokens',
      'input_tokens_details.cached_tokens',
      'prompt_tokens_details.cached_tokens',
    ),
    cacheCreation: pick('cache_creation_input_tokens', 'cache_creation_tokens'),
    output: pick('output_tokens', 'completion_tokens'),
    thinking: pick(
      'thinking_tokens',
      'reasoning_tokens',
      'reasoning_output_tokens',
      'output_tokens_details.reasoning_tokens',
      'output_tokens_details.thinking_tokens',
      'completion_tokens_details.reasoning_tokens',
    ),
    total: pick('total_tokens'),
    semantics: {
      version: 1,
      inputIncludesCache: provider === 'claude' ? false : ['codex', 'deepseek'].includes(provider) ? true : null,
      thinkingIsOutputSubset: ['codex', 'deepseek'].includes(provider) ? true : null,
      total: 'provider-reported-only',
      crossProviderComparable: false,
    },
    native,
    invalidFields,
  };
}

/** Extract consumption separately from successful review validation. Never sums observations. */
export function extractUsageObservations(provider, stdout, context = {}) {
  if (!providers.has(provider)) throw Error('Unsupported accounting provider');
  const observations = [],
    seen = new Set();
  // Array properties must be copied explicitly by callers: JSON.stringify(array) omits them.
  observations.truncated = false;
  observations.reasonCodes = [];
  observations.coverage = 'unknown';
  const reason = code => {
    if (!observations.reasonCodes.includes(code)) observations.reasonCodes.push(code);
  };
  const truncate = code => {
    observations.truncated = true;
    reason(code);
  };
  if (typeof stdout !== 'string') {
    reason('stdout-unavailable');
    return observations;
  }
  if (Buffer.byteLength(stdout) > MAX_STDOUT_BYTES) {
    truncate('stdout-byte-limit');
    return observations;
  }
  const sequenceOffset = context.sequenceOffset ?? 0;
  if (!valid(sequenceOffset)) throw Error('Invalid usage sequence offset');
  const add = (usage, { eventType, scope = 'run', cumulative = false, authoritative = false, sourceId = null, sequence, model = null }) => {
    if (!object(usage)) return;
    const normalized = normalizeUsage(provider, usage);
    if (!Object.keys(normalized.native).length && !normalized.invalidFields.length) return;
    const observation = {
      schemaVersion: 1,
      provider,
      runId: cleanLabel(context.runId),
      requestedModel: cleanLabel(context.model ?? context.requestedModel),
      actualModel: cleanLabel(model),
      source: cleanLabel(context.source),
      eventType: cleanLabel(eventType),
      scope,
      cumulative,
      authoritative,
      sourceId: cleanLabel(sourceId),
      sequence,
      usage: normalized,
    };
    const identity = { ...observation, source: null, sequence: observation.sourceId ? null : sequence };
    const observationId = hash(JSON.stringify(identity));
    if (seen.has(observationId)) return;
    seen.add(observationId);
    if (observations.length >= MAX_OBSERVATIONS) {
      truncate('observation-limit');
      const detail = observations.findIndex(item => !item.authoritative);
      // Reserve terminal accounting even after many streamed detail observations.
      if (!authoritative && detail < 0) return;
      observations.splice(detail >= 0 ? detail : 0, 1);
    }
    observations.push({ ...observation, observationId });
  };
  let events;
  try {
    const parsed = JSON.parse(stdout),
      items = Array.isArray(parsed) ? parsed : [parsed];
    if (items.length > MAX_EVENTS) truncate('event-limit');
    const start = Math.max(0, items.length - MAX_EVENTS);
    events = items.slice(start).map((event, index) => ({ event, sequence: sequenceOffset + start + index }));
  } catch {
    // Bounded ring retains the tail. Ordinals count every nonblank line, including notices.
    const ring = new Array(MAX_EVENTS);
    let count = 0;
    for (const match of stdout.matchAll(/[^\r\n]+/g)) {
      const line = match[0];
      if (!line.trim()) continue;
      ring[count % MAX_EVENTS] = { line, sequence: sequenceOffset + count };
      count++;
    }
    if (count > MAX_EVENTS) truncate('event-limit');
    const start = Math.max(0, count - MAX_EVENTS);
    events = [];
    for (let ordinal = start; ordinal < count; ordinal++) {
      const entry = ring[ordinal % MAX_EVENTS];
      try {
        events.push({ event: JSON.parse(entry.line), sequence: entry.sequence });
      } catch {
        reason('non-json-lines');
      }
    }
  }
  for (const { sequence, event } of events) {
    if (!object(event)) continue;
    const type = typeof event.type === 'string' ? event.type : typeof event.event === 'string' ? event.event : 'envelope';
    if (provider === 'gemini') {
      if (type === 'step_update' && object(event.step_update)) {
        const step = event.step_update;
        add(step.usage, {
          eventType: 'step_update',
          scope: 'step',
          sequence,
          sourceId: `step-${step.conversation_id ?? context.runId ?? 'unknown'}-${step.step_index ?? sequence}`,
          model: event.model,
        });
      } else {
        const result = object(event.result) ? event.result : event;
        add(result.usage, {
          eventType: type,
          scope: 'session-cumulative',
          cumulative: true,
          authoritative: true,
          sequence,
          sourceId: result.conversation_id ? `${result.conversation_id}-${result.num_turns ?? 'unknown'}` : null,
          model: result.model,
        });
      }
    } else if (provider === 'claude' && type === 'assistant' && object(event.message)) {
      add(event.message.usage, { eventType: type, scope: 'message', sequence, sourceId: event.message.id, model: event.message.model });
    } else if (provider === 'codex' && type === 'thread/tokenUsage/updated') {
      const params = event.params ?? {},
        tokenUsage = params.tokenUsage ?? params.token_usage ?? {};
      for (const [key, scope] of [
        ['last', 'turn'],
        ['total', 'session-cumulative'],
      ])
        if (object(tokenUsage[key])) {
          const data = tokenUsage[key];
          add(
            withoutUndefined({
              input_tokens: data.inputTokens,
              cached_input_tokens: data.cachedInputTokens,
              output_tokens: data.outputTokens,
              reasoning_tokens: data.reasoningOutputTokens,
              total_tokens: data.totalTokens,
            }),
            {
              eventType: type,
              scope,
              cumulative: key === 'total',
              sequence,
              sourceId: params.turnId ? `${params.threadId ?? 'thread'}-${params.turnId}-${key}` : null,
              model: params.model,
            },
          );
        }
    } else {
      const body = object(event.response) && object(event.response.usage) ? event.response : event;
      add(body.usage ?? body.stats, {
        eventType: type,
        scope: provider === 'codex' ? 'turn' : 'run',
        cumulative: provider === 'claude',
        authoritative:
          type === 'result' ||
          type === 'turn.completed' ||
          type === 'turn.failed' ||
          type === 'envelope' ||
          type === 'response.completed' ||
          type === 'response.failed',
        sequence,
        sourceId: body.id ?? body.responseId ?? event.turn_id ?? (body.session_id ? `${body.session_id}-${body.num_turns ?? 'unknown'}` : null),
        model: body.model,
      });
      // Per-model breakdown is corroborating detail, not an additional aggregate charge.
      if (provider === 'claude' && object(body.modelUsage))
        for (const [model, usage] of Object.entries(body.modelUsage).slice(0, 16)) {
          if (!object(usage)) continue;
          add(
            withoutUndefined({
              input_tokens: usage.inputTokens,
              output_tokens: usage.outputTokens,
              cache_read_input_tokens: usage.cacheReadInputTokens,
              cache_creation_input_tokens: usage.cacheCreationInputTokens,
            }),
            {
              eventType: 'modelUsage',
              scope: 'model-breakdown',
              cumulative: true,
              sequence,
              sourceId: `${body.session_id ?? context.runId ?? 'run'}-${model}`,
              model,
            },
          );
        }
    }
  }
  if (observations.some(item => item.authoritative)) observations.coverage = observations.truncated ? 'partial' : 'complete';
  else if (observations.length) {
    observations.coverage = 'partial';
    reason('terminal-usage-unavailable');
  }
  return observations;
}

/** Pin every executable JS file in the tokenizer package's ESM tree plus its package manifest. */
export async function createTokenizerPin(packageRoot) {
  const root = await fs.realpath(packageRoot),
    manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'gpt-tokenizer' || manifest.version !== '3.4.0') throw Error('Unsupported tokenizer package/version');
  const files = ['package.json'];
  async function walk(relative) {
    for (const entry of (await fs.readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw Error('Tokenizer symlinks are unsupported');
      const next = relative + '/' + entry.name;
      if (entry.isDirectory()) await walk(next);
      else if (entry.name.endsWith('.js')) files.push(next);
    }
  }
  await walk('esm');
  if (files.length > 4096) throw Error('Tokenizer tree too large');
  const entries = [];
  let bytes = 0;
  for (const file of files.sort()) {
    const data = await fs.readFile(path.join(root, file));
    bytes += data.length;
    if (bytes > 64 * 1024 * 1024) throw Error('Tokenizer tree too large');
    entries.push({ file, sha256: hash(data) });
  }
  return { engine: 'gpt-tokenizer', version: manifest.version, packageRoot: root, treeSha256: hash(JSON.stringify(entries)), fileCount: entries.length };
}

/** Counts only visible text. Even a tokenizer count is not the provider's full request or allowance. */
export async function measurePayload(text, options = {}) {
  if (typeof text !== 'string') throw Error('Payload must be text');
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw Error('Payload exceeds accounting bound');
  const result = {
    schemaVersion: 1,
    provider: cleanLabel(options.provider),
    model: cleanLabel(options.model),
    payloadSha256: hash(text),
    visibleBytes: Buffer.byteLength(text, 'utf8'),
    visibleCodePoints: codePoints(text),
    tokens: null,
    method: 'unavailable',
    mappingStatus: 'unverified',
    scope: 'visible-text-only',
    fullRequestExact: false,
    hiddenContext: 'unknown',
    modalities: options.hasImages ? 'non-text-unmeasured' : 'text-only',
    tokenizer: null,
    sections: [],
  };
  const pin = options.tokenizerPin;
  if (pin && options.provider === 'codex') {
    try {
      const actual = await createTokenizerPin(pin.packageRoot);
      if (actual.version !== pin.version || actual.treeSha256 !== pin.treeSha256) throw Error('Tokenizer integrity mismatch');
      const encoding = options.encoding ?? 'o200k_base';
      if (!['o200k_base', 'cl100k_base'].includes(encoding)) throw Error('Unsupported tokenizer encoding');
      const tokenizer = await import(pathToFileURL(path.join(actual.packageRoot, 'esm', 'encoding', encoding + '.js')).href);
      result.tokens = tokenizer.encode(text, { allowedSpecial: new Set(), disallowedSpecial: new Set() }).length;
      result.method = 'local-tokenizer-estimate';
      result.mappingStatus = 'unverified-model-mapping';
      result.tokenizer = { engine: actual.engine, version: actual.version, encoding, treeSha256: actual.treeSha256 };
    } catch {
      result.method = 'unavailable';
      result.unavailableReason = 'tokenizer-pin-or-implementation-unavailable';
    }
  } else if (options.heuristic === true) {
    result.tokens = Math.ceil(result.visibleCodePoints / 4);
    result.method = 'character-heuristic';
  }
  if (['claude', 'gemini'].includes(options.provider) && options.localTokenizers?.[options.provider]?.enabled === true) {
    try {
      const { countOfflineReference } = await import('./offline-reference.mjs');
      result.referenceCount = await countOfflineReference(text, {
        provider: options.provider,
        model: options.model,
        descriptor: options.localTokenizers[options.provider],
      });
    } catch {
      result.referenceCount = {
        status: 'unavailable',
        tokens: null,
        scope: 'visible-text-only',
        verifiedForRequestedModel: false,
        reasonCode: 'counter-unavailable',
      };
    }
  }
  let sectionBytes = 0;
  if (Array.isArray(options.sections))
    for (const section of options.sections.slice(0, 128)) {
      if (!object(section) || typeof section.text !== 'string') continue;
      const bytes = Buffer.byteLength(section.text, 'utf8');
      sectionBytes += bytes;
      if (sectionBytes > 16 * 1024 * 1024) {
        result.sectionsTruncated = true;
        break;
      }
      result.sections.push({ name: cleanLabel(section.name), visibleBytes: bytes, visibleCodePoints: codePoints(section.text) });
    }
  return result;
}
