import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler, createRateLimiter } from '../server/api.mjs';
import { createAI } from '../server/ai.mjs';
import { createMockProvider } from '../server/providers/mock.mjs';
import { createAnthropicProvider } from '../server/providers/anthropic.mjs';
import { sampleCV, sampleJD } from '../dist/core.js';

const quiet = { error() {} };

async function serve(options) {
  const server = http.createServer(createHandler({ log: quiet, ...options }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body, init = {}) => fetch(base + path, body === undefined ? init : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...init });
  return { call, close: () => new Promise((r) => server.close(r)) };
}

test('status reports browser-only mode and POST endpoints return 503 when AI is off', async () => {
  const { call, close } = await serve({ ai: createAI(null) });
  try {
    assert.deepEqual(await (await call('/api/status')).json(), { ai: false, provider: null, model: null, defaultPlan: 'free' });
    const res = await call('/api/match', { cv: 'a', jd: 'b' });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /ANTHROPIC_API_KEY/);
  } finally { await close(); }
});

test('match, suggestions and feedback round-trip through the mock provider with validation applied', async () => {
  const { call, close } = await serve({ ai: createAI(createMockProvider()) });
  try {
    const match = await (await call('/api/match', { cv: sampleCV, jd: sampleJD })).json();
    assert.ok(match.requirements.length >= 5);
    for (const r of match.requirements) { assert.ok(sampleJD.includes(r.source)); if (r.evidence) assert.ok(sampleCV.includes(r.evidence)); }
    assert.equal(match.requirements.find((r) => r.name === 'Terraform').status, 'gap');

    const draft = sampleCV + '\nWorked on reporting dashboards.';
    const sug = await (await call('/api/suggestions', { cv: sampleCV, draft, jd: sampleJD, requirements: match.requirements })).json();
    assert.equal(sug.suggestions.length, 1);
    assert.equal(sug.suggestions[0].original, 'Worked on reporting dashboards.');
    assert.ok(draft.includes(sug.suggestions[0].original));

    const fb = await (await call('/api/feedback', { question: 'Tell me about a challenge.', answer: 'During a project migration I owned the SQL layer and reduced load time by 30% after profiling the slowest joins.' })).json();
    assert.equal(fb.feedback.star.action.present, true);
    assert.ok(Array.isArray(fb.feedback.improvements));
  } finally { await close(); }
});

