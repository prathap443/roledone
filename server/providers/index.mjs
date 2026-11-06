import { createAnthropicProvider } from './anthropic.mjs';
import { createMockProvider } from './mock.mjs';

/**
 * Select a provider from the environment. Returns null when AI is not configured;
 * the app then runs in browser-only mode and says so.
 *
 *   ROLEDONE_PROVIDER = anthropic | mock | off   (default: anthropic if ANTHROPIC_API_KEY is set, else off)
 *   ANTHROPIC_API_KEY, ANTHROPIC_MODEL (default claude-sonnet-5-5)
 */
export function providerFromEnv(env = process.env, { usage = null } = {}) {
  const choice = (env.ROLEDONE_PROVIDER || env.ROLEWOVEN_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : 'off')).toLowerCase(); // ROLEWOVEN_* kept for pre-rename deployments
  if (choice === 'off') return null;
  if (choice === 'mock') return createMockProvider();
  if (choice === 'anthropic') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('ROLEDONE_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set');
    return createAnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',          // match + CV suggestions
      fastModel: env.ANTHROPIC_MODEL_FAST || 'claude-haiku-5-5',  // everything else
      effort: ['low', 'medium', 'high'].includes(env.ANTHROPIC_EFFORT) ? env.ANTHROPIC_EFFORT : 'low',
      usage,
    });
  }
  throw new Error(`Unknown ROLEDONE_PROVIDER "${choice}" (expected anthropic, mock or off)`);
}
