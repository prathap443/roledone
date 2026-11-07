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

export function createJobs({ adzunaId = null, adzunaKey = null, fetchImpl = fetch, now = Date.now, log = console } = {}) {
  const cache = new Map();
  const adzuna = Boolean(adzunaId && adzunaKey);

  async function getJson(url) {
    const res = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'roledone-jobs/1.0' } });
    if (!res.ok) throw Object.assign(new Error(`Job source responded ${res.status}`), { status: 502 });
    return res.json();
  }

  async function searchAdzuna({ q, where, country, page }) {
    const params = new URLSearchParams({ app_id: adzunaId, app_key: adzunaKey, results_per_page: '20', what: q, 'content-type': 'application/json', sort_by: 'relevance' });
    if (where) params.set('where', where);
    const data = await getJson(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${params}`);
    return { jobs: (data.results || []).map((r) => normaliseAdzuna(r, country)), total: Number(data.count) || 0, page, hasMore: (data.results || []).length === 20 };
  }

  async function searchArbeitnow({ q, page }) {
    const params = new URLSearchParams({ page: String(page) });
    if (q) params.set('search', q);
    const data = await getJson(`https://www.arbeitnow.com/api/job-board-api?${params}`);
    const jobs = (data.data || []).map(normaliseArbeitnow);
    return { jobs, total: Number(data.meta?.total) || jobs.length, page, hasMore: Boolean(data.links?.next) };
  }

  return {
    source: adzuna ? 'Adzuna' : 'Arbeitnow',
    countries: adzuna ? COUNTRIES : { remote: 'Remote / Europe' },
    /** Search. `country` is an Adzuna code; ignored for Arbeitnow. */
    async search({ q = '', where = '', country = 'gb', page = 1 } = {}) {
      q = String(q).slice(0, 120).trim(); where = String(where).slice(0, 80).trim();
      country = COUNTRIES[country] ? country : 'gb';
      page = Math.min(Math.max(Number(page) || 1, 1), 20);
      const key = JSON.stringify([adzuna, q, where, country, page]);
      const hit = cache.get(key);
      if (hit && now() - hit.at < CACHE_TTL) return hit.value;
      const value = adzuna ? await searchAdzuna({ q: q || 'engineer', where, country, page }) : await searchArbeitnow({ q, page });
      value.source = adzuna ? 'Adzuna' : 'Arbeitnow';
      cache.set(key, { at: now(), value });
      if (cache.size > 500) for (const [k, v] of cache) if (now() - v.at > CACHE_TTL) cache.delete(k);
      return value;
    },
    /** A small set for the overview carousel: tech roles, cached for the TTL. */
    async featured({ country = 'gb' } = {}) {
      const r = await this.search({ q: adzuna ? 'data engineer OR software engineer OR machine learning' : 'engineer', country, page: 1 }).catch((e) => { log.warn?.(`[jobs] featured failed: ${e.message}`); return { jobs: [] }; });
      return { jobs: r.jobs.slice(0, 10), source: this.source };
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

export function jobsFromEnv(env = process.env, opts = {}) {
  if ((env.ROLEDONE_PROVIDER || env.ROLEWOVEN_PROVIDER) === 'mock' && !env.ADZUNA_APP_ID) return createMockJobs();
  return createJobs({ adzunaId: env.ADZUNA_APP_ID || null, adzunaKey: env.ADZUNA_APP_KEY || null, ...opts });
}
