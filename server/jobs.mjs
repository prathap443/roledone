// Job search behind one endpoint. Adzuna when keys are present (UK, US and 17 other countries,
// salaries); Arbeitnow otherwise (no key, remote/European tech jobs). Results are normalised to one
// shape, cached briefly per query, and never carry third-party keys to the browser.

const CACHE_TTL = 10 * 60 * 1000;
const COUNTRIES = { gb: 'United Kingdom', us: 'United States', au: 'Australia', ca: 'Canada', de: 'Germany', fr: 'France', in: 'India', nl: 'Netherlands', nz: 'New Zealand', pl: 'Poland', sg: 'Singapore', za: 'South Africa', at: 'Austria', be: 'Belgium', br: 'Brazil', ch: 'Switzerland', es: 'Spain', it: 'Italy', mx: 'Mexico' };

const stripHtml = (s) => String(s || '').replace(/<\/(p|li|div|h[1-6]|br)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();
const money = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

/** "£60k – £80k" style label, or null when the advert does not say. */
export function salaryLabel({ min, max, currency = 'GBP', predicted = false }) {
  if (!min && !max) return null;
  const sym = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', INR: '₹' }[currency] || `${currency} `;
  const label = min && max && Math.round(min) !== Math.round(max) ? `${sym}${money(min)} – ${sym}${money(max)}` : `${sym}${money(max || min)}`;
  return predicted ? `~${label}` : label;
}

export function normaliseAdzuna(r, country) {
  const min = Number(r.salary_min) || 0, max = Number(r.salary_max) || 0;
  return {
    id: `adzuna:${r.id}`,
    title: r.title || 'Untitled role',
    company: r.company?.display_name || 'Company not stated',
    location: [r.location?.display_name, COUNTRIES[country]].filter(Boolean).join(', '),
    remote: /remote/i.test(`${r.title} ${r.description}`),
    salary: salaryLabel({ min, max, currency: { gb: 'GBP', us: 'USD', au: 'AUD', ca: 'CAD', in: 'INR' }[country] || 'EUR', predicted: r.salary_is_predicted === '1' }),
    type: r.contract_time === 'part_time' ? 'Part-time' : r.contract_time === 'full_time' ? 'Full-time' : r.contract_type === 'contract' ? 'Contract' : null,
    category: r.category?.label?.replace(/ Jobs$/, '') || null,
    summary: stripHtml(r.description).slice(0, 320),
    description: stripHtml(r.description), // Adzuna only sends a snippet; the full advert is behind `url`
    partial: true,
    url: r.redirect_url,
    posted: r.created || null,
    source: 'Adzuna',
  };
}

export function normaliseArbeitnow(r) {
  const text = stripHtml(r.description);
  return {
    id: `arbeitnow:${r.slug}`,
    title: r.title || 'Untitled role',
    company: r.company_name || 'Company not stated',
    location: r.location || (r.remote ? 'Remote' : 'Not stated'),
    remote: Boolean(r.remote),
    salary: null,
    type: (r.job_types || [])[0] || null,
    category: (r.tags || []).find((t) => /engineer|data|science|devops|ai|ml|backend|frontend/i.test(t)) || (r.tags || [])[0] || null,
    summary: text.slice(0, 320),
    description: text,
    partial: false,
    url: r.url,
    posted: r.created_at ? new Date(r.created_at * 1000).toISOString() : null,
    source: 'Arbeitnow',
  };
}

/* ---------------- Per-source normalisers ---------------- */
const words = (s) => String(s || '').toLowerCase().match(/[a-z0-9+#.]+/g) || [];
const iso = (v) => { if (!v) return null; const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
const ukDate = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || ''); return m ? `${m[3]}-${m[2]}-${m[1]}T00:00:00Z` : iso(s); };
const base = (o) => ({ remote: false, salary: null, type: null, category: null, posted: null, partial: false, ...o, summary: stripHtml(o.description).slice(0, 320), description: stripHtml(o.description) });

export const normaliseReed = (r) => base({
  id: `reed:${r.jobId}`, title: r.jobTitle, company: r.employerName || 'Company not stated', location: [r.locationName, 'United Kingdom'].filter(Boolean).join(', '),
  remote: /remote/i.test(`${r.jobTitle} ${r.locationName}`), salary: salaryLabel({ min: Number(r.minimumSalary) || 0, max: Number(r.maximumSalary) || 0, currency: r.currency || 'GBP' }),
  type: r.contractType || (r.fullTime === false ? 'Part-time' : null), category: null, description: r.jobDescription, partial: true, url: r.jobUrl, posted: ukDate(r.date), source: 'Reed',
});
export const normaliseJooble = (r) => base({
  id: `jooble:${r.id}`, title: r.title, company: r.company || 'Company not stated', location: r.location || 'Not stated', remote: /remote/i.test(`${r.title} ${r.location}`),
  salary: r.salary || null, type: r.type || null, description: r.snippet, partial: true, url: r.link, posted: iso(r.updated), source: 'Jooble',
});
export const normaliseMuse = (r) => base({
  id: `muse:${r.id}`, title: r.name, company: r.company?.name || 'Company not stated', location: (r.locations || []).map((l) => l.name).join(' · ') || 'Not stated',
  remote: (r.locations || []).some((l) => /remote|flexible/i.test(l.name)), type: (r.levels || [])[0]?.name || null, category: (r.categories || [])[0]?.name || null,
  description: r.contents, url: r.refs?.landing_page, posted: iso(r.publication_date), source: 'The Muse',
});
export const normaliseRemotive = (r) => base({
  id: `remotive:${r.id}`, title: r.title, company: r.company_name || 'Company not stated', location: r.candidate_required_location ? `Remote · ${r.candidate_required_location}` : 'Remote', remote: true,
  salary: r.salary || null, type: r.job_type ? r.job_type.replace(/_/g, '-').replace(/^\w/, (c) => c.toUpperCase()) : null, category: r.category || null, description: r.description, url: r.url, posted: iso(r.publication_date), source: 'Remotive',
});
export const normaliseRemoteOK = (r) => base({
  id: `remoteok:${r.id}`, title: r.position, company: r.company || 'Company not stated', location: r.location ? `Remote · ${r.location}` : 'Remote', remote: true,
  salary: salaryLabel({ min: Number(r.salary_min) || 0, max: Number(r.salary_max) || 0, currency: 'USD' }), category: (r.tags || []).find((t) => /engineer|data|devops|backend|ai|ml/i.test(t)) || (r.tags || [])[0] || null,
  description: r.description, url: r.url || `https://remoteok.com/remote-jobs/${r.slug || r.id}`, posted: iso(r.date), source: 'RemoteOK',
});
export const normaliseHimalayas = (r) => base({
  id: `himalayas:${r.applicationLink || r.title}`, title: r.title, company: r.companyName || 'Company not stated', location: `Remote · ${(r.locationRestrictions || []).join(', ') || 'Worldwide'}`, remote: true,
  salary: salaryLabel({ min: Number(r.minSalary) || 0, max: Number(r.maxSalary) || 0, currency: r.currency || 'USD' }), type: r.seniority?.[0] || null, category: (r.categories || [])[0] || null,
  description: r.description || r.excerpt, url: r.applicationLink, posted: iso(r.pubDate), source: 'Himalayas',
});
export const normaliseGreenhouse = (r, board) => base({
  id: `gh:${board}:${r.id}`, title: r.title, company: r.company_name || board.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), location: r.location?.name || 'Not stated', remote: /remote/i.test(r.location?.name || ''),
  category: (r.departments || [])[0]?.name || null, description: decodeEntities(r.content || ''), url: r.absolute_url, posted: iso(r.updated_at), source: 'Company site',
});
export const normaliseLever = (r, company) => base({
  id: `lever:${company}:${r.id}`, title: r.text, company: company.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), location: r.categories?.location || 'Not stated', remote: /remote/i.test(r.categories?.location || r.workplaceType || ''),
  type: r.categories?.commitment || null, category: r.categories?.team || null, description: r.descriptionPlain || r.description, url: r.hostedUrl, posted: iso(r.createdAt), source: 'Company site',
});
const decodeEntities = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Does this job match the search words? Title matches count most. */
export function relevance(job, q) {
  const qs = words(q).filter((w) => w.length > 1);
  if (!qs.length) return 1;
  const title = words(job.title).join(' '), body = `${words(job.summary).join(' ')} ${words(job.category).join(' ')}`;
  let score = 0;
  for (const w of qs) { if (title.includes(w)) score += 3; else if (body.includes(w)) score += 1; }
  return score;
}

