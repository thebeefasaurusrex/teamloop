/** Metadata only: never return thinking, text, tool inputs, IDs, or native error strings. */
export function summarizeClaudeProgress(stdout) {
  const summary = { thinkingProgressEvents: 0, thinkingBlocks: 0, textBlocks: 0, toolBlocks: 0, resultEvents: 0, reportedThinkingDurationMs: 0 };
  for (const line of String(stdout ?? '').split(/\r?\n/)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'system' && event.subtype === 'thinking_tokens') summary.thinkingProgressEvents++;
    if (event.type === 'result') summary.resultEvents++;
    if (event.type !== 'assistant') continue;
    if (Number.isSafeInteger(event.thinking_duration_ms) && event.thinking_duration_ms >= 0) summary.reportedThinkingDurationMs += event.thinking_duration_ms;
    for (const block of Array.isArray(event.message?.content) ? event.message.content : []) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'thinking') summary.thinkingBlocks++;
      if (block.type === 'text') summary.textBlocks++;
      if (block.type === 'tool_use') summary.toolBlocks++;
    }
  }
  return summary;
}
