import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeter, memoryStore, supabaseStore, limitsFromEnv, DEFAULT_LIMITS, monthKey } from '../server/meter.mjs';

test('limits merge from env and fall back on bad JSON', () => {
  assert.deepEqual(limitsFromEnv({}), DEFAULT_LIMITS);
  assert.equal(limitsFromEnv({ ROLEDONE_LIMITS: '{"free":{"match":5}}' }).free.match, 5);
  assert.equal(limitsFromEnv({ ROLEDONE_LIMITS: '{"free":{"match":5}}' }).pro.match, DEFAULT_LIMITS.pro.match);
  assert.deepEqual(limitsFromEnv({ ROLEDONE_LIMITS: 'nope' }), DEFAULT_LIMITS);
});

test('subject precedence: user, device, hashed ip', () => {
  const m = createMeter();
  assert.equal(m.subjectFor({ headers: {} }, { id: 'u1' }), 'user:u1');
  assert.equal(m.subjectFor({ headers: { 'x-roledone-device': 'abcdefghijklmnop' } }, null), 'dev:abcdefghijklmnop');
  assert.match(m.subjectFor({ headers: { 'x-roledone-device': 'short' , 'x-forwarded-for': '1.2.3.4, 9.9.9.9' } }, null), /^ip:[a-f0-9]{24}$/);
  assert.equal(m.subjectFor({ headers: { 'x-forwarded-for': '1.2.3.4' } }, null), m.subjectFor({ headers: { 'x-forwarded-for': '1.2.3.4' } }, null));
});

test('check/bump/summary over the month boundary', async () => {
  let t = Date.parse('2026-11-30T23:00:00Z');
  const m = createMeter({ store: memoryStore(), now: () => t });
  const s = { subject: 'dev:x', plan: 'free', feature: 'match' };
  for (let i = 0; i < 3; i++) { assert.equal((await m.check(s)).allowed, true); await m.bump(s); }
  assert.deepEqual(await m.check(s), { allowed: false, used: 3, limit: 3, remaining: 0 });
  assert.equal((await m.check({ ...s, admin: true })).allowed, true);
  assert.equal((await m.check({ ...s, plan: 'pro' })).allowed, true); // upgrading mid-month unlocks immediately
  assert.equal((await m.check({ ...s, feature: 'suggestions' })).limit, 0); // free has no suggestions
  t += 2 * 3600 * 1000; // December
  assert.equal(monthKey(t), '2026-12');
  assert.equal((await m.check(s)).used, 0);
  const sum = await m.summary({ subject: 'dev:x', plan: 'pro' });
  assert.equal(sum.month, '2026-12'); assert.deepEqual(sum.features.match, { used: 0, limit: 60 });
});

test('supabase store calls the rpc and falls back to memory on error', async () => {
  const calls = [];
  const sb = { rest: async (method, path, opts) => { calls.push([method, path, opts?.body]); if (path.startsWith('/rpc/increment_usage')) return 7; if (path.startsWith('/usage_counters')) return [{ feature: 'match', count: 7 }]; throw new Error('x'); } };
  const store = supabaseStore(sb, { log: { error() {} } });
  assert.equal(await store.increment('dev:a', '2026-11', 'match'), 7);
  assert.deepEqual(calls[0], ['POST', '/rpc/increment_usage', { p_subject: 'dev:a', p_month: '2026-11', p_feature: 'match' }]);
  assert.equal(await store.get('dev:a', '2026-11', 'match'), 7);
  assert.deepEqual(await store.all('dev:a', '2026-11'), { match: 7 });
  const broken = supabaseStore({ rest: async () => { throw new Error('down'); } }, { log: { error() {} } });
  assert.equal(await broken.increment('dev:b', '2026-11', 'match'), 1);
  assert.equal(await broken.increment('dev:b', '2026-11', 'match'), 2);
});
