// Monthly metering for the expensive AI calls. Counters are per subject (account id, else device id,
// else hashed IP) per calendar month per feature. The store is Supabase when configured, else memory.
// Limits are env-tunable: ROLEDONE_LIMITS='{"free":{"match":3},"pro":{"match":60,"suggestions":60}}'.

import { createHash } from 'node:crypto';

export const DEFAULT_LIMITS = {
  free: { match: 3, suggestions: 0 },
  pro: { match: 60, suggestions: 60 },
  premium: { match: 200, suggestions: 200 },
};

/** Which endpoints are metered, and under which feature name. */
export const METERED = { '/api/match': 'match', '/api/suggestions': 'suggestions' };

export const monthKey = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 7); // "2026-11" (UTC)

export function limitsFromEnv(env = process.env) {
  if (!env.ROLEDONE_LIMITS) return DEFAULT_LIMITS;
  try {
    const custom = JSON.parse(env.ROLEDONE_LIMITS);
    const out = {};
    for (const plan of Object.keys(DEFAULT_LIMITS)) out[plan] = { ...DEFAULT_LIMITS[plan], ...(custom[plan] || {}) };
    return out;
  } catch { console.error('[meter] ROLEDONE_LIMITS is not valid JSON; using defaults'); return DEFAULT_LIMITS; }
}

/** In-memory store: fine for a single process; resets on restart. */
export function memoryStore() {
  const counts = new Map();
  const key = (s, m, f) => `${s}|${m}|${f}`;
  return {
    async get(subject, month, feature) { return counts.get(key(subject, month, feature)) || 0; },
    async increment(subject, month, feature) { const k = key(subject, month, feature); const n = (counts.get(k) || 0) + 1; counts.set(k, n); return n; },
    async all(subject, month) { const out = {}; for (const [k, v] of counts) { const [s, m, f] = k.split('|'); if (s === subject && m === month) out[f] = v; } return out; },
  };
}

/** Supabase store over the usage_counters table (see migrations/002_usage.sql). Falls back to memory on error. */
export function supabaseStore(sb, { log = console } = {}) {
  const fallback = memoryStore();
  const safe = (fn, alt) => fn().catch((e) => { log.error?.(`[meter] supabase: ${e.message}`); return alt(); });
  return {
    get(subject, month, feature) { return safe(async () => (await sb.rest('GET', `/usage_counters?subject=eq.${encodeURIComponent(subject)}&month=eq.${month}&feature=eq.${feature}&select=count`))?.[0]?.count || 0, () => fallback.get(subject, month, feature)); },
    increment(subject, month, feature) { return safe(async () => Number(await sb.rest('POST', '/rpc/increment_usage', { body: { p_subject: subject, p_month: month, p_feature: feature } })), () => fallback.increment(subject, month, feature)); },
    all(subject, month) { return safe(async () => Object.fromEntries(((await sb.rest('GET', `/usage_counters?subject=eq.${encodeURIComponent(subject)}&month=eq.${month}&select=feature,count`)) || []).map((r) => [r.feature, r.count])), () => fallback.all(subject, month)); },
  };
}

export function createMeter({ store = memoryStore(), limits = DEFAULT_LIMITS, now = Date.now } = {}) {
  return {
    limits,
    /** Who the counter belongs to. Account beats device beats IP. */
    subjectFor(req, user) {
      if (user?.id) return `user:${user.id}`;
      const device = String(req.headers['x-roledone-device'] || '').trim();
      if (/^[A-Za-z0-9_-]{16,64}$/.test(device)) return `dev:${device}`;
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
      return `ip:${createHash('sha256').update(ip).digest('hex').slice(0, 24)}`;
    },
    limitFor(plan, feature) { const l = limits[plan] ?? limits.free; return l[feature] ?? Infinity; },
    /** Check before the call. Admins are never metered. */
    async check({ subject, plan, feature, admin = false }) {
      const limit = admin ? Infinity : this.limitFor(plan, feature);
      const used = await store.get(subject, monthKey(now()), feature);
      return { allowed: used < limit, used, limit, remaining: Math.max(0, limit - used) };
    },
    /** Count after a successful call. */
    async bump({ subject, feature }) { return store.increment(subject, monthKey(now()), feature); },
    /** Everything this subject has used this month plus their limits: for /api/me. */
    async summary({ subject, plan, admin = false }) {
      const used = await store.all(subject, monthKey(now()));
      const out = {};
      for (const feature of new Set([...Object.keys(limits[plan] || limits.free), ...Object.keys(used)])) {
        const limit = admin ? null : this.limitFor(plan, feature);
        out[feature] = { used: used[feature] || 0, limit: Number.isFinite(limit) ? limit : null };
      }
      return { month: monthKey(now()), features: out };
    },
  };
}
