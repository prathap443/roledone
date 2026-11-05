// CV Scan: deterministic, explainable sub-scores computed in the browser (and in Node for tests).
// No AI, no ATS emulation. Every number here can be traced to a rule below.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text, alias) => new RegExp('(^|[^a-z0-9+#])' + esc(alias) + '($|[^a-z0-9+#])', 'i').test(text);
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

/** Curated requirement sets per role family. Aliases are matched on word boundaries. */
export const ROLE_SETS = {
  'data-engineer': {
    label: 'Senior Data Engineer',
    requirements: [
      ['SQL', ['sql', 't-sql', 'tsql']], ['Python', ['python']], ['Spark / PySpark', ['spark', 'pyspark']],
      ['Data modelling', ['data model', 'data modelling', 'data modeling', 'dimensional', 'star schema', 'kimball', 'data vault']],
      ['ETL / ELT pipelines', ['etl', 'elt', 'pipeline', 'pipelines', 'ingestion']],
      ['Data warehouse / lakehouse', ['data warehouse', 'warehouse', 'lakehouse', 'delta lake', 'medallion', 'synapse', 'snowflake', 'bigquery', 'redshift', 'fabric']],
      ['Orchestration', ['data factory', 'adf', 'airflow', 'orchestrat', 'dagster', 'prefect']],
      ['Cloud platform', ['azure', 'aws', 'gcp', 'google cloud']],
      ['Databricks or equivalent', ['databricks', 'emr', 'dataproc']],
      ['Streaming / real-time', ['streaming', 'real-time', 'real time', 'kafka', 'event hub', 'event hubs', 'kinesis', 'pub/sub']],
      ['CI/CD', ['ci/cd', 'ci cd', 'continuous integration', 'continuous delivery', 'azure devops', 'github actions', 'gitlab ci', 'jenkins']],
      ['Version control', ['git', 'github', 'gitlab', 'bitbucket', 'azure repos']],
      ['Infrastructure as code', ['terraform', 'bicep', 'arm template', 'pulumi', 'cloudformation', 'infrastructure as code', 'iac']],
      ['Testing and data quality', ['data quality', 'unit test', 'testing', 'great expectations', 'dbt test', 'validation', 'reconciliation']],
      ['Monitoring and observability', ['monitoring', 'alerting', 'observability', 'log analytics', 'application insights', 'datadog', 'grafana']],
      ['Performance optimisation', ['optimis', 'optimiz', 'performance', 'tuning', 'partitioning']],
      ['Security and governance', ['purview', 'rbac', 'governance', 'gdpr', 'pii', 'encryption', 'key vault', 'unity catalog', 'row-level security']],
      ['Containers', ['docker', 'kubernetes', 'k8s', 'container']],
      ['APIs and integration', ['api', 'rest', 'apis', 'integration']],
      ['Reporting / BI', ['power bi', 'tableau', 'looker', 'reporting', 'dashboard']],
      ['Stakeholder communication', ['stakeholder', 'stakeholders', 'communicat', 'presented', 'business users', 'requirements']],
      ['Mentoring / leadership', ['mentor', 'led a team', 'leading', 'line manag', 'coached', 'team lead', 'technical lead']],
      ['Agile delivery', ['agile', 'scrum', 'sprint', 'kanban']],
      ['Cost optimisation', ['cost', 'finops', 'saving', 'savings']],
      ['Documentation', ['document', 'documentation', 'runbook', 'confluence']],
    ],
  },
};

const STRONG_VERBS = /^(designed|built|developed|delivered|led|owned|architected|migrated|automated|optimised|optimized|reduced|increased|improved|implemented|created|launched|established|introduced|modernised|modernized|consolidated|streamlined|cut|saved|scaled|deployed|engineered|re-?engineered|replaced|eliminated|accelerated|drove|shipped|transformed|mentored|coached|negotiated|secured|defined|standardised|standardized|rebuilt|refactored|tuned|partnered|coordinated|managed|oversaw|spearheaded|pioneered|resolved|diagnosed|recovered|restored|enabled|unlocked|integrated|productionised|productionized|containerised|containerized|provisioned|orchestrated)\b/i;
const WEAK_STARTS = /^(responsible for|worked on|worked with|helped|assisted|involved in|participated in|was part of|duties included|tasked with|supported)\b/i;
const QUANTIFIED = /\d|£|\$|€|%|\b(million|thousand|billion|half|double|tripled)\b/i;
const BUZZWORDS = ['results-driven', 'results driven', 'synergy', 'synergies', 'passionate', 'team player', 'hard-working', 'hardworking', 'go-getter', 'dynamic', 'proven track record', 'detail-oriented', 'detail oriented', 'self-starter', 'thought leader', 'guru', 'ninja', 'rockstar', 'rock star', 'think outside the box', 'best of breed', 'world-class', 'cutting-edge', 'cutting edge', 'seasoned', 'highly motivated', 'excellent communication skills', 'fast-paced', 'leverage', 'leveraging', 'game-changer', 'disruptive'];
const PASSIVE = /\b(was|were|been|being|is|are|be)\s+(\w+ed|built|done|made|given|taken|written|run|held|led)\b/i;
const HEADINGS = {
  summary: /^(professional\s+)?(summary|profile|about( me)?|overview|personal statement)\b/i,
  experience: /^(professional\s+|work\s+|employment\s+|relevant\s+)?(experience|history|career( history)?)\b/i,
  skills: /^(technical\s+|core\s+|key\s+)?(skills|competencies|technologies|tech stack|expertise)\b/i,
  education: /^(education|qualifications|academic)\b/i,
};

