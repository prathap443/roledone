import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createSupabase, planFromRow } from '../server/supabase.mjs';
import { createStripe } from '../server/stripe.mjs';
import { createEntitlements } from '../server/entitlement.mjs';
import { createHandler } from '../server/api.mjs';
import { createAI } from '../server/ai.mjs';
import { createMockProvider } from '../server/providers/mock.mjs';
import { sampleCV, sampleJD } from '../dist/core.js';

const sub = (over = {}) => ({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 86400 * 20, items: { data: [{ price: { id: 'price_pro' } }] }, ...over });

function fakeBackends() {
  const db = new Map(); // user_id -> row
  const log = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url); log.push(`${init.method || 'GET'} ${u.pathname}`);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/auth/v1/user') { const t = (init.headers.Authorization || '').split(' ')[1]; return t === 'good' ? json({ id: 'user-1', email: 'u@x.com' }) : json({ msg: 'bad' }, 401); }
    if (u.pathname === '/rest/v1/subscriptions') {
      if (init.method === 'POST') { const row = JSON.parse(init.body); db.set(row.user_id, { ...(db.get(row.user_id) || {}), ...row }); return json([db.get(row.user_id)], 201); }
      if (init.method === 'PATCH') { const id = decodeURIComponent(u.searchParams.get('stripe_subscription_id').replace('eq.', '')); const patch = JSON.parse(init.body); for (const [k, v] of db) if (v.stripe_subscription_id === id) { db.set(k, { ...v, ...patch }); return json([db.get(k)]); } return json([]); }
      const uid = u.searchParams.get('user_id')?.replace('eq.', ''); const sid = u.searchParams.get('stripe_subscription_id')?.replace('eq.', '');
      return json([...db.values()].filter((r) => (uid ? r.user_id === uid : r.stripe_subscription_id === sid)));
    }
    if (u.pathname.endsWith('/checkout/sessions') && init.method === 'POST') { log.push(`checkout:${init.body}`); return json({ url: 'https://checkout.stripe.com/c/pay/cs_test_abc' }); }
    if (u.pathname.includes('/checkout/sessions/cs_test_abc')) return json({ payment_status: 'paid', status: 'complete', customer_details: { email: 'u@x.com' }, subscription: sub() });
    if (u.pathname.includes('/subscriptions/sub_1')) return json(sub());
    if (u.pathname.endsWith('/billing_portal/sessions')) return json({ url: 'https://billing.stripe.com/p/x' });
    return json({ error: { message: 'nope' } }, 404);
  };
  const auth = createSupabase({ url: 'https://p.supabase.co', anonKey: 'anon', serviceKey: 'svc', fetchImpl });
  const stripe = createStripe({ secretKey: 'sk_test_x', webhookSecret: 'whsec_x', prices: { pro: 'price_pro', premium: 'price_premium' }, appUrl: 'https://roledone.com', fetchImpl });
  const entitlements = createEntitlements({ secret: 's', stripe });
  return { auth, stripe, entitlements, db, log };
}

test('planFromRow and token cache', async () => {
  assert.equal(planFromRow(null), 'free');
  assert.equal(planFromRow({ plan: 'pro', status: 'active', period_end: new Date(Date.now() + 86400e3).toISOString() }), 'pro');
  assert.equal(planFromRow({ plan: 'pro', status: 'canceled', period_end: new Date(Date.now() + 86400e3).toISOString() }), 'free');
  assert.equal(planFromRow({ plan: 'pro', status: 'active', period_end: new Date(Date.now() - 10 * 86400e3).toISOString() }), 'free');
  const { auth, log } = fakeBackends();
  assert.deepEqual(await auth.userFromToken('good'), { id: 'user-1', email: 'u@x.com' });
  await auth.userFromToken('good');
  assert.equal(log.filter((l) => l.includes('/auth/v1/user')).length, 1, 'second lookup served from cache');
  assert.equal(await auth.userFromToken('bad'), null);
});

