import { createHash } from 'node:crypto';

const hash = content => createHash('sha256').update(content).digest('hex');
const lines = content => content.match(/[^\n]*\n|[^\n]+$/g) ?? [''];
const range = value =>
  value && Number.isSafeInteger(value.startLine) && value.startLine > 0 && Number.isSafeInteger(value.endLine) && value.endLine >= value.startLine;
const truncation =
  /^\s*(?:Warning: truncated output(?:\s|$)|(?:\[?\.{3}|…)?\s*[\d,]+\s+(?:bytes|characters|tokens)\s+truncated(?:\s*\.{3}|…)?\]?\s*$|\[truncated\]\s*$)/i;

/** Select explicit line ranges and verify declared evidence without reading additional files. */
export function selectEvidence(inputs, spec = {}) {
  const sources = [];
  const findings = [];
  const slices = spec.sourceSlices ?? [];
  if (!Array.isArray(slices) || slices.length > inputs.length) throw Error('sourceSlices must be a bounded array of selected paths');
  const byPath = new Map();
  for (const slice of slices) {
    if (
      !slice ||
      !inputs.some(input => input.path === slice.path) ||
      byPath.has(slice.path) ||
      !range(slice) ||
      typeof slice.reason !== 'string' ||
      !slice.reason.trim()
    )
      throw Error('Invalid or duplicate source slice; specify selected path, line range and reason');
    byPath.set(slice.path, slice);
  }
  for (const input of inputs) {
    if (input.missing) {
      findings.push({ code: 'missing-file', path: input.path });
      continue;
    }
    const slice = byPath.get(input.path);
    const sourceLines = lines(input.content);
    if (slice && slice.endLine > sourceLines.length) {
      findings.push({ code: 'missing-lines', path: input.path, startLine: slice.startLine, endLine: slice.endLine, totalLines: sourceLines.length });
      continue;
    }
    const content = slice ? sourceLines.slice(slice.startLine - 1, slice.endLine).join('') : input.content;
    const source = slice
      ? {
          path: input.path,
          sha256: hash(content),
          content,
          originalSha256: input.sha256,
          coverage: {
            startLine: slice.startLine,
            endLine: slice.endLine,
            totalLines: sourceLines.length,
            reason: slice.reason,
            omittedLines: sourceLines.length - (slice.endLine - slice.startLine + 1),
          },
        }
      : input;
    sources.push(source);
    lines(content).forEach((line, index) => {
      if (truncation.test(line.trimEnd())) findings.push({ code: 'truncated-source', path: input.path, line: (slice?.startLine ?? 1) + index });
    });
  }
  let manifest;
  let covered = 0;
  if (spec.evidenceManifest !== undefined) {
    const declaration = spec.evidenceManifest;
    if (!declaration || declaration.version !== 1 || !Array.isArray(declaration.required) || !declaration.required.length || declaration.required.length > 128)
      throw Error('Evidence manifest requires version 1 and 1-128 required inputs');
    const seen = new Set();
    const required = declaration.required.map(item => {
      if (
        !item ||
        typeof item.requirement !== 'string' ||
        !item.requirement.trim() ||
        item.requirement.length > 200 ||
        typeof item.path !== 'string' ||
        !item.path ||
        (item.lines !== undefined && !range(item.lines)) ||
        (item.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(item.sha256))
      )
        throw Error('Invalid required evidence declaration');
      const key = JSON.stringify([item.requirement, item.path, item.lines ?? null]);
      if (seen.has(key)) throw Error('Duplicate required evidence declaration');
      seen.add(key);
      const input = inputs.find(source => source.path === item.path && !source.missing);
      const selected = sources.find(source => source.path === item.path);
      const resolved = { ...item, ...(input ? { sha256: input.sha256 } : {}) };
      const pointer = { requirement: item.requirement, path: item.path, ...(item.lines ?? {}) };
      if (!input || !selected) {
        findings.push({ code: 'missing-required-input', ...pointer });
        return resolved;
      }
      if (item.sha256 !== undefined && item.sha256 !== input.sha256) {
        findings.push({ code: 'source-drift', ...pointer });
        return resolved;
      }
      const totalLines = lines(input.content).length;
      const startLine = selected.coverage?.startLine ?? 1;
      const endLine = selected.coverage?.endLine ?? totalLines;
      if (item.lines ? item.lines.endLine > totalLines || item.lines.startLine < startLine || item.lines.endLine > endLine : !!selected.coverage) {
        findings.push({ code: 'missing-required-coverage', ...pointer, selectedStartLine: startLine, selectedEndLine: endLine });
      } else covered++;
      return resolved;
    });
    manifest = { version: 1, required };
  }
  const report = {
    status: findings.length ? 'awaiting_evidence' : 'ready',
    manifestDeclared: manifest !== undefined,
    semanticSufficiency: 'lead-decision',
    required: manifest?.required.length ?? 0,
    covered,
    sources: sources.map(source => ({
      path: source.path,
      sha256: source.originalSha256 ?? source.sha256,
      selectedSha256: source.sha256,
      coverage: source.coverage ?? 'full',
    })),
    findings,
  };
  return { sources, manifest, report };
}

/** Failed reports remain compact and carry exact relative source pointers. */
export function assertEvidence(report) {
  if (report.status !== 'ready') {
    const error = new Error(`Evidence incomplete: ${report.findings.map(item => `${item.code}: ${item.path}`).join('; ')}`);
    error.evidenceReport = report;
    throw error;
  }
}
