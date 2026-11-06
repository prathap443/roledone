// Minimal Stripe client (REST over fetch, no SDK) plus webhook signature verification.
// Only what Roledone needs: Checkout Sessions, Subscriptions, the Customer Portal.

import { createHmac, timingSafeEqual } from 'node:crypto';

const API = (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '') + '/v1'; // override for tests only

const form = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => {
  const key = prefix ? `${prefix}[${k}]` : k;
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap((x, i) => (typeof x === 'object' ? form(x, `${key}[${i}]`) : [`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(x)}`]));
  if (typeof v === 'object') return form(v, key);
  return [`${encodeURIComponent(key)}=${encodeURIComponent(v)}`];
}).join('&');

export function createStripe({ secretKey, webhookSecret, prices, appUrl, fetchImpl = fetch } = {}) {
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY is required');
  const planOf = (priceId) => Object.entries(prices).find(([, id]) => id === priceId)?.[0] || null;

  async function call(method, path, body) {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}`, 'content-type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' },
      body: body ? form(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Stripe ${res.status}: ${data.error?.message || 'request failed'}`);
      err.status = 502; throw err;
    }
    return data;
  }

  const subscriptionInfo = (sub) => ({
    subscriptionId: sub.id,
    customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    plan: planOf(sub.items?.data?.[0]?.price?.id),
    status: sub.status, // active | trialing | past_due | canceled | unpaid | incomplete
    periodEnd: (sub.current_period_end || sub.items?.data?.[0]?.current_period_end || 0) * 1000,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  });

  return {
    prices, planOf,
    /** Hosted Checkout for a plan. Returns the URL to send the browser to. */
    async checkoutUrl({ plan, email, clientRef }) {
      const price = prices[plan];
      if (!price) throw Object.assign(new Error(`No price configured for plan "${plan}"`), { status: 400 });
      const session = await call('POST', '/checkout/sessions', {
        mode: 'subscription',
        line_items: [{ price, quantity: 1 }],
        success_url: `${appUrl}/?session_id={CHECKOUT_SESSION_ID}#overview`,
        cancel_url: `${appUrl}/#overview`,
        allow_promotion_codes: 'true',
        billing_address_collection: 'auto',
        customer_email: email || undefined,
        client_reference_id: clientRef || undefined,
        subscription_data: { metadata: { app: 'roledone', plan } },
      });
      return session.url;
    },
    /** After Checkout returns, confirm the session really paid and read the subscription. */
    async confirmCheckout(sessionId) {
      if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) throw Object.assign(new Error('Invalid session id'), { status: 400 });
      const session = await call('GET', `/checkout/sessions/${sessionId}?expand[]=subscription`);
      if (session.payment_status !== 'paid' && session.status !== 'complete') throw Object.assign(new Error('Checkout is not complete'), { status: 402 });
      const sub = session.subscription;
      if (!sub || typeof sub !== 'object') throw Object.assign(new Error('No subscription on this session'), { status: 402 });
      return { ...subscriptionInfo(sub), email: session.customer_details?.email || session.customer_email || null };
    },
    async subscription(id) { return subscriptionInfo(await call('GET', `/subscriptions/${id}`)); },
    /** Customer Portal link for managing the subscription. */
    async portalUrl(customerId) {
      const s = await call('POST', '/billing_portal/sessions', { customer: customerId, return_url: `${appUrl}/#overview` });
      return s.url;
    },
    /** Verify a webhook payload against the Stripe-Signature header. Returns the event or throws. */
    verifyWebhook(rawBody, header, { toleranceSec = 300, now = Date.now } = {}) {
      if (!webhookSecret) throw Object.assign(new Error('STRIPE_WEBHOOK_SECRET is not set'), { status: 500 });
      const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.split('=').map((x) => x.trim())));
      const t = parts.t, v1 = parts.v1;
      if (!t || !v1) throw Object.assign(new Error('Missing signature'), { status: 400 });
      if (Math.abs(now() / 1000 - Number(t)) > toleranceSec) throw Object.assign(new Error('Signature too old'), { status: 400 });
      const expected = createHmac('sha256', webhookSecret).update(`${t}.${rawBody}`).digest('hex');
      const a = Buffer.from(expected), b = Buffer.from(v1);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw Object.assign(new Error('Bad signature'), { status: 400 });
      return JSON.parse(rawBody);
    },
    subscriptionInfo,
  };
}
