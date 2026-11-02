export const policy = Object.freeze({
  version: 'mac-0.1.1',
  dailyClaudeRecheck: false,
  paidAPIFallback: false,
  automaticRetries: false,
  warningThresholdsUsed: [50, 75, 90],
  billingNotice:
    'Account billing settings are managed by each provider. TeamLoop never enables credits or auto-reload. Subscription-only subprocess settings do not enforce an account-wide spending cap.',
  availabilityNotice: 'Model access and native Mac behavior require qualification on the connected machine.',
});

export const defaults = Object.freeze({
  monitoringEnabled: true,
  preventSleep: true,
  launchAtLogin: false,
  pollSeconds: 300,
  emailEnabled: false,
  emailTo: '',
  relayURL: '',
  projectDir: '',
  enabledProviders: ['codex', 'claude', 'gemini'],
  paths: { codex: '', claude: '', agy: '', codexbar: '' },
  models: {
    codex: 'gpt-6.1-sol',
    claude: 'claude-sonnet-5-5',
    gemini: 'gemini-3.8-flash-high',
    deepseek: 'deepseek-flash',
    nvidia: 'nvidia/nemotron-3-ultra-550b-a55b',
  },
});

export function cleanError(error) {
  if (error instanceof SyntaxError) return 'A JSON document could not be read';
  const message = String(error?.message ?? error ?? 'Operation failed');
  // Prefer generic provider errors over retaining arbitrary provider output or transport URLs.
  return message
    .replace(/(?:Bearer\s+\S+|sk-[\w-]+|nvapi-[\w-]+|AIza[\w-]+|re_[\w-]+)/gi, '[redacted]')
    .replace(/https?:\/\/\S+/g, '[service URL]')
    .slice(0, 500);
}
