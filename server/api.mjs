// HTTP API: JSON endpoints in front of the AI layer, plus static file serving.
// Request bodies are size-capped, rate-limited per client, and never logged.

import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { LIMITS, isLogistics } from './validate.mjs';
import { planFromRow } from './supabase.mjs';
import { METERED } from './meter.mjs';
import { usageContext } from './usage.mjs';

const MAX_BODY = 256 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.json': 'application/json', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.webm': 'video/webm' };
const csp = ({ connect = [] } = {}) => [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "media-src 'self'",
  `connect-src 'self'${connect.map((o) => ' ' + o).join('')}`, // the browser talks to Supabase Auth directly
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

/** Fixed-window in-memory rate limiter. Sufficient for a single-instance prototype. */
export function createRateLimiter({ limit = 40, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.reset < now) { entry = { count: 0, reset: now + windowMs }; hits.set(key, entry); }
    entry.count++;
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), reset: entry.reset };
  };
}

function readRaw(req, limit = MAX_BODY) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => reject(new HttpError(400, 'Request aborted')));
  });
}

function readJson(req) {
  return new Promise((resolvePromise, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return reject(new HttpError(415, 'Send application/json'));
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_BODY) return reject(new HttpError(413, 'Request too large'));
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new HttpError(400, 'Invalid JSON')); } });
    req.on('error', () => reject(new HttpError(400, 'Request aborted')));
  });
}

const text = (v, max, field, { required = true } = {}) => {
  if (v == null || v === '') { if (required) throw new HttpError(400, `${field} is required`); return ''; }
  if (typeof v !== 'string') throw new HttpError(400, `${field} must be a string`);
  if (v.length > max) throw new HttpError(413, `${field} exceeds ${max.toLocaleString('en-GB')} characters`);
  return v;
};

const reqList = (v) => (Array.isArray(v) ? v : []).slice(0, LIMITS.requirements)
  .map((r) => ({ name: text(r?.name, 80, 'requirement.name'), status: ['evidence', 'partial', 'gap'].includes(r?.status) ? r.status : 'gap' }))
  .filter((r) => !isLogistics(r.name)); // older saved workspaces may still carry logistics rows

const RANK_FALLBACK = { free: 0, pro: 1, premium: 2 };
/** Minimum plan per AI endpoint. Scan summary stays free: it is the conversion hook. */
const REQUIRED_PLAN = { '/api/suggestions': 'pro', '/api/gap-questions': 'pro', '/api/gap-bullet': 'pro', '/api/questions': 'pro', '/api/feedback': 'pro', '/api/structure': 'pro', '/api/mock-debrief': 'premium' };

