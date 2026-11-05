import test from 'node:test';
import assert from 'node:assert/strict';
import { scanCV, scanParse, scanImpact, scanReadability, scanCoverage } from '../dist/scan.js';
import { sampleCV } from '../dist/core.js';

const strong = `PRATHAP EXAMPLE
Senior Data Engineer | London | +44 7700 900123 | prathap@example.com

Professional Summary
Senior Azure data engineer with 12 years delivering data platforms for UK government.

Experience
Senior Data Engineer, Example Dept — 2021 to 2024
• Designed Azure Synapse lakehouse ingesting 20 sources, cutting overnight load from 6 hours to 90 minutes.
• Migrated 140 SSIS packages to Data Factory and PySpark, reducing failures by 60%.
• Led a team of 4 engineers; introduced CI/CD with Azure DevOps and Terraform.
• Built data quality checks with Great Expectations covering 95% of curated tables.
• Partnered with stakeholders to define reporting requirements for Power BI.
Data Engineer, Another Co — 2016 to 2021
• Automated SQL reconciliation, saving 10 hours a week.

Skills
SQL, Python, Spark, Databricks, Kafka, Docker, Git, Purview

Education
BSc Computer Science, 2008`;

const weak = `cv
Responsible for data pipelines and various reporting activities for the business which were delivered as required by the stakeholders across the whole organisation on a regular and ongoing basis every month.
Worked on SQL. Helped with Python. Passionate results-driven team player with a proven track record.
Involved in projects. Was part of a dynamic team.`;

test('parse checks reward standard structure and flag missing pieces', () => {
  const good = scanParse(strong), bad = scanParse(weak);
  assert.ok(good.score >= 85, `good parse ${good.score}`);
  assert.ok(bad.score <= 30, `bad parse ${bad.score}`);
  assert.ok(bad.checks.find((c) => c.label.includes('Experience')).ok === false);
  assert.ok(good.checks.find((c) => c.label === 'Dates on roles').ok);
});

test('impact rewards quantified, strong-verb bullets and penalises weak starts', () => {
  const good = scanImpact(strong), bad = scanImpact(weak);
  assert.equal(good.total, 6);
  assert.ok(good.quantified >= 5 && good.strong >= 5, JSON.stringify(good));
  assert.ok(good.score >= 85, `good impact ${good.score}`);
  assert.ok(bad.weak >= 2 && bad.score <= 25, `bad impact ${bad.score}`);
  assert.ok(bad.examples.weak[0].startsWith('Responsible for'));
});

test('readability penalises buzzwords, passive voice and long sentences', () => {
  const good = scanReadability(strong), bad = scanReadability(weak);
  assert.ok(good.score >= 85, `good readability ${good.score}`);
  assert.ok(bad.buzzwords.includes('results-driven') && bad.buzzwords.includes('team player'));
  assert.ok(bad.longSentences >= 1 && bad.passive >= 1);
  assert.ok(bad.score <= 55, `bad readability ${bad.score}`);
});

test('coverage counts curated role requirements with word boundaries and quotes evidence', () => {
  const c = scanCoverage(strong);
  assert.ok(c.found.length >= 16, `found ${c.found.length}: ${c.missing.join(', ')}`);
  assert.ok(c.missing.includes('APIs and integration'));
  for (const f of c.found) if (f.evidence) assert.ok(strong.includes(f.evidence));
  assert.equal(scanCoverage('I use GitHub and JavaScript.').found.find((f) => f.name === 'Version control')?.name, 'Version control');
  assert.equal(scanCoverage('Scala only.').found.length, 0);
});

test('overall score is a weighted blend with bands, and never throws on odd input', () => {
  const good = scanCV(strong), bad = scanCV(weak);
  assert.ok(good.score > bad.score + 40);
  assert.ok(['strong', 'exceptional'].includes(good.band));
  assert.equal(bad.band, 'needs-work');
  assert.ok(scanCV(sampleCV).score > 0);
  assert.equal(scanCV('').score, 0);
  assert.equal(scanCV('   \n\n').band, 'needs-work');
});
