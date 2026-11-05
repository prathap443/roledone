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
    assert.deepEqual(await (await call('/api/status')).json(), { ai: false, provider: null, model: null });
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
    assert.equal((await call('/core.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal((await call('/..%2fpackage.json')).status, 403);
  } finally { await close(); }
});

test('anthropic adapter forces the tool and surfaces API errors with upstream status', async () => {
  let sent;
  const ok = createAnthropicProvider({ apiKey: 'k', model: 'm', fetchImpl: async (url, init) => { sent = { url, init: JSON.parse(init.body), headers: init.headers }; return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 't', input: { hello: 1 } }] }), { status: 200 }); } });
  const result = await ok.complete({ system: 's', user: 'u', tool: { name: 't', description: 'd', input_schema: { type: 'object' } } });
  assert.deepEqual(result, { hello: 1 });
  assert.deepEqual(sent.init.tool_choice, { type: 'auto' }); // forced tool_choice is rejected by Claude 5.x
  assert.match(sent.init.system, /calling the t tool/);
  assert.equal(sent.init.model, 'm');
  assert.equal(sent.headers['x-api-key'], 'k');
  assert.equal(sent.init.temperature, undefined);

  const textual = createAnthropicProvider({ apiKey: 'k', fetchImpl: async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Here you go:\n```json\n{"hello":2}\n```' }] }), { status: 200 }) });
  assert.deepEqual(await textual.complete({ system: 's', user: 'u', tool: { name: 't', input_schema: {} } }), { hello: 2 });

  const limited = createAnthropicProvider({ apiKey: 'k', fetchImpl: async () => new Response('rate limited', { status: 429 }) });
  await assert.rejects(limited.complete({ system: 's', user: 'u', tool: { name: 't', input_schema: {} } }), (e) => e.status === 429);
});