/** Merge results from several sources: dedupe title+company, prefer full descriptions, rank by relevance then recency. */
export function mergeJobs(lists, q, { page = 1, perPage = 20 } = {}) {
  const SUFFIX = new Set(['ltd', 'limited', 'plc', 'inc', 'llc', 'gmbh', 'co', 'corp', 'group', 'the']);
  const key = (j) => `${words(j.title).join(' ')}|${words(j.company).filter((w) => !SUFFIX.has(w)).slice(0, 2).join(' ')}`;
  const byKey = new Map();
  for (const job of lists.flat()) {
    const k = key(job), prev = byKey.get(k);
    if (!prev || (prev.partial && !job.partial)) byKey.set(k, job);
  }
  const scored = [...byKey.values()].map((j) => ({ j, r: relevance(j, q) })).filter((x) => !q || x.r > 0);
  scored.sort((a, b) => b.r - a.r || (b.j.partial ? 0 : 1) - (a.j.partial ? 0 : 1) || (Date.parse(b.j.posted || 0) || 0) - (Date.parse(a.j.posted || 0) || 0));
  const all = scored.map((x) => x.j);
  return { jobs: all.slice((page - 1) * perPage, page * perPage), total: all.length, hasMore: all.length > page * perPage };
}

export function createJobs({ adzunaId = null, adzunaKey = null, reedKey = null, joobleKey = null, museKey = null, greenhouseBoards = [], leverCompanies = [], remoteBoards = true, fetchImpl = fetch, now = Date.now, log = console, timeoutMs = 7000 } = {}) {
  const cache = new Map();

  const STUB = process.env.ROLEDONE_JOBS_STUB; // dev/test only: route every board to one local stub, keeping the host in the path
  async function getJson(url, init = {}) {
    if (STUB) url = `${STUB}/${url.replace(/^https?:\/\//, '')}`;
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: ctl.signal, headers: { accept: 'application/json', 'user-agent': 'roledone-jobs/1.0 (+https://roledone.com)', ...(init.headers || {}) } });
      if (!res.ok) throw Object.assign(new Error(`${res.status}`), { status: 502 });
      return res.json();
    } finally { clearTimeout(timer); }
  }

  // Each source: { name, enabled, scope: 'country' | 'remote', run({q, where, country, page}) -> jobs[] }
  const sources = [
    { name: 'Adzuna', enabled: Boolean(adzunaId && adzunaKey), scope: 'country', paged: true, async run({ q, where, country, page, anyOf }) {
      const params = new URLSearchParams({ app_id: adzunaId, app_key: adzunaKey, results_per_page: '20', [anyOf ? 'what_or' : 'what']: q || 'engineer', 'content-type': 'application/json', sort_by: anyOf ? 'date' : 'relevance' });
      if (where) params.set('where', where);
      const d = await getJson(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${params}`);
      return (d.results || []).map((r) => normaliseAdzuna(r, country));
    } },
    { name: 'Reed', enabled: Boolean(reedKey), scope: 'uk', paged: true, async run({ q, where, page }) {
      const params = new URLSearchParams({ keywords: q || 'engineer', resultsToTake: '20', resultsToSkip: String((page - 1) * 20) });
      if (where) params.set('locationName', where);
      const d = await getJson(`https://www.reed.co.uk/api/1.0/search?${params}`, { headers: { Authorization: `Basic ${Buffer.from(`${reedKey}:`).toString('base64')}` } });
      return (d.results || []).map(normaliseReed);
    } },
    { name: 'Jooble', enabled: Boolean(joobleKey), scope: 'country', paged: true, async run({ q, where, country, page }) {
      const d = await getJson(`https://jooble.org/api/${joobleKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keywords: q || 'engineer', location: where || COUNTRIES[country] || '', page }) });
      return (d.jobs || []).map(normaliseJooble);
    } },
    { name: 'The Muse', enabled: remoteBoards, scope: 'global', paged: false, async run({ q }) {
      const params = new URLSearchParams({ page: '1' }); for (const c of ['Data and Analytics', 'Software Engineering', 'Data Science', 'IT']) params.append('category', c); if (museKey) params.set('api_key', museKey);
      const d = await getJson(`https://www.themuse.com/api/public/jobs?${params}`);
      return (d.results || []).map(normaliseMuse).filter((j) => relevance(j, q) > 0);
    } },
    { name: 'Remotive', enabled: remoteBoards, scope: 'remote', paged: false, async run({ q }) {
      const params = new URLSearchParams({ limit: '50' }); if (q) params.set('search', q);
      const d = await getJson(`https://remotive.com/api/remote-jobs?${params}`);
      return (d.jobs || []).map(normaliseRemotive);
    } },
    { name: 'RemoteOK', enabled: remoteBoards, scope: 'remote', paged: false, async run({ q }) {
      const d = await getJson('https://remoteok.com/api');
      return (Array.isArray(d) ? d : []).filter((r) => r && r.id && r.position).map(normaliseRemoteOK).filter((j) => relevance(j, q) > 0).slice(0, 60);
    } },
    { name: 'Himalayas', enabled: remoteBoards, scope: 'remote', paged: false, async run({ q }) {
      const d = await getJson('https://himalayas.app/jobs/api?limit=100');
      return (d.jobs || []).map(normaliseHimalayas).filter((j) => relevance(j, q) > 0);
    } },
    { name: 'Arbeitnow', enabled: true, scope: 'remote', paged: true, async run({ q, page }) {
      const params = new URLSearchParams({ page: String(page) }); if (q) params.set('search', q);
      const d = await getJson(`https://www.arbeitnow.com/api/job-board-api?${params}`);
      return (d.data || []).map(normaliseArbeitnow);
    } },
    ...greenhouseBoards.map((board) => ({ name: `Greenhouse:${board}`, enabled: true, scope: 'global', paged: false, async run({ q }) {
      const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`);
      return (d.jobs || []).map((r) => normaliseGreenhouse(r, board)).filter((j) => relevance(j, q) > 0);
    } })),
    ...leverCompanies.map((co) => ({ name: `Lever:${co}`, enabled: true, scope: 'global', paged: false, async run({ q }) {
      const d = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(co)}?mode=json`);
      return (Array.isArray(d) ? d : []).map((r) => normaliseLever(r, co)).filter((j) => relevance(j, q) > 0);
    } })),
  ];
  const enabled = sources.filter((s) => s.enabled);
  const hasCountrySource = enabled.some((s) => s.scope === 'country');

  /** Fetch one source, swallowing failures (a dead board must never empty the page). */
  async function fetchSource(src, params) {
    const key = JSON.stringify([src.name, params.q, params.where, params.country, src.paged ? params.page : 1, params.anyOf]);
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_TTL) return hit.value;
    try {
      const jobs = await src.run(params);
      cache.set(key, { at: now(), value: jobs });
      return jobs;
    } catch (e) { log.warn?.(`[jobs] ${src.name} failed: ${e.message}`); cache.set(key, { at: now() - CACHE_TTL + 60_000, value: [] }); return []; } // retry a failed source after a minute
  }

  return {
    source: enabled.map((s) => s.name.split(':')[0]).filter((v, i, a) => a.indexOf(v) === i).join(' · '),
    sources: enabled.map((s) => s.name),
    countries: hasCountrySource ? COUNTRIES : { gb: 'United Kingdom', remote: 'Remote' },
    async search({ q = '', where = '', country = 'gb', page = 1, anyOf = false } = {}) {
      q = String(q).slice(0, 120).trim(); where = String(where).slice(0, 80).trim();
      country = COUNTRIES[country] ? country : 'gb';
      page = Math.min(Math.max(Number(page) || 1, 1), 20);
      const params = { q, where, country, page, anyOf };
      const wanted = enabled.filter((s) => {
        if (s.scope === 'uk' && country !== 'gb') return false;
        if (!s.paged && page > 1) return false; // unpaged boards contribute on page 1 only
        if (where && (s.scope === 'remote' || s.scope === 'global')) return /remote|anywhere|worldwide/i.test(where); // a city search should not fill with remote boards
        return true;
      });
      const lists = await Promise.all(wanted.map((s) => fetchSource(s, params)));
      // Paged sources already paginate upstream; merge the page's worth from each with the unpaged boards.
      const merged = mergeJobs(lists, q, { page: 1, perPage: 40 });
      if (cache.size > 800) for (const [k, v] of cache) if (now() - v.at > CACHE_TTL) cache.delete(k);
      return { jobs: merged.jobs, total: merged.total, page, hasMore: wanted.some((s) => s.paged) && lists.some((l, i) => wanted[i].paged && l.length >= 20), source: this.source, sources: wanted.map((s) => s.name.split(':')[0]).filter((v, i, a) => a.indexOf(v) === i) };
    },
    /** For the overview carousel: recent tech roles across sources. */
    async featured({ country = 'gb' } = {}) {
      const r = await this.search({ q: 'engineer developer data scientist devops', country, page: 1, anyOf: true }).catch((e) => { log.warn?.(`[jobs] featured failed: ${e.message}`); return { jobs: [] }; });
      // Interleave sources so the strip is not twenty Adzuna cards in a row
      const bySource = new Map(); for (const j of r.jobs) (bySource.get(j.source) || bySource.set(j.source, []).get(j.source)).push(j);
      const out = []; const queues = [...bySource.values()];
      while (out.length < 20 && queues.some((qd) => qd.length)) for (const qd of queues) { const j = qd.shift(); if (j && out.length < 20) out.push(j); }
      return { jobs: out, source: this.source };
    },
  };
}

