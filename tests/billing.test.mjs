import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { createStripe } from '../server/stripe.mjs';
import { createEntitlements } from '../server/entitlement.mjs';
import { createHandler } from '../server/api.mjs';
import { createAI } from '../server/ai.mjs';
import { createMockProvider } from '../server/providers/mock.mjs';
import { sampleCV, sampleJD } from '../dist/core.js';

const prices = { pro: 'price_pro', premium: 'price_prem' };
const sub = (over = {}) => ({ id: 'sub_1', customer: 'cus_1', status: 'active', current_period_end: Math.floor(Date.now() / 1000) + 86400 * 20, cancel_at_period_end: false, items: { data: [{ price: { id: 'price_pro' } }] }, ...over });

function fakeStripe(state = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init.body });
    if (url.endsWith('/checkout/sessions') && init.method === 'POST') return new Response(JSON.stringify({ url: 'https://checkout.stripe.com/c/pay/cs_test_abc' }));
    if (url.includes('/checkout/sessions/cs_test_abc')) return new Response(JSON.stringify({ payment_status: 'paid', status: 'complete', customer_details: { email: 'a@b.com' }, subscription: sub() }));
    if (url.includes('/checkout/sessions/cs_test_unpaid')) return new Response(JSON.stringify({ payment_status: 'unpaid', status: 'open' }));
    if (url.includes('/subscriptions/sub_1')) return new Response(JSON.stringify(sub(state.subOverride || {})));
    if (url.endsWith('/billing_portal/sessions')) return new Response(JSON.stringify({ url: 'https://billing.stripe.com/p/session/x' }));
    return new Response(JSON.stringify({ error: { message: 'nope' } }), { status: 404 });
  };
  return { stripe: createStripe({ secretKey: 'sk_test_x', webhookSecret: 'whsec_x', prices, appUrl: 'https://roledone.com', fetchImpl }), calls };
}

test('stripe client encodes nested form params and maps prices to plans', async () => {
  const { stripe, calls } = fakeStripe();
  const url = await stripe.checkoutUrl({ plan: 'pro', email: 'a@b.com' });
  assert.match(url, /checkout\.stripe\.com/);
  assert.match(calls[0].body, /line_items%5B0%5D%5Bprice%5D=price_pro/);
  assert.match(calls[0].body, /success_url=https%3A%2F%2Froledone\.com%2F%3Fsession_id%3D%7BCHECKOUT_SESSION_ID%7D/);
  await assert.rejects(stripe.checkoutUrl({ plan: 'gold' }), /No price/);
  const info = await stripe.confirmCheckout('cs_test_abc');
  assert.deepEqual([info.plan, info.customerId, info.status, info.email], ['pro', 'cus_1', 'active', 'a@b.com']);
  await assert.rejects(stripe.confirmCheckout('cs_test_unpaid'), /not complete/);
  await assert.rejects(stripe.confirmCheckout('garbage'), /Invalid/);
});

test('webhook signature verification accepts valid, rejects tampered and stale', () => {
  const { stripe } = fakeStripe();
  const body = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: sub() } });
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', 'whsec_x').update(`${t}.${body}`).digest('hex');
  assert.equal(stripe.verifyWebhook(body, `t=${t},v1=${sig}`).type, 'customer.subscription.deleted');
  assert.throws(() => stripe.verifyWebhook(body + ' ', `t=${t},v1=${sig}`), /Bad signature/);
  assert.throws(() => stripe.verifyWebhook(body, `t=${t - 1000},v1=${createHmac('sha256', 'whsec_x').update(`${t - 1000}.${body}`).digest('hex')}`), /too old/);
});

test('entitlement tokens: issue, parse, expire, cancel via re-check', async () => {
  let clock = Date.now();
  const { stripe } = fakeStripe();
  const e = createEntitlements({ secret: 's', stripe, now: () => clock });
  const info = e.remember(stripe.subscriptionInfo(sub()));
  const token = e.issue(info);
  assert.equal(e.parse(token).plan, 'pro');
  assert.equal(e.parse(token.slice(0, -2) + 'zz'), null, 'tampered signature');
  assert.equal((await e.planFor(token)).plan, 'pro');
  assert.equal((await e.planFor(undefined)).plan, 'free');
  // Webhook says cancelled → free immediately
  e.applyEvent('customer.subscription.deleted', info);
  assert.equal((await e.planFor(token)).plan, 'free');
  // Period end long passed → free even if cache says active
  e.remember({ ...info, status: 'active', periodEnd: clock - 10 * 86400 * 1000 });
  assert.equal((await e.planFor(token)).plan, 'free');
});

async function serve(options) {
  const server = http.createServer(createHandler({ log: { error() {}, info() {} }, ...options }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body, headers = {}) => fetch(base + path, body === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { call, close: () => new Promise((r) => server.close(r)) };
}

test('API: paid endpoints need a token unless the default plan covers them; confirm issues one; portal works', async () => {
  const { stripe } = fakeStripe();
  const entitlements = createEntitlements({ secret: 's', stripe });
  const ai = createAI(createMockProvider());
  const { call, close } = await serve({ ai, billing: { stripe, entitlements } });
  try {
    const status = await (await call('/api/status')).json();
    assert.equal(status.billing, true); assert.deepEqual(status.plans, ['pro', 'premium']);
    assert.equal((await call('/api/match', { cv: sampleCV, jd: sampleJD })).status, 200, 'match is free');
    assert.equal((await call('/api/suggestions', { cv: sampleCV, draft: sampleCV, jd: sampleJD })).status, 402, 'gated without token');
    const co = await (await call('/api/billing/checkout', { plan: 'pro', email: 'a@b.com' })).json();
    assert.match(co.url, /checkout\.stripe\.com/);
    const conf = await (await call('/api/billing/confirm', { session_id: 'cs_test_abc' })).json();
    assert.equal(conf.plan, 'pro'); assert.ok(conf.token.includes('.'));
    const h = { 'x-roledone-token': conf.token };
    assert.equal((await call('/api/suggestions', { cv: sampleCV, draft: sampleCV, jd: sampleJD }, h)).status, 200, 'allowed with token');
    const bs = await (await call('/api/billing/status', undefined, h)).json();
    assert.equal(bs.plan, 'pro'); assert.equal(bs.subscribed, true);
    assert.match((await (await call('/api/billing/portal', {}, h)).json()).url, /billing\.stripe\.com/);
    assert.equal((await call('/api/billing/portal', {})).status, 401);
    // Webhook with a bad signature is rejected
    assert.equal((await fetch(`http://127.0.0.1:${new URL((await call('/api/status')).url).port}/api/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': 't=1,v1=bad' }, body: '{}' })).status, 400);
  } finally { await close(); }
});

test('API: ROLEDONE_DEFAULT_PLAN=pro still opens paid endpoints with billing on', async () => {
  process.env.ROLEDONE_DEFAULT_PLAN = 'pro';
  try {
    const { stripe } = fakeStripe();
    const { call, close } = await serve({ ai: createAI(createMockProvider()), billing: { stripe, entitlements: createEntitlements({ secret: 's', stripe }) } });
    try { assert.equal((await call('/api/suggestions', { cv: sampleCV, draft: sampleCV, jd: sampleJD })).status, 200); } finally { await close(); }
  } finally { delete process.env.ROLEDONE_DEFAULT_PLAN; }
});