export function createHandler({ ai, root = resolve('dist'), rateLimit = createRateLimiter(), log = console, usage = null, billing = null, auth = null, jobs = null, blog = null, meter = null, adminEmails = (process.env.ROLEDONE_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean) } = {}) {
  const CSP = csp({ connect: auth ? [new URL(auth.publicConfig.url).origin] : [] });
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(body));
  };

  const RANK = { free: 0, pro: 1, premium: 2 };
  const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
  /** Signed-in user for the request, or null. */
  const userFor = async (req) => (auth ? auth.userFromToken(bearer(req)) : null);

  // Effective plan: the best of (server default, account subscription, device entitlement token).
  async function planFor(req) {
    const base = ai.status().defaultPlan || 'free';
    const out = { plan: base, source: 'default', user: null, claims: null, status: null, periodEnd: null };
    const consider = (plan, extra) => { if ((RANK[plan] ?? 0) > (RANK[out.plan] ?? 0)) Object.assign(out, { plan }, extra); };
    if (auth) {
      const user = await userFor(req);
      if (user) {
        out.user = user;
        if (user.email && adminEmails.includes(user.email.toLowerCase())) { consider('premium', { source: 'admin' }); out.admin = true; }
        const row = await auth.subscriptionForUser(user.id).catch(() => null);
        if (row) { out.subscription = row; consider(planFromRow(row), { source: 'account', status: row.status, periodEnd: row.period_end ? new Date(row.period_end).getTime() : null }); }
      }
    }
    if (billing && req.headers['x-roledone-token']) {
      const e = await billing.entitlements.planFor(req.headers['x-roledone-token']);
      out.claims = e.claims;
      if (e.claims) consider(e.plan, { source: 'device', status: e.status, periodEnd: e.periodEnd });
    }
    return out;
  }

  async function api(req, res, pathname) {
    if (pathname === '/api/status' && req.method === 'GET') return send(res, 200, { ...ai.status(), billing: Boolean(billing), plans: billing ? Object.keys(billing.stripe.prices) : [], auth: auth ? auth.publicConfig : null });
    if (pathname === '/api/me' && req.method === 'GET') {
      const e = await planFor(req);
      const quota = meter ? await meter.summary({ subject: meter.subjectFor(req, e.user), plan: e.plan, admin: Boolean(e.admin) }) : null;
      return send(res, 200, { user: e.user, plan: e.plan, source: e.source, status: e.status, renews: e.periodEnd, subscribed: Boolean(e.subscription || e.claims), admin: Boolean(e.admin), quota });
    }

    if (pathname === '/api/stripe/webhook' && req.method === 'POST') {
      if (!billing) throw new HttpError(404, 'Billing is not configured');
      const raw = await readRaw(req);
      const event = billing.stripe.verifyWebhook(raw, req.headers['stripe-signature']);
      const obj = event.data?.object || {};
      if (event.type === 'checkout.session.completed') {
        // Belt and braces: if the buyer closes the tab before /confirm runs, the account still gets its row.
        if (auth && obj.client_reference_id && obj.subscription) {
          try { const info = await billing.stripe.subscription(typeof obj.subscription === 'string' ? obj.subscription : obj.subscription.id); billing.entitlements.remember(info); await auth.upsertSubscription({ userId: obj.client_reference_id, email: obj.customer_details?.email || null, info }); }
          catch (e) { log.error(`[billing] could not record checkout for ${obj.client_reference_id}: ${e.message}`); }
        }
      }
      else if (event.type.startsWith('customer.subscription.')) {
        const info = billing.stripe.subscriptionInfo(obj);
        billing.entitlements.applyEvent(event.type, info);
        if (auth) await auth.updateByStripeId(info.subscriptionId, event.type === 'customer.subscription.deleted' ? { ...info, status: 'canceled' } : info).catch((e) => log.error(`[billing] db update failed: ${e.message}`));
      }
      else if (event.type === 'invoice.payment_failed' && obj.subscription) { try { const info = await billing.stripe.subscription(obj.subscription); billing.entitlements.remember(info); if (auth) await auth.updateByStripeId(info.subscriptionId, info); } catch { /* re-checked later */ } }
      log.info?.(`[billing] webhook ${event.type}`);
      return send(res, 200, { received: true });
    }
    if (pathname.startsWith('/api/billing/')) {
      if (!billing) throw new HttpError(404, 'Billing is not configured');
      if (pathname === '/api/billing/status' && req.method === 'GET') { const e = await planFor(req); return send(res, 200, { plan: e.plan, status: e.status || null, renews: e.periodEnd || null, subscribed: Boolean(e.subscription || e.claims), source: e.source, user: e.user }); }
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
      const body = await readJson(req);
      if (pathname === '/api/billing/checkout') {
        const plan = ['pro', 'premium'].includes(body.plan) ? body.plan : 'pro';
        const user = await userFor(req);
        if (auth && !user) throw new HttpError(401, 'Sign in first so your subscription is attached to your account.');
        const email = user?.email || (typeof body.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email) ? body.email : undefined);
        return send(res, 200, { url: await billing.stripe.checkoutUrl({ plan, email, clientRef: user?.id }) });
      }
      if (pathname === '/api/billing/confirm') {
        const info = await billing.stripe.confirmCheckout(text(body.session_id, 200, 'session_id'));
        if (!info.plan) throw new HttpError(402, 'Subscription price is not one of ours');
        billing.entitlements.remember(info);
        const user = await userFor(req);
        if (auth && user) await auth.upsertSubscription({ userId: user.id, email: user.email || info.email, info });
        log.info?.(`[billing] confirmed ${info.plan} for ${info.customerId}${user ? ` (user ${user.id})` : ''}`);
        return send(res, 200, { token: user ? null : billing.entitlements.issue(info), plan: info.plan, renews: info.periodEnd, email: info.email, attached: Boolean(user) });
      }
      if (pathname === '/api/billing/portal') {
        const e = await planFor(req);
        const customer = e.subscription?.stripe_customer_id || e.claims?.cus;
        if (!customer) throw new HttpError(401, 'No subscription found for this account or device');
        return send(res, 200, { url: await billing.stripe.portalUrl(customer) });
      }
      if (pathname === '/api/billing/attach') {
        // A subscription bought before sign-in existed lives in a device token; attach it to the account once.
        if (!auth) throw new HttpError(404, 'Accounts are not enabled');
        const user = await userFor(req);
        if (!user) throw new HttpError(401, 'Sign in first');
        const existing = await auth.subscriptionForUser(user.id);
        if (existing) return send(res, 200, { attached: false, reason: 'account already has a subscription' });
        const e = await billing.entitlements.planFor(req.headers['x-roledone-token']);
        if (!e.claims || e.plan === 'free') throw new HttpError(400, 'No active subscription on this device');
        const info = await billing.stripe.subscription(e.claims.sub);
        await auth.upsertSubscription({ userId: user.id, email: user.email, info });
        log.info?.(`[billing] attached ${info.subscriptionId} to user ${user.id}`);
        return send(res, 200, { attached: true, plan: info.plan });
      }
      throw new HttpError(404, 'Unknown endpoint');
    }
    if (pathname === '/api/jobs' && req.method === 'GET') {
      if (!jobs) throw new HttpError(404, 'Job search is not enabled on this server');
      const q = new URL(req.url, 'http://localhost').searchParams;
      if (q.get('featured') === '1') return send(res, 200, await jobs.featured({ country: q.get('country') || 'gb' }), { 'Cache-Control': 'public, max-age=600' });
      return send(res, 200, { ...(await jobs.search({ q: q.get('q') || '', where: q.get('where') || '', country: q.get('country') || 'gb', page: q.get('page') || 1 })), countries: jobs.countries }, { 'Cache-Control': 'public, max-age=300' });
    }
    if (pathname === '/api/usage' && req.method === 'GET') {
      // Aggregate token/cost/latency figures since the server started. No document content, no per-user data.
      if (!usage) throw new HttpError(404, 'Usage accounting is not enabled');
      const e = await planFor(req);
      if (!e.admin) throw new HttpError(403, 'Admin only');
      const month = new URL(req.url, 'http://localhost').searchParams.get('month') || new Date().toISOString().slice(0, 7);
      const stored = auth?.usageSummary ? await auth.usageSummary(month).catch(() => null) : null;
      return send(res, 200, { ...usage.summary(), month, stored });
    }
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
    if (!ai.provider) throw new HttpError(503, 'AI is not configured on this server. Set ANTHROPIC_API_KEY to enable it.');

    const client = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    const quota = rateLimit(client);
    if (!quota.allowed) throw new HttpError(429, 'Too many requests. Try again in a few minutes.');

    const required = REQUIRED_PLAN[pathname];
    const feature = METERED[pathname];
    let ent = null;
    if ((required && billing) || (feature && meter)) ent = await planFor(req);
    if (required && billing) { // without billing there is nothing to buy, so nothing to gate
      if ((RANK_FALLBACK[ent.plan] ?? 0) < RANK_FALLBACK[required]) {
        log.info?.(`[gate] ${pathname} 402 plan=${ent.plan} source=${ent.source} user=${ent.user ? ent.user.email || ent.user.id : 'none'} bearer=${bearer(req) ? 'yes' : 'no'} device-token=${req.headers['x-roledone-token'] ? 'yes' : 'no'}`);
        throw new HttpError(402, `This needs the ${required[0].toUpperCase() + required.slice(1)} plan.`);
      }
    }
    let metered = null;
    if (feature && meter) {
      const subject = meter.subjectFor(req, ent.user);
      const q = await meter.check({ subject, plan: ent.plan, feature, admin: Boolean(ent.admin) });
      if (!q.allowed) {
        const err = new HttpError(402, ent.plan === 'free' ? `You have used your ${q.limit} free ${feature === 'match' ? 'role matches' : 'suggestion runs'} this month. Upgrade to keep going.` : `You have reached this month's limit of ${q.limit} ${feature === 'match' ? 'role matches' : 'suggestion runs'} on the ${ent.plan[0].toUpperCase() + ent.plan.slice(1)} plan.`);
        err.extra = { code: 'quota', feature, used: q.used, limit: q.limit, plan: ent.plan };
        throw err;
      }
      metered = { subject, feature };
    }
    const ctx = { subject: metered?.subject || (ent ? meter?.subjectFor(req, ent.user) : null) || null, plan: ent?.plan || null };
    const out = await usageContext.run(ctx, () => aiCall(req, res, pathname, metered, ent));
    return out;
  }

  async function aiCall(req, res, pathname, metered, ent) {
    const body = await readJson(req);
    // Feature-level gate inside a Pro endpoint: follow-up reviews are Premium.
    if (pathname === '/api/feedback' && body.parent && billing) {
      const plan = ent?.plan || (await planFor(req)).plan;
      if ((RANK_FALLBACK[plan] ?? 0) < RANK_FALLBACK.premium) throw new HttpError(402, 'Answering follow-up questions needs the Premium plan.');
    }
    if (metered) res.once('finish', () => { if (res.statusCode === 200) meter.bump(metered).catch((e) => log.error(`[meter] bump failed: ${e.message}`)); }); // count successful calls only
    if (pathname === '/api/match') {
      const cv = text(body.cv, LIMITS.text, 'cv'), jd = text(body.jd, LIMITS.text, 'jd');
      return send(res, 200, await ai.match({ cv, jd }));
    }
    if (pathname === '/api/suggestions') {
      const cv = text(body.cv, LIMITS.text, 'cv'), draft = text(body.draft, LIMITS.text, 'draft'), jd = text(body.jd, LIMITS.text, 'jd', { required: false });
      return send(res, 200, await ai.suggest({ cv, draft, jd, requirements: reqList(body.requirements) }));
    }
    if (pathname === '/api/questions') {
      const cv = text(body.cv, LIMITS.text, 'cv'), jd = text(body.jd, LIMITS.text, 'jd');
      const level = ['screening', 'technical', 'senior'].includes(body.level) ? body.level : 'technical';
      const count = [5, 10, 25].includes(Number(body.count)) ? Number(body.count) : 5;
      return send(res, 200, await ai.questions({ cv, jd, requirements: reqList(body.requirements), level, count }));
    }
    if (pathname === '/api/gap-questions') {
      const cv = text(body.cv, LIMITS.text, 'cv'), jd = text(body.jd, LIMITS.text, 'jd', { required: false });
      const requirement = { name: text(body.requirement?.name, 80, 'requirement.name'), source: text(body.requirement?.source, 400, 'requirement.source', { required: false }) };
      return send(res, 200, await ai.gapQuestions({ cv, jd, requirement }));
    }
    if (pathname === '/api/gap-bullet') {
      const cv = text(body.cv, LIMITS.text, 'cv');
      const requirement = { name: text(body.requirement?.name, 80, 'requirement.name') };
      const questions = (Array.isArray(body.questions) ? body.questions : []).slice(0, 4).map((q) => text(q, LIMITS.question, 'question'));
      const answers = (Array.isArray(body.answers) ? body.answers : []).slice(0, 4).map((a) => text(a, 2000, 'answer', { required: false }));
      if (!questions.length || !answers.some((a) => /^yes\b/i.test(a.trim()) || a.trim().length >= 10)) throw new HttpError(400, 'Answer Yes to at least one question, or add a sentence of detail.');
      const otherGaps = reqList(body.otherGaps).map((r) => r.name);
      return send(res, 200, await ai.gapBullet({ cv, requirement, questions, answers, otherGaps, finalRound: body.finalRound === true }));
    }
    if (pathname === '/api/scan-summary') {
      const cv = text(body.cv, LIMITS.text, 'cv');
      const scan = body.scan;
      if (!scan || typeof scan.score !== 'number' || !scan.parts?.coverage) throw new HttpError(400, 'scan result is required');
      return send(res, 200, await ai.scanSummary({ cv, scan }));
    }
    if (pathname === '/api/structure') {
      const cv = text(body.cv, LIMITS.text, 'cv');
      return send(res, 200, await ai.structure({ cv }));
    }
    if (pathname === '/api/feedback') {
      const question = text(body.question, LIMITS.question, 'question'), answer = text(body.answer, LIMITS.answer, 'answer'), cv = text(body.cv, LIMITS.text, 'cv', { required: false });
      if (answer.trim().split(/\s+/).length < 8) throw new HttpError(400, 'Write a few sentences before requesting a review.');
      const parent = body.parent ? { question: text(body.parent.question, LIMITS.question, 'parent.question'), answer: text(body.parent.answer, LIMITS.answer, 'parent.answer') } : null;
      return send(res, 200, await ai.feedback({ question, answer, cv, parent }));
    }
    if (pathname === '/api/mock-debrief') {
      const cv = text(body.cv, LIMITS.text, 'cv'), jd = text(body.jd, LIMITS.text, 'jd', { required: false });
      const level = ['screening', 'technical', 'senior'].includes(body.level) ? body.level : 'technical';
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 10).map((it, i) => ({ prompt: text(it?.prompt, LIMITS.question, `items[${i}].prompt`), answer: text(it?.answer, LIMITS.answer, `items[${i}].answer`, { required: false }), type: ['depth', 'gap', 'behavioural', 'scenario'].includes(it?.type) ? it.type : '' }));
      if (items.length < 3) throw new HttpError(400, 'A mock session needs at least three questions.');
      if (!items.some((it) => it.answer.trim().split(/\s+/).length >= 8)) throw new HttpError(400, 'Answer at least one question before asking for a debrief.');
      return send(res, 200, await ai.mockDebrief({ cv, jd, level, items }));
    }
    throw new HttpError(404, 'Unknown endpoint');
  }

  async function staticFile(req, res, pathname) {
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      const data = await readFile(file);
      const type = MIME[extname(file)] || 'application/octet-stream';
      const headers = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
      if (type.startsWith('text/html')) headers['Content-Security-Policy'] = CSP;
      // App modules must revalidate on every load so a deploy never leaves a browser running stale JS
      // against new HTML; only the pinned vendor parsers are safe to cache.
      const immutable = file.includes(`${sep}vendor${sep}`) || file.includes(`${sep}media${sep}`);
      headers['Cache-Control'] = immutable ? 'public, max-age=86400' : 'no-cache';
      // Range requests: Safari will not play <video> without them.
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && type.startsWith('video/')) {
        const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
        if (start > end || start >= data.length) { res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }).end(); return; }
        res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 }).end(data.subarray(start, end + 1));
        return;
      }
      if (type.startsWith('video/')) headers['Accept-Ranges'] = 'bytes';
      res.writeHead(200, headers).end(data);
    } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
  }

  /** Server-rendered pages: the blog, sitemap and robots. */
  function page(req, res, pathname) {
    const html = (status, body) => res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=300' }).end(body);
    if (pathname === '/sitemap.xml') return res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }).end(blog.sitemap());
    if (pathname === '/robots.txt') return res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }).end(blog.robots());
    if (pathname === '/blog' || pathname === '/blog/') return html(200, blog.index());
    const legalSlug = pathname.slice(1).replace(/\/$/, '');
    if (blog.legalSlugs?.includes(legalSlug)) return html(200, blog.legalPage(legalSlug));
    const slug = pathname.slice('/blog/'.length).replace(/\/$/, '');
    const body = /^[a-z0-9-]+$/.test(slug) ? blog.post(slug) : null;
    return body ? html(200, body) : html(404, blog.index());
  }

  return async (req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
    if (blog && (pathname === '/blog' || pathname === '/blog/' || pathname.startsWith('/blog/') || pathname === '/sitemap.xml' || pathname === '/robots.txt' || blog.legalSlugs?.includes(pathname.slice(1).replace(/\/$/, '')))) return page(req, res, pathname);
    if (!pathname.startsWith('/api/')) return staticFile(req, res, pathname);
    try {
      await api(req, res, pathname);
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) log.error(`[api] ${req.method} ${pathname} -> ${status}: ${error.message}`); // message only, never bodies
      send(res, status, { error: status >= 500 && !error.status ? 'Something went wrong on the server.' : error.message, ...(error.extra || {}) });
    }
  };
}