test('input validation: content type, oversized fields, short answers, unknown routes, method', async () => {
  const { call, close } = await serve({ ai: createAI(createMockProvider()) });
  try {
    assert.equal((await call('/api/match', undefined, { method: 'POST', body: 'cv=1', headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await call('/api/match', { cv: 'x'.repeat(50001), jd: 'y' })).status, 413);
    assert.equal((await call('/api/match', { jd: 'y' })).status, 400);
    assert.equal((await call('/api/feedback', { question: 'q', answer: 'too short' })).status, 400);
    assert.equal((await call('/api/nothing', {})).status, 404);
    assert.equal((await call('/api/match')).status, 405);
    assert.equal((await call('/api/match', undefined, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' })).status, 400);
  } finally { await close(); }
});

test('rate limiter returns 429 after the window limit', async () => {
  const { call, close } = await serve({ ai: createAI(createMockProvider()), rateLimit: createRateLimiter({ limit: 2 }) });
  try {
    assert.equal((await call('/api/match', { cv: 'a', jd: 'b' })).status, 200);
    assert.equal((await call('/api/match', { cv: 'a', jd: 'b' })).status, 200);
    assert.equal((await call('/api/match', { cv: 'a', jd: 'b' })).status, 429);
  } finally { await close(); }
});

test('static serving still works, with CSP on HTML and path traversal blocked', async () => {
  const { call, close } = await serve({ ai: createAI(null) });
  try {
    const html = await call('/');
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-security-policy'), /default-src 'self'/);
    const core = await call('/core.js');
    assert.equal(core.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(core.headers.get('cache-control'), 'no-cache');
    assert.equal((await call('/vendor/mammoth/mammoth.browser.min.js')).headers.get('cache-control'), 'public, max-age=86400');
    assert.equal((await call('/..%2fpackage.json')).status, 403);
  } finally { await close(); }
});

test('anthropic adapter forces the tool and surfaces API errors with upstream status', async () => {
  let sent;
  const ok = createAnthropicProvider({ apiKey: 'k', model: 'm', fetchImpl: async (url, init) => { sent = { url, init: JSON.parse(init.body), headers: init.headers }; return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 't', input: { hello: 1 } }] }), { status: 200 }); } });
  const result = await ok.complete({ system: 's', user: 'u', tool: { name: 't', description: 'd', input_schema: { type: 'object' } } });
  assert.deepEqual(result, { hello: 1 });
  assert.deepEqual(sent.init.tool_choice, { type: 'auto' }); // forced tool_choice is rejected by Claude 5.x
  assert.equal(sent.init.system[0].cache_control.type, 'ephemeral');
  assert.deepEqual(sent.init.output_config, { effort: 'low' });
  assert.equal(sent.init.model, 'm');
  assert.equal(sent.headers['x-api-key'], 'k');
  assert.equal(sent.init.temperature, undefined);

  const textual = createAnthropicProvider({ apiKey: 'k', fetchImpl: async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Here you go:\n```json\n{"hello":2}\n```' }] }), { status: 200 }) });
  assert.deepEqual(await textual.complete({ system: 's', user: 'u', tool: { name: 't', input_schema: {} } }), { hello: 2 });

  const limited = createAnthropicProvider({ apiKey: 'k', fetchImpl: async () => new Response('rate limited', { status: 429 }) });
  await assert.rejects(limited.complete({ system: 's', user: 'u', tool: { name: 't', input_schema: {} } }), (e) => e.status === 429);
});

test('questions and gap interview endpoints round-trip through the mock provider', async () => {
  const { call, close } = await serve({ ai: createAI(createMockProvider()) });
  try {
    const match = await (await call('/api/match', { cv: sampleCV, jd: sampleJD })).json();
    const qs = await (await call('/api/questions', { cv: sampleCV, jd: sampleJD, requirements: match.requirements, level: 'senior' })).json();
    assert.equal(qs.questions.length, 5);
    assert.ok(qs.questions.some((q) => q.type === 'gap' && q.focus === 'Terraform'));
    const terraform = match.requirements.find((r) => r.name === 'Terraform');
    const gq = await (await call('/api/gap-questions', { cv: sampleCV, jd: sampleJD, requirement: terraform })).json();
    assert.ok(gq.questions.length >= 2);
    const allNo = await call('/api/gap-bullet', { cv: sampleCV, requirement: terraform, questions: gq.questions, answers: ['No.', 'No.'] });
    assert.equal(allNo.status, 400);
    const bareYes = await (await call('/api/gap-bullet', { cv: sampleCV, requirement: terraform, questions: gq.questions, answers: ['Yes. (no further detail given — use only facts already in the CV)', 'No.'] })).json();
    assert.ok(['supported', 'adjacent', 'needs_detail', 'unsupported'].includes(bareYes.verdict));
    const bullet = await (await call('/api/gap-bullet', { cv: sampleCV, requirement: terraform, questions: gq.questions, answers: ['Yes, I wrote Terraform for the Synapse workspace in my last role.', ''], otherGaps: [{ name: 'CI/CD', status: 'gap' }] })).json();
    assert.equal(bullet.verdict, 'supported'); assert.match(bullet.bullet, /Terraform/);
  } finally { await close(); }
});

test('scan summary endpoint drops strengths without a real CV quote', async () => {
  const { scanCV } = await import('../dist/scan.js');
  const { call, close } = await serve({ ai: createAI(createMockProvider()) });
  try {
    assert.equal((await call('/api/scan-summary', { cv: sampleCV })).status, 400);
    const res = await (await call('/api/scan-summary', { cv: sampleCV, scan: scanCV(sampleCV) })).json();
    assert.equal(res.summary.strengths.length, 1);
    assert.ok(sampleCV.includes(res.summary.strengths[0].evidence));
    assert.equal(res.summary.fixes.length, 1);
  } finally { await close(); }
});

test('anthropic adapter caches CV blocks, routes tiers, and drops effort when a model rejects it', async () => {
  const calls = [];
  const provider = createAnthropicProvider({ apiKey: 'k', model: 'q', fastModel: 'f', log: { info() {} }, fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    if (body.output_config && body.model === 'f') return new Response(JSON.stringify({ error: { message: 'output_config.effort is not supported' } }), { status: 400 });
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 't', input: { ok: 1 } }], usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 2 } }), { status: 200 });
  } });
  const tool = { name: 't', input_schema: {} }, other = { name: 'u', input_schema: {} };
  await provider.complete({ system: 's', blocks: [{ text: '<cv>…</cv>', cache: true }, { text: 'task' }], tool, tools: [tool, other], tier: 'fast' });
  assert.equal(calls.length, 2, 'retried once without effort');
  assert.equal(calls[1].output_config, undefined);
  assert.equal(calls[1].model, 'f');
  assert.deepEqual(calls[1].tools.map((t) => t.name), ['t', 'u']);
  assert.equal(calls[1].messages[0].content[0].cache_control.type, 'ephemeral');
  await provider.complete({ system: 's', blocks: [{ text: 'x' }], tool, tier: 'fast' });
  assert.equal(calls.length, 3, 'remembers the model rejects effort');
  await provider.complete({ system: 's', blocks: [{ text: 'x' }], tool, tier: 'quality' });
  assert.equal(calls[3].model, 'q'); assert.deepEqual(calls[3].output_config, { effort: 'low' });
  assert.equal(provider.usage.calls, 3); assert.equal(provider.usage.cacheRead, 15);
});