/** Fixture used by the mock provider and tests so the UI works offline. */
export const FIXTURE_JOBS = [
  { id: 'fx:1', title: 'Senior Data Engineer', company: 'Northstar Analytics', location: 'Manchester, United Kingdom', remote: false, salary: '£75k – £90k', type: 'Full-time', category: 'Data', summary: 'Own the lakehouse platform on Databricks and Azure Data Factory. Terraform for infrastructure, GitHub Actions for CI/CD, and a small team to mentor.', description: 'We need an engineer to own our lakehouse on Databricks and Azure Data Factory. You will write PySpark and SQL daily, manage infrastructure with Terraform, run CI/CD in GitHub Actions and mentor two engineers. Must have: Python, PySpark, SQL, Databricks, Azure. Nice to have: Kafka, dbt.', partial: false, url: 'https://example.com/jobs/1', posted: null, source: 'Sample' },
  { id: 'fx:2', title: 'Machine Learning Engineer', company: 'Lumen Health', location: 'London, United Kingdom', remote: true, salary: '£85k – £110k', type: 'Full-time', category: 'AI', summary: 'Ship models into production: feature pipelines, evaluation, monitoring. Python, PyTorch, MLflow and a strong eye for data quality.', description: 'You will take models from notebook to production: feature pipelines, evaluation harnesses, monitoring. Must have: Python, PyTorch or TensorFlow, MLflow, SQL. Nice to have: Kubernetes, Azure ML.', partial: false, url: 'https://example.com/jobs/2', posted: null, source: 'Sample' },
  { id: 'fx:3', title: 'AI Agent Engineer', company: 'Fieldnote', location: 'Remote (UK)', remote: true, salary: null, type: 'Contract', category: 'AI', summary: 'Build tool-using agents on top of LLM APIs: MCP servers, evaluation, guardrails and cost control.', description: 'Design and build agents that call tools through MCP, with evaluation suites, guardrails and prompt caching to control cost. Must have: TypeScript or Python, LLM API experience, testing discipline. Nice to have: MCP, vector databases.', partial: false, url: 'https://example.com/jobs/3', posted: null, source: 'Sample' },
  { id: 'fx:4', title: 'Platform Engineer', company: 'Harbour Logistics', location: 'Leeds, United Kingdom', remote: false, salary: '£65k – £80k', type: 'Full-time', category: 'DevOps', summary: 'Kubernetes, Terraform, observability. Keep a 40-service platform boring.', description: 'Run our Kubernetes platform, Terraform modules and observability stack. Must have: Kubernetes, Terraform, Linux, one cloud. Nice to have: Go, Prometheus.', partial: false, url: 'https://example.com/jobs/4', posted: null, source: 'Sample' },
  { id: 'fx:5', title: 'Analytics Engineer', company: 'Brightwater', location: 'Bristol, United Kingdom', remote: true, salary: '£55k – £70k', type: 'Full-time', category: 'Data', summary: 'dbt, Snowflake, and clear models the business can trust.', description: 'Model data in dbt on Snowflake, own the semantic layer, partner with finance. Must have: SQL, dbt, a warehouse. Nice to have: Python, Looker.', partial: false, url: 'https://example.com/jobs/5', posted: null, source: 'Sample' },
];

