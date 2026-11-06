// CV export: plain text, a minimal valid .docx built in the browser, and a print view for PDF.
// The .docx is deliberately simple (title, headings, bullets, paragraphs) so Word, Google Docs
// and LibreOffice all open it cleanly and recruiters can edit it.

const HEADING = /^(professional\s+|work\s+|employment\s+|technical\s+|core\s+|key\s+)?(summary|profile|about( me)?|overview|experience|history|career( history)?|skills|competencies|technologies|expertise|education|qualifications|certifications?|projects?|publications?|interests|references|awards|architecture frameworks|languages)\b/i;
const isHeading = (l) => l.length < 60 && (HEADING.test(l.replace(/[:#*_]/g, '').trim()) || (/^[A-Z][A-Z &/]+$/.test(l) && l.split(/\s+/).length <= 6));
const isBullet = (l) => /^[•\-–—*▪◦●>]\s*/.test(l);
const stripBullet = (l) => l.replace(/^[•\-–—*▪◦●>]\s*/, '');
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Classify CV text into blocks: title, heading, bullet, paragraph. */
export function blocks(text) {
  const out = [];
  let first = true;
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    if (first) { out.push({ type: 'title', text: l }); first = false; continue; }
    if (isBullet(l)) out.push({ type: 'bullet', text: stripBullet(l) });
    else if (isHeading(l)) out.push({ type: 'heading', text: l });
    else out.push({ type: 'paragraph', text: l });
  }
  return out;
}

const para = (b) => {
  const t = `<w:r><w:t xml:space="preserve">${xml(b.text)}</w:t></w:r>`;
  if (b.type === 'title') return `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${t}</w:p>`;
  if (b.type === 'heading') return `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>${t}</w:p>`;
  if (b.type === 'bullet') return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${t}</w:p>`;
  return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${t}</w:p>`;
};

const DOC_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const files = (body) => ({
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
  '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`,
  'word/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${DOC_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="1C3029"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="C9D4C6"/></w:pBdr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:caps/><w:sz w:val="20"/><w:color w:val="1C3029"/><w:spacing w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:spacing w:after="40"/></w:pPr></w:style></w:styles>`,
  'word/numbering.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${DOC_NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="360" w:hanging="200"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
  'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${DOC_NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`,
});

/** Build the .docx package as a Blob. Requires window.JSZip (vendored at /vendor/jszip/jszip.min.js). */
export async function toDocxBlob(text, { JSZip = globalThis.JSZip } = {}) {
  if (!JSZip) {
    await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = '/vendor/jszip/jszip.min.js'; s.onload = resolve; s.onerror = () => reject(new Error('Could not load the document writer.')); document.head.appendChild(s); });
    JSZip = globalThis.JSZip;
  }
  const zip = new JSZip();
  const body = blocks(text).map(para).join('');
  for (const [path, content] of Object.entries(files(body))) zip.file(path, content);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}

/** Open a clean print view of the CV in a new window and trigger the browser's print / Save as PDF. */
export function printCV(text) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = blocks(text).map((b) => b.type === 'title' ? `<h1>${esc(b.text)}</h1>` : b.type === 'heading' ? `<h2>${esc(b.text)}</h2>` : b.type === 'bullet' ? `<li>${esc(b.text)}</li>` : `<p>${esc(b.text)}</p>`)
    .join('').replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
  const w = window.open('', '_blank'); // same-origin blank window; it inherits our CSP, so no inline scripts below
  if (!w) throw new Error('Allow pop-ups for this site to print.');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>CV</title><style>
@page{size:A4;margin:18mm}body{font:10.5pt/1.45 Calibri,Arial,sans-serif;color:#1a1a1a;max-width:180mm;margin:0 auto}
h1{font-size:20pt;margin:0 0 4pt;color:#1c3029}h2{font-size:10pt;letter-spacing:1px;text-transform:uppercase;color:#1c3029;border-bottom:1px solid #c9d4c6;margin:14pt 0 5pt;padding-bottom:2pt}
p{margin:0 0 5pt}ul{margin:0 0 6pt 14pt;padding:0}li{margin:0 0 2pt}
</style></head><body>${html}</body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

// ---- Word export from the structured CV (single-column templates) ----
const RIGHT_TAB = 9638; // page width 11906 − margins 2×1134 = 9638 twips
const run = (text, { b, i, color, size, caps } = {}) => `<w:r><w:rPr>${b ? '<w:b/>' : ''}${i ? '<w:i/>' : ''}${caps ? '<w:caps/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${size ? `<w:sz w:val="${size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
const p = (runs, { style, after = 80, before = 0, jc, tabRight, keepNext } = {}) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${keepNext ? '<w:keepNext/>' : ''}${tabRight ? `<w:tabs><w:tab w:val="right" w:pos="${RIGHT_TAB}"/></w:tabs>` : ''}<w:spacing w:before="${before}" w:after="${after}"/>${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${runs}</w:p>`;
const bullet = (text) => `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="40"/></w:pPr>${run(text)}</w:p>`;
const TAB = '<w:r><w:tab/></w:r>';

/** Build a styled .docx from the structured CV. `template` picks typography; sidebar layouts fall back to a single column. */
export async function structuredDocxBlob(cv, template = 'standard', { JSZip = globalThis.JSZip } = {}) {
  if (!JSZip) {
    await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = '/vendor/jszip/jszip.min.js'; s.onload = resolve; s.onerror = () => reject(new Error('Could not load the document writer.')); document.head.appendChild(s); });
    JSZip = globalThis.JSZip;
  }
  const T = { standard: { font: 'Georgia', accent: '1C3029', centred: true, headingCaps: false }, modern: { font: 'Calibri', accent: '1C3029', centred: false, headingCaps: true }, compact: { font: 'Calibri', accent: '2B2B2B', centred: false, headingCaps: true, tight: true }, minimal: { font: 'Calibri', accent: '476025', centred: false, headingCaps: true } }[template] || { font: 'Calibri', accent: '1C3029' };
  const H = (text) => p(run(text, { b: true, color: T.accent, size: T.headingCaps ? 19 : 24, caps: T.headingCaps }), { style: 'Heading2', before: T.tight ? 160 : 240, after: 60, keepNext: true });
  const parts = [];
  parts.push(p(run(cv.name, { b: true, size: T.tight ? 32 : 40, color: T.accent }), { style: 'Title', after: 40, jc: T.centred ? 'center' : undefined }));
  if (cv.headline) parts.push(p(run(cv.headline, { size: 22, color: '333333' }), { after: 60, jc: T.centred ? 'center' : undefined }));
  const contact = [cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links].filter(Boolean).join('   ·   ');
  if (contact) parts.push(p(run(contact, { size: 18, color: '555555' }), { after: 120, jc: T.centred ? 'center' : undefined }));
  if (cv.summary) parts.push(H('Professional Summary'), p(run(cv.summary), { after: 100 }));
  if (cv.experience.length) {
    parts.push(H('Experience'));
    for (const r of cv.experience) {
      const d = [r.start, r.end].filter(Boolean).join(' – ');
      parts.push(p(run(r.title, { b: true }) + (r.employer ? run(` – ${r.employer}`) : '') + (d ? TAB + run(d, { i: true, color: '555555', size: 19 }) : ''), { after: 20, tabRight: true, keepNext: true }));
      if (r.location) parts.push(p(run(r.location, { size: 18, color: '666666' }), { after: 40 }));
      for (const b of r.bullets) parts.push(bullet(b));
      parts.push(p('', { after: 60 }));
    }
  }
  if (cv.education.length) { parts.push(H('Education')); for (const e of cv.education) parts.push(p(run(e.qualification, { b: true }) + (e.institution ? run(`, ${e.institution}`) : '') + (e.year ? TAB + run(e.year, { color: '555555', size: 19 }) : ''), { after: 60, tabRight: true })); }
  if (cv.skills.length) parts.push(H('Skills'), p(run(cv.skills.join(' · ')), { after: 80 }));
  if (cv.certifications.length) { parts.push(H('Certifications')); for (const c of cv.certifications) parts.push(bullet(c)); }
  for (const x of cv.extras) { parts.push(H(x.heading)); for (const l of x.lines) parts.push(bullet(l)); }
  const zip = new JSZip();
  const all = files(parts.join(''));
  all['word/styles.xml'] = all['word/styles.xml'].replace(/w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/, `w:ascii="${T.font}" w:hAnsi="${T.font}" w:cs="${T.font}"`).replace('<w:sz w:val="21"/>', `<w:sz w:val="${T.tight ? 19 : 21}"/>`);
  for (const [path, content] of Object.entries(all)) zip.file(path, content);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}
