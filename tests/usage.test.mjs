import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsage } from '../server/usage.mjs';
import { createAnthropicProvider } from '../server/providers/anthropic.mjs';

test('usage prices calls per model, aggregates per tool, and reports cache hit rate', () => {
  let t = 1000;
  const u = createUsage({ env: {}, now: () => (t += 10) });
  u.record({ model: 'claude-sonnet-5-5', tool: 'report_match', tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 3000 }, ms: 1200 });
  u.record({ model: 'claude-haiku-5-5', tool: 'ask_about_gap', tokens: { input: 200, output: 100, cacheRead: 3000, cacheWrite: 0 }, ms: 400 });
  u.record({ model: 'claude-haiku-5-5', tool: 'ask_about_gap', tokens: {}, ms: 50, error: true });
  const s = u.summary();
  // sonnet: 1000*2 + 500*10 + 3000*2.5 = 0.0145 ; haiku: 200*0.1 + 100*0.5 + 3000*0.01 = 0.0001
  assert.equal(s.byModel['claude-sonnet-5-5'].usd, 0.0145);
  assert.equal(s.byModel['claude-haiku-5-5'].usd, 0.0001);
  assert.equal(s.total.calls, 3); assert.equal(s.total.errors, 1);
  assert.equal(s.byTool.ask_about_gap.calls, 2); assert.equal(s.byTool.ask_about_gap.avgMs, 225);
  assert.equal(s.cacheHitRate, Number((3000 / (1200 + 3000 + 3000)).toFixed(3)));
  assert.equal(s.recent.length, 3);
});

test('ROLEDONE_PRICES overrides and unknown models cost zero without throwing', () => {
  const u = createUsage({ env: { ROLEDONE_PRICES: '{"claude-sonnet-5-5":{"in":1,"out":1,"cacheRead":1,"cacheWrite":1}}' } });
  u.record({ model: 'claude-sonnet-5-5', tool: 't', tokens: { input: 1e6 }, ms: 1 });
  u.record({ model: 'mystery-model', tool: 't', tokens: { input: 1e6 }, ms: 1 });
  assert.equal(u.summary().total.usd, 1);
});

test('anthropic adapter feeds the usage ledger with tokens, latency and errors', async () => {
  const usage = createUsage({ env: {} });
  let fail = false;
  const provider = createAnthropicProvider({ apiKey: 'k', model: 'claude-sonnet-5-5', usage, log: { info() {} }, fetchImpl: async () => fail
    ? new Response('boom', { status: 500 })
    : new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 't', input: {} }], usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 } }), { status: 200 }) });
  const tool = { name: 't', input_schema: {} };
  await provider.complete({ system: 's', blocks: [{ text: 'x' }], tool });
  fail = true;
  await assert.rejects(provider.complete({ system: 's', blocks: [{ text: 'x' }], tool }));
  const s = usage.summary();
  assert.equal(s.total.calls, 2); assert.equal(s.total.errors, 1); assert.equal(s.total.cacheRead, 90); assert.equal(s.cacheHitRate, 0.9);
});
