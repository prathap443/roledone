import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobs, createMockJobs, normaliseAdzuna, normaliseArbeitnow, salaryLabel, jobsFromEnv } from '../server/jobs.mjs';

test('salaryLabel formats ranges, singles and predictions', () => {
  assert.equal(salaryLabel({ min: 60000, max: 80000 }), '£60k – £80k');
  assert.equal(salaryLabel({ min: 0, max: 120000, currency: 'USD' }), '$120k');
  assert.equal(salaryLabel({ min: 50000, max: 50000, predicted: true }), '~£50k');
  assert.equal(salaryLabel({}), null);
});

test('normaliseAdzuna maps fields and strips html', () => {
  const j = normaliseAdzuna({ id: '9', title: 'Data Engineer', company: { display_name: 'Acme' }, location: { display_name: 'Leeds' }, salary_min: 50000, salary_max: 60000, description: '<p>Build &amp; run pipelines</p>', redirect_url: 'https://x', contract_time: 'full_time', category: { label: 'IT Jobs' }, created: '2026-11-01T00:00:00Z' }, 'gb');
  assert.equal(j.id, 'adzuna:9'); assert.equal(j.location, 'Leeds, United Kingdom'); assert.equal(j.salary, '£50k – £60k');
  assert.equal(j.type, 'Full-time'); assert.equal(j.category, 'IT'); assert.equal(j.description, 'Build & run pipelines'); assert.equal(j.partial, true);
});

test('normaliseArbeitnow maps fields', () => {
  const j = normaliseArbeitnow({ slug: 'abc', title: 'ML Engineer', company_name: 'Foo', remote: true, url: 'https://y', tags: ['Python', 'Data Science'], job_types: ['Full time'], location: 'Berlin', description: '<ul><li>Do things</li></ul>', created_at: 1700000000 });
  assert.equal(j.id, 'arbeitnow:abc'); assert.equal(j.remote, true); assert.equal(j.type, 'Full time'); assert.equal(j.category, 'Data Science'); assert.match(j.description, /Do things/); assert.equal(j.partial, false);
});

test('createJobs uses Adzuna when keys are present and caches', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return { ok: true, json: async () => ({ count: 1, results: [{ id: '1', title: 'T', company: {}, location: {}, description: 'd', redirect_url: 'u' }] }) }; };
  const jobs = createJobs({ adzunaId: 'id', adzunaKey: 'key', fetchImpl, now: () => 1000 });
  assert.equal(jobs.source, 'Adzuna');
  const r1 = await jobs.search({ q: 'data', country: 'us', page: 1 });
  const r2 = await jobs.search({ q: 'data', country: 'us', page: 1 });
  assert.equal(calls.length, 1); assert.match(calls[0], /jobs\/us\/search\/1\?/); assert.match(calls[0], /app_key=key/);
  assert.equal(r1.jobs[0].id, 'adzuna:1'); assert.equal(r2, r1);
});

test('createJobs falls back to Arbeitnow and rejects bad upstream', async () => {
  const jobs = createJobs({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.equal(jobs.source, 'Arbeitnow');
  await assert.rejects(jobs.search({ q: 'x' }), /503/);
  assert.deepEqual((await jobs.featured()).jobs, []); // featured never throws
});

test('mock jobs filter the fixture', async () => {
  const m = createMockJobs();
  assert.equal((await m.search({ q: 'agent' })).jobs.length, 1);
  assert.ok((await m.featured()).jobs.length >= 5);
  assert.equal(jobsFromEnv({ ROLEDONE_PROVIDER: 'mock' }).source, 'Sample');
  assert.equal(jobsFromEnv({ ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' }).source, 'Adzuna');
});
