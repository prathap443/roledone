import test from 'node:test';
import assert from 'node:assert/strict';
import { isSpanOf, locateSpan, unsupportedNumbers, validateMatch, validateSuggestions, validateFeedback } from '../server/validate.mjs';
import { sampleCV, sampleJD } from '../dist/core.js';

test('locateSpan tolerates whitespace and case but not paraphrase', () => {
  assert.equal(locateSpan('azure data factory', sampleCV), 'Azure Data Factory');
  assert.equal(locateSpan('Optimised   SQL transformations', sampleCV), 'Optimised SQL transformations');
  assert.equal(locateSpan('Built Synapse pipelines', sampleCV), null);
  assert.ok(isSpanOf('PySpark and Databricks', sampleCV));
});

test('unsupportedNumbers flags metrics that are not in any source', () => {
  assert.deepEqual(unsupportedNumbers('Reduced processing time by 30%', [sampleCV]), []);
  assert.deepEqual(unsupportedNumbers('Processed 20M records daily, cutting time by 30%', [sampleCV]), ['20m']);
  assert.deepEqual(unsupportedNumbers('Saved £50,000 a year', [sampleCV]), ['£50000']);
});

test('validateMatch drops requirements without a JD source and repairs fabricated evidence', () => {
  const raw = { requirements: [
    { name: 'SQL', kind: 'must', source: 'SQL, Python, PySpark and Databricks', evidence: 'Optimised SQL transformations, reducing processing time by 30%.', status: 'evidence', note: 'ok' },
    { name: 'Terraform', kind: 'must', source: 'Manage infrastructure with Terraform', evidence: 'Provisioned Terraform modules', status: 'evidence', note: 'made up' },
    { name: 'Kubernetes', kind: 'nice', source: 'Kubernetes experience desirable', evidence: null, status: 'gap', note: 'not in JD' },
    { name: 'SQL', kind: 'must', source: 'SQL', evidence: null, status: 'gap', note: 'duplicate' },
  ] };
  const { requirements, dropped, repaired } = validateMatch(raw, { cv: sampleCV, jd: sampleJD });
  assert.deepEqual(requirements.map((r) => [r.name, r.status, r.evidence !== null]), [['SQL', 'evidence', true], ['Terraform', 'gap', false]]);
  assert.equal(dropped, 2);
  assert.equal(repaired, 1);
  for (const r of requirements) { assert.ok(sampleJD.includes(r.source)); if (r.evidence) assert.ok(sampleCV.includes(r.evidence)); }
});

test('validateSuggestions rejects invented numbers, gap skills, and unanchored originals', () => {
  const draft = sampleCV;
  const requirements = [{ name: 'Terraform', status: 'gap' }, { name: 'SQL', status: 'evidence' }];
  const raw = { suggestions: [
    { requirement: 'SQL', original: 'Optimised SQL transformations, reducing processing time by 30%.', proposed: 'Optimised SQL transformations in Azure Synapse, reducing processing time by 30%.', rationale: 'Names the platform.', evidence: ['Azure Synapse'], unsupported: [] },
    { requirement: '', original: 'Developed Python validation checks and monitored daily data quality.', proposed: 'Developed Python validation checks across 40 datasets.', rationale: 'x', evidence: [], unsupported: [] },
    { requirement: 'Terraform', original: 'Maintained Git repositories and reviewed pull requests.', proposed: 'Maintained Git repositories and Terraform modules.', rationale: 'x', evidence: [], unsupported: [] },
    { requirement: '', original: 'This sentence is not in the draft.', proposed: 'Anything', rationale: 'x', evidence: [], unsupported: [] },
    { requirement: '', original: 'Used PySpark and Databricks to transform event data.', proposed: 'Used PySpark and Databricks to transform event data.', rationale: 'same', evidence: [], unsupported: [] },
  ] };
  const { suggestions, rejected } = validateSuggestions(raw, { cv: sampleCV, draft, requirements });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].requirement, 'SQL');
  assert.ok(draft.includes(suggestions[0].original));
  assert.deepEqual(rejected.map((r) => r.reason), ['unsupported numbers: 40', 'introduces "terraform" without evidence', 'original text not found in draft', 'no change']);
});

test('validateSuggestions keeps user-typed numbers from the draft as supported', () => {
  const draft = sampleCV + '\nLed a team of 4 engineers.';
  const raw = { suggestions: [{ requirement: '', original: 'Led a team of 4 engineers.', proposed: 'Led a 4-engineer team delivering Azure Data Factory pipelines.', rationale: 'x', evidence: [], unsupported: [] }] };
  assert.equal(validateSuggestions(raw, { cv: sampleCV, draft, requirements: [] }).suggestions.length, 1);
});

test('validateFeedback normalises shape and never throws on garbage', () => {
  const fb = validateFeedback({ summary: 42, star: { action: { present: 'yes', note: 'ok' } }, strengths: 'nope', improvements: ['a', 'b', 3] });
  assert.equal(fb.summary, '');
  assert.equal(fb.star.action.present, true);
  assert.equal(fb.star.result.present, false);
  assert.deepEqual(fb.strengths, []);
  assert.deepEqual(fb.improvements, ['a', 'b']);
});

import { validateQuestions, validateGapBullet } from '../server/validate.mjs';
test('validateQuestions keeps focus only when it names a real requirement', () => {
  const { questions } = validateQuestions({ questions: [
    { prompt: 'How did you tune the Synapse pipelines you built?', type: 'depth', focus: 'Azure Synapse', why: 'x', listen_for: ['a'] },
    { prompt: 'short', type: 'depth', focus: '', why: '', listen_for: [] },
    { prompt: 'Describe how you would adopt Terraform in a team new to IaC.', type: 'gap', focus: 'Pulumi', why: 'x', listen_for: [] },
  ] }, { requirements: [{ name: 'Azure Synapse' }, { name: 'Terraform' }] });
  assert.deepEqual(questions.map((q) => [q.id, q.focus]), [['q1', 'Azure Synapse'], ['q2', '']]);
});

test('validateGapBullet only lets the candidate’s own facts through', () => {
  const base = { cv: sampleCV, requirement: 'Terraform', otherGaps: ['Terraform', 'CI/CD'] };
  const answers = ['Yes, I wrote Terraform modules for our Databricks workspaces across 3 environments.'];
  const ok = validateGapBullet({ verdict: 'supported', bullet: 'Provisioned Databricks workspaces across 3 environments with Terraform modules.', explanation: 'e', learning_line: '' }, { ...base, answers });
  assert.equal(ok.verdict, 'supported'); assert.ok(ok.bullet);
  const inflated = validateGapBullet({ verdict: 'supported', bullet: 'Provisioned 12 environments with Terraform.', explanation: 'e', learning_line: '' }, { ...base, answers });
  assert.equal(inflated.verdict, 'unsupported'); assert.match(inflated.rejected, /12/);
  const smuggled = validateGapBullet({ verdict: 'supported', bullet: 'Built Terraform modules deployed through CI/CD.', explanation: 'e', learning_line: '' }, { ...base, answers });
  assert.match(smuggled.rejected, /ci\/cd/);
  const none = validateGapBullet({ verdict: 'unsupported', bullet: 'Expert in Terraform.', explanation: 'e', learning_line: 'Currently learning Terraform.' }, { ...base, answers: ['No, never used it.'] });
  assert.equal(none.bullet, ''); assert.equal(none.learning_line, 'Currently learning Terraform.');
});
