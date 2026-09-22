import { loadConfig } from '../src/config.mjs';
import { ensureGeminiAgent } from '../src/antigravity.mjs';
if (process.argv[2] !== '--install-agents' || !process.argv[3])
  throw Error('Explicit setup only: node scripts/setup-gemini.mjs --install-agents config/your.local.json');
console.log(JSON.stringify(await ensureGeminiAgent(await loadConfig(process.argv[3]), process.env, true), null, 2));
