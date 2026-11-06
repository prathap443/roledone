import test from 'node:test';
import assert from 'node:assert/strict';
import { structureCV } from '../dist/structure.js';
import { validateStructure } from '../server/validate.mjs';

const cv = `PRATHAP EXAMPLE
Senior Data Engineer / Data Architect
London, UK | +44 7700 900123 | prathap@example.com | LinkedIn

Professional Summary
Senior Azure data engineer with 12 years delivering platforms for UK government.

Experience
Senior Data Engineer | AIG Group | Jan 2022 – Present
• Built Synapse pipelines for finance reporting, cutting load time by 40%.
• Reviewed pull requests as part of delivery.
Data Engineer | Volvo Car Corporation | 2019 – 2021
Designed curated datasets in Synapse. Supported source-to-target reconciliation.

Skills
SQL • Python • PySpark • Databricks

Education
MSc Computer Systems Engineering | University of East London | 2008
BEng Electronics | India | 2006

Certifications
• Microsoft Certified: Azure Data Engineer Associate

Architecture Frameworks
TOGAF • ITIL`;

test('heuristic structurer finds header, roles, bullets, skills, education, certs and extras', () => {
  const s = structureCV(cv);
  assert.equal(s.name, 'PRATHAP EXAMPLE'); assert.equal(s.headline, 'Senior Data Engineer / Data Architect');
  assert.equal(s.contact.email, 'prathap@example.com'); assert.equal(s.contact.location, 'London, UK');
  assert.match(s.summary, /^Senior Azure/);
  assert.equal(s.experience.length, 2);
  assert.deepEqual([s.experience[0].title, s.experience[0].employer, s.experience[0].start, s.experience[0].end], ['Senior Data Engineer', 'AIG Group', 'Jan 2022', 'Present']);
  assert.equal(s.experience[0].bullets.length, 2);
  assert.equal(s.experience[1].bullets.length, 2, 'paragraph role split into sentences');
  assert.deepEqual(s.skills, ['SQL', 'Python', 'PySpark', 'Databricks']);
  assert.equal(s.education[0].institution, 'University of East London'); assert.equal(s.education[0].year, '2008');
  assert.equal(s.certifications.length, 1);
  assert.deepEqual(s.extras[0], { heading: 'Architecture Frameworks', lines: ['TOGAF • ITIL'] });
});

test('validateStructure drops anything not verbatim in the CV', () => {
  const raw = structureCV(cv);
  raw.experience[0].bullets.push('Invented a thing that is not in the CV.');
  raw.skills.push('Kubernetes');
  raw.experience[0].start = 'January 2022'; // reformatted date with digits present → allowed
  const { structured, dropped } = validateStructure(raw, { cv });
  assert.equal(dropped, 2);
  assert.equal(structured.experience[0].bullets.length, 2);
  assert.ok(!structured.skills.includes('Kubernetes'));
  assert.equal(structured.experience[0].start, 'January 2022');
  assert.equal(structured.experience[1].bullets[1], 'Supported source-to-target reconciliation.');
});

import { renderTemplate, TEMPLATES } from '../dist/templates.js';
import { structuredDocxBlob } from '../dist/export.js';
import JSZip from 'jszip';
test('every template renders every section and escapes HTML; structured Word export is a valid package', async () => {
  const s = structureCV(cv + '\n<script>alert(1)</script>');
  for (const id of Object.keys(TEMPLATES)) {
    const html = renderTemplate(id, s);
    for (const must of ['PRATHAP EXAMPLE', 'AIG Group', 'Volvo Car Corporation', 'University of East London', 'TOGAF', 'Databricks', 'Azure Data Engineer Associate']) assert.ok(html.includes(must), `${id} missing ${must}`);
    assert.ok(!html.includes('<script>alert'), `${id} did not escape`);
  }
  const blob = await structuredDocxBlob(s, 'standard', { JSZip });
  const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
  const doc = await zip.file('word/document.xml').async('string');
  assert.ok(doc.includes('AIG Group') && doc.includes('<w:numPr>') && doc.includes('w:val="right"'));
});
