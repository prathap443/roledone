import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobs, createMockJobs, normaliseAdzuna, normaliseArbeitnow, normaliseReed, normaliseJooble, normaliseGreenhouse, normaliseLever, salaryLabel, jobsFromEnv, relevance, mergeJobs } from '../server/jobs.mjs';

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

test('aggregator: queries every enabled source in parallel, caches, dedupes, prefers full descriptions', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    const json = (body) => ({ ok: true, json: async () => body });
    if (url.includes('adzuna')) return json({ count: 1, results: [{ id: '1', title: 'Data Engineer', company: { display_name: 'Acme' }, location: { display_name: 'Leeds' }, description: 'short', redirect_url: 'u1' }] });
    if (url.includes('reed.co.uk')) { assert.match(init.headers.Authorization, /^Basic /); return json({ results: [{ jobId: 9, jobTitle: 'Data Engineer', employerName: 'Acme', locationName: 'Leeds', minimumSalary: 50000, maximumSalary: 60000, jobDescription: 'snippet', jobUrl: 'u2', date: '01/11/2026' }] }); }
    if (url.includes('remotive')) return json({ jobs: [{ id: 5, title: 'Data Engineer', company_name: 'Acme', url: 'u3', description: '<p>Full description of the data engineer role</p>', job_type: 'full_time', publication_date: '2026-11-02T00:00:00' }] });
    if (url.includes('remoteok')) return json([{ legal: 'notice' }, { id: 7, position: 'Platform Engineer', company: 'Harbour', url: 'u4', description: 'k8s', tags: ['devops'], date: '2026-11-03T00:00:00Z' }]);
    if (url.includes('himalayas')) return json({ jobs: [] });
    if (url.includes('themuse')) return json({ results: [] });
    if (url.includes('arbeitnow')) return json({ data: [] });
    throw new Error('unexpected ' + url);
  };
  const jobs = createJobs({ adzunaId: 'id', adzunaKey: 'key', reedKey: 'rk', fetchImpl, now: () => 1000 });
  assert.deepEqual(jobs.sources, ['Adzuna', 'Reed', 'The Muse', 'Remotive', 'RemoteOK', 'Himalayas', 'Arbeitnow']);
  const r1 = await jobs.search({ q: 'data engineer', country: 'gb', page: 1 });
  const n = calls.length; assert.equal(n, 7, 'one call per source');
  // Three sources returned the same role at Acme: one card, the full-text one wins
  const acme = r1.jobs.filter((j) => j.company === 'Acme');
  assert.equal(acme.length, 1); assert.equal(acme[0].source, 'Remotive'); assert.equal(acme[0].partial, false);
  assert.ok(r1.jobs.find((j) => j.title === 'Platform Engineer'), 'remoteok included (data matched? no) — platform engineer matches "engineer"');
  const r2 = await jobs.search({ q: 'data engineer', country: 'gb', page: 1 });
  assert.equal(calls.length, n, 'second search served from cache'); assert.equal(r2.jobs.length, r1.jobs.length);
  // A city search excludes remote boards; a non-UK country excludes Reed
  await jobs.search({ q: 'data', where: 'Leeds', country: 'gb' });
  assert.ok(!calls.slice(n).some((u) => u.includes('remotive')), 'remote boards skipped for a city');
  const m = calls.length;
  await jobs.search({ q: 'data', country: 'us' });
  assert.ok(!calls.slice(m).some((u) => u.includes('reed.co.uk')), 'Reed skipped outside the UK');
});

test('aggregator: a failing source is dropped, not fatal; featured interleaves sources', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('arbeitnow')) return { ok: true, json: async () => ({ data: [{ slug: 'a', title: 'ML Engineer', company_name: 'X', url: 'u', description: 'd', remote: true, tags: [], job_types: [], created_at: 1700000000 }] }) };
    return { ok: false, status: 503 };
  };
  const jobs = createJobs({ fetchImpl, log: { warn() {} } });
  const r = await jobs.search({ q: 'engineer' });
  assert.equal(r.jobs.length, 1); assert.equal(r.jobs[0].source, 'Arbeitnow');
  const f = await jobs.featured();
  assert.equal(f.jobs.length, 1);
});

test('relevance and merge ranking', () => {
  const mk = (title, company, partial, posted) => ({ id: title, title, company, summary: '', category: '', partial, posted });
  assert.equal(relevance(mk('Data Engineer', 'A', true), 'data engineer'), 6);
  assert.equal(relevance(mk('Baker', 'A', true), 'data'), 0);
  const m = mergeJobs([[mk('Data Engineer', 'Acme', true, '2026-01-01'), mk('Analyst', 'B', false, '2026-01-02')], [mk('Data Engineer', 'Acme Ltd', false, '2026-01-01'), mk('Data Platform Engineer', 'C', false, '2026-02-01')]], 'data engineer');
  assert.deepEqual(m.jobs.map((j) => j.title), ['Data Platform Engineer', 'Data Engineer']); // Analyst filtered out; Acme deduped to the full-text copy
  assert.equal(m.jobs[1].partial, false);
});

test('normalisers for the new sources', () => {
  assert.equal(normaliseReed({ jobId: 1, jobTitle: 'T', employerName: 'E', locationName: 'Bristol', minimumSalary: 40000, maximumSalary: 40000, currency: 'GBP', jobDescription: '<b>x</b>', jobUrl: 'u', date: '05/11/2026' }).salary, '£40k');
  assert.equal(normaliseJooble({ id: 'j', title: 'T', company: 'C', location: 'Berlin', snippet: 's', link: 'u', updated: '2026-11-01T00:00:00Z' }).posted, '2026-11-01T00:00:00.000Z');
  assert.equal(normaliseGreenhouse({ id: 3, title: 'T', location: { name: 'Remote - UK' }, content: '&lt;p&gt;Body&lt;/p&gt;', absolute_url: 'u' }, 'acme-co').company, 'Acme Co');
  assert.equal(normaliseGreenhouse({ id: 3, title: 'T', location: { name: 'Remote - UK' }, content: '&lt;p&gt;Body&lt;/p&gt;', absolute_url: 'u' }, 'acme-co').description, 'Body');
  assert.equal(normaliseLever({ id: 'l', text: 'T', categories: { location: 'London', commitment: 'Full-time' }, descriptionPlain: 'd', hostedUrl: 'u', createdAt: 1700000000000 }, 'monzo').type, 'Full-time');
});

test('mock jobs filter the fixture', async () => {
  const m = createMockJobs();
  assert.equal((await m.search({ q: 'agent' })).jobs.length, 1);
  assert.ok((await m.featured()).jobs.length >= 5);
  assert.equal(jobsFromEnv({ ROLEDONE_PROVIDER: 'mock' }).source, 'Sample');
  assert.ok(jobsFromEnv({ ADZUNA_APP_ID: 'a', ADZUNA_APP_KEY: 'b' }).sources.includes('Adzuna'));
});