export function createMockJobs() {
  const match = (q) => FIXTURE_JOBS.filter((j) => !q || `${j.title} ${j.company} ${j.summary}`.toLowerCase().includes(q.toLowerCase()));
  return {
    source: 'Sample',
    countries: { gb: 'United Kingdom' },
    async search({ q = '' } = {}) { const jobs = match(q); return { jobs, total: jobs.length, page: 1, hasMore: false, source: 'Sample' }; },
    async featured() { return { jobs: FIXTURE_JOBS, source: 'Sample' }; },
  };
}

const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
export function jobsFromEnv(env = process.env, opts = {}) {
  if ((env.ROLEDONE_PROVIDER || env.ROLEWOVEN_PROVIDER) === 'mock' && !env.ADZUNA_APP_ID && !env.REED_API_KEY) return createMockJobs();
  return createJobs({
    adzunaId: env.ADZUNA_APP_ID || null, adzunaKey: env.ADZUNA_APP_KEY || null,
    reedKey: env.REED_API_KEY || null, joobleKey: env.JOOBLE_API_KEY || null, museKey: env.MUSE_API_KEY || null,
    greenhouseBoards: list(env.ROLEDONE_GREENHOUSE_BOARDS), leverCompanies: list(env.ROLEDONE_LEVER_COMPANIES),
    remoteBoards: env.ROLEDONE_REMOTE_BOARDS !== 'off',
    ...opts,
  });
}