async function serve(options) {
  const server = http.createServer(createHandler({ log: { error() {}, info() {} }, ...options }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body, headers = {}) => fetch(base + path, body === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { call, close: () => new Promise((r) => server.close(r)) };
}

test('accounts: checkout needs sign-in, confirm writes the row, plan follows the account on any device', async () => {
  const { auth, stripe, entitlements, db, log } = fakeBackends();
  const { call, close } = await serve({ ai: createAI(createMockProvider()), billing: { stripe, entitlements }, auth });
  const signed = { Authorization: 'Bearer good' };
  try {
    assert.deepEqual((await (await call('/api/status')).json()).auth, { url: 'https://p.supabase.co', anonKey: 'anon' });
    assert.equal((await call('/api/billing/checkout', { plan: 'pro' })).status, 401, 'anonymous checkout refused');
    assert.equal((await call('/api/billing/checkout', { plan: 'pro' }, signed)).status, 200);
    assert.match(log.find((l) => l.startsWith('checkout:')), /client_reference_id=user-1/);
    const conf = await (await call('/api/billing/confirm', { session_id: 'cs_test_abc' }, signed)).json();
    assert.equal(conf.attached, true); assert.equal(conf.token, null);
    assert.equal(db.get('user-1').plan, 'pro');
    // A different browser, same account, no device token: still Pro.
    const me = await (await call('/api/me', undefined, signed)).json();
    assert.deepEqual([me.plan, me.source, me.user.email], ['pro', 'account', 'u@x.com']);
    assert.equal((await call('/api/suggestions', { cv: sampleCV, draft: sampleCV, jd: sampleJD }, signed)).status, 200);
    assert.equal((await call('/api/suggestions', { cv: sampleCV, draft: sampleCV, jd: sampleJD })).status, 402, 'anonymous still gated');
    assert.match((await (await call('/api/billing/portal', {}, signed)).json()).url, /billing\.stripe/);
  } finally { await close(); }
});

test('accounts: a device-token subscription attaches to the account once', async () => {
  const { auth, stripe, entitlements, db } = fakeBackends();
  const { call, close } = await serve({ ai: createAI(createMockProvider()), billing: { stripe, entitlements }, auth });
  try {
    const info = entitlements.remember(stripe.subscriptionInfo(sub()));
    const token = entitlements.issue(info);
    assert.equal((await call('/api/billing/attach', {}, { 'x-roledone-token': token })).status, 401, 'needs sign-in');
    const r = await (await call('/api/billing/attach', {}, { 'x-roledone-token': token, Authorization: 'Bearer good' })).json();
    assert.deepEqual([r.attached, r.plan, db.get('user-1').stripe_subscription_id], [true, 'pro', 'sub_1']);
    const again = await (await call('/api/billing/attach', {}, { Authorization: 'Bearer good' })).json();
    assert.equal(again.attached, false);
  } finally { await close(); }
});

test('CSP allows the browser to reach Supabase Auth when accounts are enabled', async () => {
  const { auth } = fakeBackends();
  const { call, close } = await serve({ ai: createAI(null), auth });
  try { assert.match((await call('/')).headers.get('content-security-policy'), /connect-src 'self' https:\/\/p\.supabase\.co/); } finally { await close(); }
});

test('admin emails get every feature without a subscription', async () => {
  const { auth, stripe, entitlements } = fakeBackends();
  const { call, close } = await serve({ ai: createAI(createMockProvider()), billing: { stripe, entitlements }, auth, adminEmails: ['u@x.com'] });
  try {
    const me = await (await call('/api/me', undefined, { Authorization: 'Bearer good' })).json();
    assert.deepEqual([me.plan, me.source, me.admin], ['premium', 'admin', true]);
    assert.equal((await call('/api/suggestions', { cv: sampleCV, draft: sampleCV, jd: sampleJD }, { Authorization: 'Bearer good' })).status, 200);
    assert.equal((await call('/api/suggestions', { cv: sampleCV, draft: sampleCV, jd: sampleJD })).status, 402);
  } finally { await close(); }
});

test('Premium gates: follow-up reviews and the mock debrief need Premium; Pro gets plain feedback', async () => {
  const { auth, stripe, entitlements, db } = fakeBackends();
  const { call, close } = await serve({ ai: createAI(createMockProvider()), billing: { stripe, entitlements }, auth, adminEmails: ['admin@x.com'] });
  const signed = { Authorization: 'Bearer good' };
  const items = [{ prompt: 'Tell me about a pipeline you built.', answer: 'I built a daily ingestion pipeline in Data Factory that reduced manual refreshes to zero.', type: 'depth' }, { prompt: 'How do you test pipelines?', answer: '', type: 'depth' }, { prompt: 'Describe a conflict.', answer: 'A short one.', type: 'behavioural' }];
  try {
    // Make user-1 Pro via confirm
    await call('/api/billing/confirm', { session_id: 'cs_test_abc' }, signed);
    assert.equal(db.get('user-1').plan, 'pro');
    const fb = { question: 'Q?', answer: 'During the migration I owned the loader and the result was a 40% faster run.', cv: sampleCV };
    assert.equal((await call('/api/feedback', fb, signed)).status, 200, 'pro: plain feedback ok');
    assert.equal((await call('/api/feedback', { ...fb, parent: { question: 'P?', answer: 'Earlier answer with enough words in it.' } }, signed)).status, 402, 'pro: follow-up gated');
    assert.equal((await call('/api/mock-debrief', { cv: sampleCV, jd: sampleJD, level: 'technical', items }, signed)).status, 402, 'pro: debrief gated');
    // Premium via device token
    const premiumSub = { ...sub(), items: { data: [{ price: { id: 'price_premium' }, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] } };
    const token = entitlements.issue(entitlements.remember(stripe.subscriptionInfo(premiumSub)));
    const prem = { 'x-roledone-token': token };
    assert.equal((await call('/api/feedback', { ...fb, parent: { question: 'P?', answer: 'Earlier answer with enough words in it.' } }, prem)).status, 200);
    const d = await (await call('/api/mock-debrief', { cv: sampleCV, jd: sampleJD, level: 'technical', items }, prem)).json();
    assert.ok(d.debrief.score >= 0 && d.debrief.score <= 100); assert.equal(d.debrief.per_question.length, 3); assert.equal(d.debrief.per_question[1].verdict, 'skipped');
    assert.equal((await call('/api/mock-debrief', { cv: sampleCV, items: items.slice(0, 2) }, prem)).status, 400, 'needs 3 questions');
    assert.equal((await call('/api/mock-debrief', { cv: sampleCV, items: items.map((i) => ({ ...i, answer: '' })) }, prem)).status, 400, 'needs an answer');
  } finally { await close(); }
});
