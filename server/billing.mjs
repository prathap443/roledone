// Billing wiring from the environment. Returns null when Stripe is not configured (free/dev mode).
import { createStripe } from './stripe.mjs';
import { createEntitlements } from './entitlement.mjs';

export function billingFromEnv(env = process.env, { fetchImpl } = {}) {
  if (!env.STRIPE_SECRET_KEY) return null;
  const missing = ['STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PRO', 'APP_URL'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Billing: STRIPE_SECRET_KEY is set but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing`);
  const prices = { pro: env.STRIPE_PRICE_PRO, ...(env.STRIPE_PRICE_PREMIUM ? { premium: env.STRIPE_PRICE_PREMIUM } : {}) };
  const stripe = createStripe({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET, prices, appUrl: env.APP_URL.replace(/\/$/, ''), fetchImpl });
  const entitlements = createEntitlements({ secret: env.ROLEDONE_TOKEN_SECRET || env.STRIPE_WEBHOOK_SECRET, stripe });
  return { stripe, entitlements, mode: env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'live' : 'test' };
}
