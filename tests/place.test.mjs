import test from 'node:test';
import assert from 'node:assert/strict';
import { placeBullet, placeLearningLine, isRoleHeading } from '../dist/place.js';

const cv = `PRATHAP EXAMPLE
Senior Data Engineer

Professional Summary
Senior Azure engineer with 12 years across government and finance.

Experience
Senior Data Engineer | AIG Group | Jan 2022 – Present
• Built Synapse pipelines for finance reporting.
• Reviewed pull requests as part of delivery.

Data Engineer | Volvo Car Corporation | 2019 – 2021
• Designed curated datasets in Synapse.
• Supported source-to-target reconciliation.

Skills
SQL, Python

Education
BSc Computer Science, 2008`;

test('role headings are recognised, bullets and sentences are not', () => {
  assert.ok(isRoleHeading('Data Engineer | Volvo Car Corporation | 2019 – 2021'));
  assert.ok(isRoleHeading('Senior Data Engineer, Example Dept — 2021 to Present'));
  assert.ok(!isRoleHeading('• Migrated 140 packages in 2021.'));
  assert.ok(!isRoleHeading('Delivered the 2021 programme on time.'));
});

test('bullet lands at the end of the named role block with matching bullet style', () => {
  const { text, where } = placeBullet(cv, 'Provisioned the Synapse workspace with Terraform modules.', 'Data Engineer | Volvo Car Corporation | 2019 – 2021');
  const lines = text.split('\n');
  const i = lines.indexOf('• Provisioned the Synapse workspace with Terraform modules.');
  assert.ok(i > 0, text);
  assert.equal(lines[i - 1], '• Supported source-to-target reconciliation.');
  assert.equal(lines[i + 1].trim(), '');
  assert.equal(lines[i + 2], 'Skills');
  assert.match(where, /Volvo/);
});

test('fuzzy role match tolerates whitespace and partial lines', () => {
  const { text } = placeBullet(cv, 'Automated deployments with Azure DevOps.', 'Senior Data Engineer | AIG Group');
  const lines = text.split('\n');
  const i = lines.indexOf('• Automated deployments with Azure DevOps.');
  assert.equal(lines[i - 1], '• Reviewed pull requests as part of delivery.');
});

test('unknown role falls back to the end of Experience, not the end of the document', () => {
  const { text, where } = placeBullet(cv, 'Mentored two junior engineers.', 'Some role not in the CV');
  const lines = text.split('\n');
  const i = lines.indexOf('• Mentored two junior engineers.');
  assert.equal(lines[i - 1], '• Supported source-to-target reconciliation.');
  assert.match(where, /Experience/);
  assert.ok(!text.trimEnd().endsWith('Mentored two junior engineers.'));
});

test('learning line goes after the summary paragraph; everything degrades to append', () => {
  const { text } = placeLearningLine(cv, 'Currently developing automated testing.');
  const lines = text.split('\n');
  assert.equal(lines[lines.indexOf('Currently developing automated testing.') - 1], 'Senior Azure engineer with 12 years across government and finance.');
  assert.ok(placeBullet('Just a name\nOne line.', 'X.', null).text.endsWith('\nX.'));
  assert.ok(placeLearningLine('Just a name', 'Y.').text.endsWith('\nY.'));
});