test('/api/usage exposes aggregates only, and 404s when accounting is off', async () => {
  const { createUsage } = await import('../server/usage.mjs');
  const usage = createUsage({ env: {} });
  usage.record({ model: 'claude-haiku-5-5', tool: 'review_answer', tokens: { input: 100, output: 50 }, ms: 300 });
  const on = await serve({ ai: createAI(createMockProvider()), usage });
  const off = await serve({ ai: createAI(createMockProvider()) });
  try {
    const body = await (await on.call('/api/usage')).json();
    assert.equal(body.total.calls, 1); assert.ok(body.byTool.review_answer); assert.ok(!JSON.stringify(body).includes('cv'));
    assert.equal((await off.call('/api/usage')).status, 404);
  } finally { await on.close(); await off.close(); }
});

test('cache prefix (tools, system, CV block) is byte-identical across different AI calls', async () => {
  const bodies = [];
  const provider = createAnthropicProvider({ apiKey: 'k', log: { info() {} }, fetchImpl: async (url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'report_match', input: { requirements: [] } }], usage: {} }), { status: 200 }); } });
  const ai = createAI(provider);
  await ai.match({ cv: sampleCV, jd: sampleJD });
  await ai.gapQuestions({ cv: sampleCV, jd: sampleJD, requirement: { name: 'Terraform', source: '' } }).catch(() => {});
  await ai.scanSummary({ cv: sampleCV, scan: { score: 1, parts: { parse: { score: 1, checks: [] }, impact: { score: 1, quantified: 0, total: 0, weak: 0 }, readability: { score: 1, buzzwords: [] }, coverage: { score: 1, found: [], total: 0, role: 'x', missing: [] } } } }).catch(() => {});
  assert.equal(bodies.length, 3);
  const prefix = (b) => JSON.stringify([b.tools, b.system, b.messages[0].content[0]]);
  assert.equal(prefix(bodies[0]), prefix(bodies[1]));
  assert.equal(prefix(bodies[0]), prefix(bodies[2]));
  assert.equal(bodies[0].messages[0].content[0].cache_control.type, 'ephemeral');
  assert.ok(bodies[0].messages[0].content[0].text.startsWith('<cv>'));
  // Different tiers use different models, so their caches are separate — match is quality, the other two are fast.
  assert.equal(bodies[0].model, 'claude-sonnet-5-5'); assert.equal(bodies[1].model, 'claude-haiku-5-5');
});

test('gap bullet: a bare Yes on a listed-only skill gets one follow-up, then drafts on the final round', async () => {
  const { call, close } = await serve({ ai: createAI(createMockProvider()) });
  try {
    const cv = 'JANE\nData Engineer, Co — 2020 to 2024\nBuilt pipelines.\nSkills: Snowflake, SQL';
    const q = ['Have you used Snowflake?', 'What did you build?'];
    const first = await (await call('/api/gap-bullet', { cv, requirement: { name: 'Snowflake' }, questions: q, answers: ['Yes.', 'No.'] })).json();
    assert.equal(first.verdict, 'needs_detail'); assert.ok(first.follow_up);
    const second = await (await call('/api/gap-bullet', { cv, requirement: { name: 'Snowflake' }, questions: [...q, first.follow_up], answers: ['Yes.', 'No.', 'Yes. Loaded retail sales data into Snowflake for a reporting project.'], finalRound: true })).json();
    assert.equal(second.verdict, 'supported'); assert.match(second.bullet, /retail sales/);
  } finally { await close(); }
});
