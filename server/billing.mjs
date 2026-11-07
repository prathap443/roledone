// Billing wiring from the environment. Returns null when Stripe is not configured (free/dev mode).
import { createStripe } from './stripe.mjs';
import { createEntitlements } from './entitlement.mjs';
import { createSupabase } from './supabase.mjs';

/** Auth/database wiring; null when Supabase is not configured (no accounts, device tokens only). */
export function authFromEnv(env = process.env, { fetchImpl } = {}) {
  if (!env.SUPABASE_URL && !env.SUPABASE_ANON_KEY && !env.SUPABASE_SERVICE_KEY) return null;
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Auth: ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing`);
  return createSupabase({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, serviceKey: env.SUPABASE_SERVICE_KEY, fetchImpl });
}

export function billingFromEnv(env = process.env, { fetchImpl } = {}) {
  if (!env.STRIPE_SECRET_KEY) return null;
  const missing = ['STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PRO', 'APP_URL'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Billing: STRIPE_SECRET_KEY is set but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing`);
  const prices = { pro: env.STRIPE_PRICE_PRO, ...(env.STRIPE_PRICE_PREMIUM ? { premium: env.STRIPE_PRICE_PREMIUM } : {}) };
  const stripe = createStripe({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, prices, appUrl: env.APP_URL.replace(/\/$/, ''), fetchImpl });
  const entitlements = createEntitlements({ secret: env.ROLEDONE_TOKEN_SECRET || env.STRIPE_WEBHOOK_SECRET, stripe });
  return { stripe, entitlements, mode: env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test' };
}