const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);
const isBullet = (l) => /^[•\-–—*▪◦●o>]\s*/.test(l);
const stripBullet = (l) => l.replace(/^[•\-–—*▪◦●o>]\s*/, '');
const words = (s) => s.split(/\s+/).filter(Boolean).length;

export function scanParse(text) {
  const ls = lines(text);
  const checks = [];
  const add = (label, ok, detail, weight = 1) => checks.push({ label, ok: Boolean(ok), detail, weight });
  add('Email address found', /[\w.+-]+@[\w-]+\.[\w.]+/.test(text), 'Recruiters and parsers look for an email near the top.');
  add('Phone number found', /(\+\d{1,3}[\s-]?)?(\(?\d{3,5}\)?[\s-]?)\d{3,4}[\s-]?\d{3,4}/.test(text), 'A phone number near the top is expected.');
  for (const [key, re] of Object.entries(HEADINGS)) {
    const found = ls.some((l) => l.length < 60 && re.test(l.replace(/[:#*_]/g, '').trim()));
    add(`"${key[0].toUpperCase() + key.slice(1)}" section heading`, found, found ? 'Standard heading recognised.' : `No line looks like a ${key} heading. Parsers map content by these headings.`, key === 'experience' ? 2 : 1);
  }
  const years = (text.match(/\b(19[89]\d|20[0-4]\d)\b/g) || []).length;
  add('Dates on roles', years >= 2, years >= 2 ? `${years} year references found.` : 'Few or no years found; employment dates may not be parsed.', 2);
  const bullets = ls.filter(isBullet).length;
  add('Bulleted achievements', bullets >= 5, bullets >= 5 ? `${bullets} bullet lines.` : `${bullets} bullet lines. Dense paragraphs are harder to scan in six seconds.`);
  const total = words(text);
  add('Length', total >= 300 && total <= 1400, `${total} words. ${total < 300 ? 'Short for a senior CV.' : total > 1400 ? 'Long: two pages is the usual ceiling for a senior CV.' : 'Within the usual two-page range.'}`);
  const columnish = ls.filter((l) => /\S {3,}\S|\t/.test(l)).length;
  add('Single-column text flow', columnish < Math.max(3, ls.length * 0.1), columnish ? `${columnish} lines contain wide gaps or tabs, which often come from tables or columns that parsers scramble.` : 'No signs of multi-column layout.');
  const first = ls[0] || '';
  add('Name on the first line', first.length > 0 && first.length < 60 && words(first) <= 5 && !/@|\d/.test(first), first ? `First line: "${first.slice(0, 40)}"` : 'Empty document.');
  const max = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  return { score: clamp((100 * got) / max), checks };
}

export function scanImpact(text) {
  const ls = lines(text);
  const bulletLines = ls.filter(isBullet).map(stripBullet);
  const candidates = (bulletLines.length >= 5 ? bulletLines : ls.filter((l) => words(l) >= 6)).filter((l) => words(l) >= 5 && words(l) <= 60);
  const quantified = candidates.filter((l) => QUANTIFIED.test(l));
  const strong = candidates.filter((l) => STRONG_VERBS.test(l));
  const weak = candidates.filter((l) => WEAK_STARTS.test(l));
  const n = candidates.length || 1;
  const score = candidates.length ? clamp(60 * (quantified.length / n) + 40 * (strong.length / n) - 15 * (weak.length / n)) : 0;
  return {
    score, total: candidates.length, quantified: quantified.length, strong: strong.length, weak: weak.length,
    examples: { weak: weak.slice(0, 3), unquantified: candidates.filter((l) => !QUANTIFIED.test(l) && !weak.includes(l)).slice(0, 3) },
  };
}

export function scanReadability(text) {
  const sentences = text.split(/\n|(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => words(s) >= 4);
  const n = sentences.length || 1;
  const avg = sentences.reduce((s, x) => s + words(x), 0) / n;
  const long = sentences.filter((s) => words(s) > 30);
  const passive = sentences.filter((s) => PASSIVE.test(s));
  const lower = text.toLowerCase();
  const buzz = BUZZWORDS.filter((b) => lower.includes(b));
  let score = 100;
  score -= Math.min(30, 100 * (long.length / n));
  score -= Math.min(25, 80 * (passive.length / n));
  score -= Math.min(30, buzz.length * 6);
  if (avg > 24) score -= 10;
  return { score: clamp(score), averageSentence: Math.round(avg), longSentences: long.length, passive: passive.length, buzzwords: buzz, examples: { long: long.slice(0, 2), passive: passive.slice(0, 2) } };
}

export function scanCoverage(text, role = 'data-engineer') {
  const set = ROLE_SETS[role] || ROLE_SETS['data-engineer'];
  const ls = lines(text);
  const found = [], missing = [];
  for (const [name, aliases] of set.requirements) {
    const alias = aliases.find((a) => mentions(text, a));
    if (alias) found.push({ name, evidence: ls.find((l) => mentions(l, alias)) || null });
    else missing.push(name);
  }
  return { score: clamp((100 * found.length) / set.requirements.length), role: set.label, found, missing, total: set.requirements.length };
}

export const WEIGHTS = { parse: 0.2, impact: 0.3, readability: 0.15, coverage: 0.35 };

export function scanCV(text, { role = 'data-engineer' } = {}) {
  const parts = { parse: scanParse(text), impact: scanImpact(text), readability: scanReadability(text), coverage: scanCoverage(text, role) };
  if (words(text) < 20) return { score: 0, band: 'needs-work', parts, words: words(text), tooShort: true };
  const score = clamp(Object.entries(WEIGHTS).reduce((s, [k, w]) => s + w * parts[k].score, 0));
  const band = score >= 85 ? 'exceptional' : score >= 70 ? 'strong' : score >= 50 ? 'developing' : 'needs-work';
  return { score, band, parts, words: words(text) };
}
