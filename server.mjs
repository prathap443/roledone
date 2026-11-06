import http from 'node:http';
import { createHandler } from './server/api.mjs';
import { createAI } from './server/ai.mjs';
import { providerFromEnv } from './server/providers/index.mjs';
import { createUsage } from './server/usage.mjs';

// Load .env for local development only; Replit and production use real environment variables.
try { process.loadEnvFile?.(); } catch { /* no .env file */ }

const usage = createUsage();
const provider = providerFromEnv(process.env, { usage }); // throws loudly on a misconfigured provider
const ai = createAI(provider);
const port = Number(process.env.PORT || 3000);

http.createServer(createHandler({ ai, usage })).listen(port, '0.0.0.0', () => {
  const status = ai.status();
  console.log(`Roledone: http://localhost:${port}`);
  console.log(status.ai ? `AI: ${status.provider} (quality: ${status.model}, fast: ${status.fastModel})` : 'AI: not configured — browser-only mode. Set ANTHROPIC_API_KEY to enable.');
});
