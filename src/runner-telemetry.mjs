import { openJournal } from './event-journal.mjs';
import { extractUsageObservations, measurePayload } from './accounting.mjs';
import { refreshClosedJournal } from './index-refresh.mjs';

const inert = { emit: async () => false, measure: async () => null, capture: () => [], stream: () => {}, finish: async () => null };

/** Shadow-only adapter. Neither telemetry faults nor estimates authorize execution changes. */
export async function beginTelemetry(config, record, { journalFactory = openJournal, indexRefresh = refreshClosedJournal } = {}) {
  if (config.observability?.enabled !== true) return inert;
  let journal;
  try {
    journal = await journalFactory(config, record);
  } catch {
    record.observability = { enabled: false, healthy: false, errorCodes: ['journal-open-failed'] };
    return inert;
  }
  const emit = async (type, details = {}) => {
    try {
      return await journal.emit(type, details);
    } catch {
      return false;
    }
  };
  const streamedCounts = new Map();
  let streamOrdinal = 0,
    streamCaptureTruncated = false;
  const capture = (stdout, source = 'terminal', sequenceOffset = 0) => {
    try {
      const observations = extractUsageObservations(record.provider, String(stdout), {
        runId: record.runId,
        model: record.requestedModel,
        source,
        sequenceOffset,
      });
      if (observations.length) {
        // Keep final and stream snapshots separate; final parser controls terminal authority.
        if (source === 'terminal') {
          record.usageObservations = observations;
          record.usageCoverage =
            observations.truncated || streamCaptureTruncated ? 'partial' : observations.some(x => x.authoritative) ? 'observed' : 'partial';
          record.usageCapture = {
            coverage: observations.coverage ?? 'unknown',
            truncated: observations.truncated === true || streamCaptureTruncated,
            reasonCodes: observations.reasonCodes ?? [],
          };
          const latest = observations.findLast(x => x.authoritative);
          if (!record.usage && latest?.usage?.native) record.usage = latest.usage.native;
        }
        const remainingStreamed = source === 'terminal' ? new Map(streamedCounts) : null;
        const ordered =
          source === 'terminal' ? [...observations].sort((a, b) => Number(b.authoritative) - Number(a.authoritative) || b.sequence - a.sequence) : observations;
        for (const observation of ordered) {
          const u = observation.usage ?? {};
          // Match occurrences, not just equal token counts: anonymous equal turns remain separate.
          const key = JSON.stringify([
            observation.provider,
            observation.runId,
            observation.sourceId,
            observation.eventType,
            observation.scope,
            observation.actualModel,
            observation.authoritative,
            observation.cumulative,
            u.native,
          ]);
          if (source === 'stream') {
            if (streamedCounts.size >= 4096 && !streamedCounts.has(key)) {
              streamCaptureTruncated = true;
              continue;
            }
            streamedCounts.set(key, (streamedCounts.get(key) ?? 0) + 1);
          }
          if (remainingStreamed?.get(key) > 0) {
            remainingStreamed.set(key, remainingStreamed.get(key) - 1);
            continue;
          }
          void emit('usage.observed', {
            inputTokens: u.input,
            cachedTokens: u.cached,
            cacheCreationTokens: u.cacheCreation,
            outputTokens: u.output,
            thinkingTokens: u.thinking,
            totalTokens: u.total,
            source,
            scope: observation.scope,
            authoritative: observation.authoritative,
            cumulative: observation.cumulative,
            evidenceHash: observation.observationId,
          });
        }
      } else if (source === 'terminal') {
        record.usageObservations = [];
        record.usageCoverage = observations.truncated ? 'unknown' : 'absent';
        record.usageCapture = {
          coverage: observations.coverage ?? 'unknown',
          truncated: observations.truncated === true,
          reasonCodes: observations.reasonCodes ?? [],
        };
      }
      return observations;
    } catch {
      if (source === 'terminal') record.usageCoverage = 'unknown';
      return [];
    }
  };
  const stream = line => {
    const ordinal = streamOrdinal++;
    // No text chunks are persisted. Only bounded native terminal/usage events are interpreted.
    if (typeof line !== 'string') return;
    if (Buffer.byteLength(line) > 1048576) {
      streamCaptureTruncated = true;
      return;
    }
    if (!/"(?:usage|rate_limit_info)"\s*:/.test(line)) return;
    capture(line, 'stream', ordinal);
  };
  return {
    emit,
    capture,
    stream,
    measure: async text => {
      try {
        const value = await measurePayload(text, {
          provider: record.provider,
          model: record.requestedModel,
          tokenizerPin: config.observability?.tokenizerPin,
          localTokenizers: config.observability?.localTokenizers,
        });
        record.inputMeasurement = value;
        await emit('input.measured', { inputBytes: Buffer.byteLength(text) });
        return value;
      } catch {
        record.inputMeasurement = { status: 'unavailable', reason: 'measurement-failed' };
        return null;
      }
    },
    finish: async () => {
      try {
        await emit('run.finished', {
          status: record.status,
          elapsedMs: record.elapsedMs,
          exitCode: record.exitCode,
          stage: record.stage,
          failureClass: record.failureClass,
          stopReason: record.stopReason,
        });
        const health = await journal.close();
        record.observability = { ...health, path: health.journalPath ?? null };
        // Shared by reviewer and builder paths. Index only after known closure;
        // diagnostic failure never changes provider execution or acceptance.
        if (health.closed === true && !health.closePending && health.journalPath) {
          try {
            record.observability.index = await indexRefresh(config, health.journalPath);
          } catch {
            record.observability.index = { status: 'unavailable', reasonCode: 'index-refresh-failed' };
          }
        }
        return record.observability;
      } catch {
        record.observability = { enabled: true, healthy: false, errorCodes: ['journal-close-failed'] };
        return record.observability;
      }
    },
  };
}
