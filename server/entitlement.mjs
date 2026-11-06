// Entitlements without accounts: a signed token the browser that paid sends with every request.
// Token = base64url(JSON) + "." + HMAC. It carries the Stripe customer, subscription, plan and the
// current period end. The server re-checks the subscription with Stripe when its cached view is stale,
// so cancellations and failed payments take effect without a restart or a webhook.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

const RANK = { free: 0, pro: 1, premium: 2 };
const GRACE_MS = 3 * 24 * 3600 * 1000;     // keep access 3 days past period end (renewal lag)
const RECHECK_MS = 6 * 3600 * 1000;         // re-verify with Stripe every 6 hours per subscription
const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(s, 'base64url').toString('utf8');

export function createEntitlements({ secret, stripe = null, now = Date.now } = {}) {
  if (!secret) throw new Error('entitlement secret is required');
  const key = createHash('sha256').update(`roledone-entitlement:${secret}`).digest();
  const sign = (payload) => createHmac('sha256', key).update(payload).digest('base64url');
  const subs = new Map(); // subscriptionId -> { plan, status, periodEnd, checkedAt }

  const active = (s) => (s.status === 'active' || s.status === 'trialing' || s.status === 'past_due') && s.periodEnd + GRACE_MS > now();

  return {
    RANK,
    /** Remember what we know about a subscription (from checkout, webhook or a re-check). */
    remember(info) { subs.set(info.subscriptionId, { plan: info.plan, status: info.status, periodEnd: info.periodEnd, checkedAt: now() }); return info; },
    issue(info) {
      const payload = b64(JSON.stringify({ cus: info.customerId, sub: info.subscriptionId, plan: info.plan, end: info.periodEnd, iat: now() }));
      return `${payload}.${sign(payload)}`;
    },
    /** Parse and verify the signature; returns the claims or null. Does not check the subscription. */
    parse(token) {
      if (!token || typeof token !== 'string') return null;
      const [payload, sig] = token.split('.');
      if (!payload || !sig) return null;
      const expected = Buffer.from(sign(payload)), given = Buffer.from(sig);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
      try { const c = JSON.parse(unb64(payload)); return c?.sub && c?.plan ? c : null; } catch { return null; }
    },
    /** Current plan for a token: 'free' when missing, invalid, cancelled or expired. Re-checks Stripe when stale. */
    async planFor(token) {
      const claims = this.parse(token);
      if (!claims) return { plan: 'free', claims: null };
      let known = subs.get(claims.sub);
      if (!known || now() - known.checkedAt > RECHECK_MS) {
        if (stripe) { try { known = this.remember(await stripe.subscription(claims.sub)); } catch { known = known || { plan: claims.plan, status: 'active', periodEnd: claims.end, checkedAt: now() }; } }
        else known = { plan: claims.plan, status: 'active', periodEnd: claims.end, checkedAt: now() };
        subs.set(claims.sub, known);
      }
      return { plan: active(known) ? known.plan || 'free' : 'free', claims, status: known.status, periodEnd: known.periodEnd };
    },
    allows(plan, required) { return (RANK[plan] ?? 0) >= (RANK[required] ?? 0); },
    /** Apply a webhook event to the cache. */
    applyEvent(event, info) {
      if (!info?.subscriptionId) return;
      if (event === 'customer.subscription.deleted') this.remember({ ...info, status: 'canceled' });
      else this.remember(info);
    },
  };
}
