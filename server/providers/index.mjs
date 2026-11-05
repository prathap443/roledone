import { createAnthropicProvider } from './anthropic.mjs';
import { createMockProvider } from './mock.mjs';

/**
 * Select a provider from the environment. Returns null when AI is not configured;
 * the app then runs in browser-only mode and says so.
 *
 *   ROLEWOVEN_PROVIDER = anthropic | mock | off   (default: anthropic if ANTHROPIC_API_KEY is set, else off)
 *   ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default claude-sonnet-5-5)
 */
export function providerFromEnv(env = process.env) {
  const choice = (env.ROLEWOVEN_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : 'off')).toLowerCase();
  if (choice === 'off') return null;
  if (choice === 'mock') return createMockProvider();
  if (choice === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ROLEWOVEN_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set');
    return createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' });
  }
  throw new Error(`Unknown ROLEWOVEN_PROVIDER "${choice}" (expected anthropic, mock or off)`);
}
