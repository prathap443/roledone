// Supabase: session verification (who is this request from?) and the subscriptions table.
// REST only, no SDK. The service key is used server-side for the table; the anon key for auth lookups.

import { createHash } from 'node:crypto';

export function createSupabase({ url, anonKey, serviceKey, fetchImpl = fetch, now = Date.now } = {}) {
  if (!url || !anonKey || !serviceKey) throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_KEY are required');
  const base = url.replace(/\/$/, '');
  const userCache = new Map(); // sha256(token) -> { user, at }
  const USER_TTL = 5 * 60 * 1000;

  async function rest(method, path, { body, prefer, service = true } = {}) {
    const res = await fetchImpl(`${base}/rest/v1${path}`, {
      method,
      headers: { apikey: service ? serviceKey : anonKey, Authorization: `Bearer ${service ? serviceKey : anonKey}`, 'content-type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) { const text = await res.text().catch(() => ''); throw Object.assign(new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`), { status: 502 }); }
    return res.status === 204 ? null : res.json();
  }

  return {
    publicConfig: { url: base, anonKey },
    rest,
    /** Append one AI call to usage_events (fire-and-forget by the caller). */
    recordUsage(row) { return rest('POST', '/usage_events', { body: row, prefer: 'return=minimal' }); },
    /** Per-tool totals for a month via the usage_summary function. */
    usageSummary(month) { return rest('POST', '/rpc/usage_summary', { body: { p_month: month } }); },

    /** Resolve a Supabase access token to { id, email } or null. Cached briefly per token. */
    async userFromToken(token) {
      if (!token || typeof token !== 'string' || token.length > 8192) return null;
      const key = createHash('sha256').update(token).digest('hex');
      const hit = userCache.get(key);
      if (hit && now() - hit.at < USER_TTL) return hit.user;
      const res = await fetchImpl(`${base}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
      if (res.status === 401 || res.status === 403) { userCache.set(key, { user: null, at: now() - USER_TTL + 30_000 }); return null; } // bad/expired token: remember for 30s only
      if (!res.ok) throw Object.assign(new Error('Could not verify your sign-in just now. Try again in a moment.'), { status: 503 }); // Supabase blip: never downgrade a paying user silently
      const u = await res.json();
      const user = u?.id ? { id: u.id, email: u.email || null } : null;
      userCache.set(key, { user, at: now() });
      if (userCache.size > 5000) for (const [k, v] of userCache) if (now() - v.at > USER_TTL) userCache.delete(k);
      return user;
    },

    /** Subscription row for a user, or null. */
    async subscriptionForUser(userId) {
      const rows = await rest('GET', `/subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`);
      return rows?.[0] || null;
    },
    async subscriptionByStripeId(subscriptionId) {
      const rows = await rest('GET', `/subscriptions?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=*&limit=1`);
      return rows?.[0] || null;
    },
    /** Insert or update the user's subscription (one row per user). */
    async upsertSubscription({ userId, email, info }) {
      const row = {
        user_id: userId, email: email || null,
        stripe_customer_id: info.customerId, stripe_subscription_id: info.subscriptionId,
        plan: info.plan, status: info.status, period_end: info.periodEnd ? new Date(info.periodEnd).toISOString() : null,
        cancel_at_period_end: Boolean(info.cancelAtPeriodEnd), updated_at: new Date(now()).toISOString(),
      };
      const rows = await rest('POST', '/subscriptions?on_conflict=user_id', { body: row, prefer: 'resolution=merge-duplicates,return=representation' });
      return rows?.[0] || row;
    },
    /** Update by Stripe subscription id (webhooks don't know the user). */
    async updateByStripeId(subscriptionId, info) {
      const patch = { plan: info.plan, status: info.status, period_end: info.periodEnd ? new Date(info.periodEnd).toISOString() : null, cancel_at_period_end: Boolean(info.cancelAtPeriodEnd), updated_at: new Date(now()).toISOString() };
      const rows = await rest('PATCH', `/subscriptions?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}`, { body: patch, prefer: 'return=representation' });
      return rows?.[0] || null;
    },
  };
}

/** Plan a subscription row grants right now. */
export function planFromRow(row, { now = Date.now, graceMs = 3 * 24 * 3600 * 1000 } = {}) {
  if (!row) return 'free';
  const active = ['active', 'trialing', 'past_due'].includes(row.status);
  const end = row.period_end ? new Date(row.period_end).getTime() : 0;
  return active && end + graceMs > now() ? row.plan || 'free' : 'free';
}
