import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { paragraphs, diffLines, setParagraphText, applyDraft, applyDraftToDocx } from '../dist/docx-edit.js';
import { toDocxBlob } from '../dist/export.js';

const P = (text, extra = '') => `<w:p>${extra}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

test('paragraphs() reads text across split runs, tabs and empty paragraphs', () => {
  const xml = `<w:body><w:p><w:r><w:t>Senior </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Data</w:t></w:r><w:r><w:tab/><w:t>Engineer</w:t></w:r></w:p><w:p/><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Built pipelines</w:t></w:r></w:p></w:body>`;
  const ps = paragraphs(xml);
  assert.deepEqual(ps.map((p) => p.text), ['Senior Data\tEngineer', '', 'Built pipelines']);
  assert.equal(ps[2].hasNum, true);
});

test('setParagraphText keeps the first run formatting and drops the rest', () => {
  const xml = `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Old </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>text</w:t></w:r><w:bookmarkStart w:id="0" w:name="x"/></w:p>`;
  const out = setParagraphText(xml, 'New & improved <text>');
  assert.equal(paragraphs(out)[0].text, 'New & improved <text>');
  assert.ok(out.includes('<w:b/>') && !out.includes('<w:i/>') && out.includes('<w:jc') && out.includes('bookmarkStart'));
});

test('diffLines pairs delete+insert into replace and tracks insert anchors', () => {
  const ops = diffLines(['a', 'b', 'c'], ['a', 'B', 'c', 'd']);
  assert.deepEqual(ops.map((o) => o.type), ['equal', 'replace', 'equal', 'insert']);
  assert.equal(ops[3].after, 2);
});

test('applyDraft replaces, inserts a cloned bullet under the right role, and deletes', () => {
  const xml = `<w:document><w:body>${P('JANE EXAMPLE')}${P('Experience')}${P('Data Engineer | Volvo | 2019 – 2021')}${P('Designed curated datasets.', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>')}${P('Supported reconciliation.', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="3"/></w:numPr></w:pPr>')}${P('Skills')}${P('Old hobby line to remove.')}<w:sectPr/></w:body></w:document>`;
  const original = 'JANE EXAMPLE\n\nExperience\n\nData Engineer | Volvo | 2019 – 2021\n\nDesigned curated datasets.\n\nSupported reconciliation.\n\nSkills\n\nOld hobby line to remove.';
  const draft = 'JANE EXAMPLE\n\nExperience\n\nData Engineer | Volvo | 2019 – 2021\n\nDesigned curated datasets in Synapse for finance reporting.\n\nSupported reconciliation.\n• Provisioned the Synapse workspace with Terraform modules.\n\nSkills';
  const r = applyDraft(xml, original, draft);
  assert.deepEqual([r.replaced, r.inserted, r.deleted, r.unmatched], [1, 1, 1, []]);
  const texts = paragraphs(r.xml).map((p) => p.text);
  assert.deepEqual(texts, ['JANE EXAMPLE', 'Experience', 'Data Engineer | Volvo | 2019 – 2021', 'Designed curated datasets in Synapse for finance reporting.', 'Supported reconciliation.', 'Provisioned the Synapse workspace with Terraform modules.', 'Skills']);
  const inserted = paragraphs(r.xml)[5];
  assert.ok(inserted.hasNum, 'cloned numbering from the neighbouring bullet');
  assert.ok(inserted.xml.includes('w:numId w:val="3"'));
  assert.ok(!r.xml.includes('Old hobby'));
  assert.ok(r.xml.endsWith('<w:sectPr/></w:body></w:document>'));
});

test('a hand-written line with no anchor is reported, never silently dropped', () => {
  const xml = `<w:body>${P('Title')}${P('Line one')}</w:body>`;
  const r = applyDraft(xml, 'Title\nLine one', 'Brand new first line\nTitle\nLine one');
  assert.deepEqual(r.unmatched, ['Brand new first line']);
});

test('round-trips through a real .docx package', async () => {
  const original = 'PRATHAP EXAMPLE\nSenior Data Engineer\n\nExperience\nSenior Data Engineer, Dept — 2021 to 2024\n• Designed a Synapse lakehouse.\n• Migrated 140 SSIS packages.\n\nSkills\nSQL • Python';
  const blob = await toDocxBlob(original, { JSZip });
  const bytes = Buffer.from(await blob.arrayBuffer());
  const draft = original.replace('• Designed a Synapse lakehouse.', '• Designed a Synapse lakehouse cutting load from 6h to 90m.').replace('• Migrated 140 SSIS packages.', '• Migrated 140 SSIS packages.\n• Automated deployments with Azure DevOps.');
  const { blob: out, replaced, inserted } = await applyDraftToDocx(bytes, original, draft, { JSZip });
  assert.equal(replaced, 1); assert.equal(inserted, 1);
  const zip = await JSZip.loadAsync(Buffer.from(await out.arrayBuffer()));
  const texts = paragraphs(await zip.file('word/document.xml').async('string')).map((p) => p.text);
  assert.ok(texts.includes('Designed a Synapse lakehouse cutting load from 6h to 90m.'));
  assert.equal(texts[texts.indexOf('Migrated 140 SSIS packages.') + 1], 'Automated deployments with Azure DevOps.');
});
