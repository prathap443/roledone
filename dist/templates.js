// CV templates: deterministic HTML/CSS rendered from the structured CV. No AI in the layout.
// Each template returns a complete HTML document sized for A4 so the same markup previews and prints.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const join = (parts, sep = ' · ') => parts.filter(Boolean).map(esc).join(sep);
const dates = (r) => [r.start, r.end].filter(Boolean).join(' – ');

export const TEMPLATES = {
  standard: { label: 'Standard', blurb: 'Centred masthead, title-case headings over a rule. The safe choice for any ATS.', font: "'Georgia', 'Times New Roman', serif", accent: '#1c3029' },
  modern: { label: 'Modern', blurb: 'Dark sidebar for contact and skills, clean sans-serif body. Reads well on screen.', font: "'Helvetica Neue', Arial, sans-serif", accent: '#1c3029' },
  compact: { label: 'Compact', blurb: 'Tight spacing and small caps headings to fit a senior CV on two pages.', font: "'Helvetica Neue', Arial, sans-serif", accent: '#2b2b2b' },
  minimal: { label: 'Minimal', blurb: 'Left-aligned, generous white space, one accent colour. Quiet and confident.', font: "'Helvetica Neue', Arial, sans-serif", accent: '#476025' },
};

const BASE = `
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;margin:0 auto;background:#fff}
h1,h2,h3,p,ul{margin:0}
ul{padding-left:14pt}li{margin:0 0 2.5pt;line-height:1.4}
a{color:inherit;text-decoration:none}
.role{break-inside:avoid}
`;

function sections(cv, { heading, roleHead }) {
  const out = [];
  if (cv.summary) out.push(heading('Professional Summary') + `<p class="summary">${esc(cv.summary)}</p>`);
  if (cv.experience.length) out.push(heading('Experience') + cv.experience.map((r) => `<div class="role">${roleHead(r)}${r.bullets.length ? `<ul>${r.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}</div>`).join(''));
  if (cv.education.length) out.push(heading('Education') + cv.education.map((e) => `<div class="edu"><span class="edu-q">${esc(e.qualification)}</span>${e.institution ? `<span class="edu-i">${esc(e.institution)}</span>` : ''}${e.year ? `<span class="edu-y">${esc(e.year)}</span>` : ''}</div>`).join(''));
  if (cv.certifications.length) out.push(heading('Certifications') + `<ul>${cv.certifications.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`);
  for (const x of cv.extras) out.push(heading(x.heading) + `<ul>${x.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
  return out.join('');
}

const renderers = {
  standard(cv, t) {
    const heading = (h) => `<h2>${esc(h)}</h2>`;
    const roleHead = (r) => `<div class="role-head"><div><strong>${esc(r.title)}</strong>${r.employer ? ` – ${esc(r.employer)}` : ''}</div><div class="meta"><em>${esc(dates(r))}</em>${r.location ? ` | ${esc(r.location)}` : ''}</div></div>`;
    return `<style>${BASE}
body{font:10.5pt/1.45 ${t.font}}.page{padding:16mm 18mm}
h1{text-align:center;font-size:24pt;font-weight:700;letter-spacing:.5px;color:${t.accent}}
.headline{text-align:center;font-size:12pt;margin-top:2pt;color:#333}.contact{text-align:center;font-size:9.5pt;color:#444;margin:6pt 0 4pt}
h2{font-size:12.5pt;font-weight:600;color:${t.accent};border-bottom:1.2px solid #333;padding-bottom:2pt;margin:14pt 0 7pt}
.summary{text-align:justify}.role{margin-bottom:9pt}.role-head{display:flex;justify-content:space-between;gap:12pt;margin-bottom:3pt}.meta{font-size:9.5pt;color:#444;white-space:nowrap}
.edu{display:flex;gap:8pt;margin-bottom:4pt}.edu-q{font-weight:600}.edu-i{color:#444}.edu-y{margin-left:auto;color:#444}
.skills{line-height:1.6}</style>
<div class="page"><h1>${esc(cv.name)}</h1>${cv.headline ? `<div class="headline">${esc(cv.headline)}</div>` : ''}<div class="contact">${join([cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links], ' &nbsp; ')}</div>
${sections(cv, { heading, roleHead })}${cv.skills.length ? heading('Skills') + `<p class="skills">${join(cv.skills, ', ')}</p>` : ''}</div>`;
  },

  modern(cv, t) {
    const heading = (h) => `<h2>${esc(h)}</h2>`;
    const roleHead = (r) => `<div class="role-head"><div><strong>${esc(r.title)}</strong>${r.employer ? `<span class="emp"> · ${esc(r.employer)}</span>` : ''}</div><div class="meta">${esc(dates(r))}${r.location ? ` · ${esc(r.location)}` : ''}</div></div>`;
    return `<style>${BASE}
body{font:10pt/1.45 ${t.font}}.page{display:grid;grid-template-columns:62mm 1fr;min-height:297mm}
.side{background:${t.accent};color:#e9efe4;padding:16mm 8mm 14mm 10mm}.main{padding:16mm 14mm 14mm 12mm}
.side h1{font-size:20pt;line-height:1.1;color:#fff;font-weight:700}.side .headline{color:#c9d96a;font-size:10pt;margin:6pt 0 16pt}
.side h3{font-size:8.5pt;letter-spacing:1.5px;text-transform:uppercase;color:#c9d96a;margin:14pt 0 6pt}
.side p,.side li{font-size:9pt;color:#e9efe4;word-break:break-word}.side ul{list-style:none;padding:0}.side li{padding:2pt 0;border-bottom:1px solid rgba(255,255,255,.12)}
h2{font-size:11pt;letter-spacing:1.2px;text-transform:uppercase;color:${t.accent};margin:14pt 0 7pt;padding-bottom:3pt;border-bottom:2px solid #d6e8a6}
.main h2:first-child{margin-top:0}.role{margin-bottom:9pt}.role-head{margin-bottom:3pt}.emp{color:#444}.meta{font-size:9pt;color:#666}
.edu{margin-bottom:4pt}.edu-q{font-weight:600}.edu-i{color:#444;margin-left:6pt}.edu-y{color:#666;margin-left:6pt}</style>
<div class="page"><aside class="side"><h1>${esc(cv.name)}</h1>${cv.headline ? `<div class="headline">${esc(cv.headline)}</div>` : ''}
<h3>Contact</h3>${[cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links].filter(Boolean).map((c) => `<p>${esc(c)}</p>`).join('')}
${cv.skills.length ? `<h3>Skills</h3><ul>${cv.skills.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
${cv.certifications.length ? `<h3>Certifications</h3><ul>${cv.certifications.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</aside>
<main class="main">${sections({ ...cv, certifications: [] }, { heading, roleHead })}</main></div>`;
  },

  compact(cv, t) {
    const heading = (h) => `<h2>${esc(h)}</h2>`;
    const roleHead = (r) => `<div class="role-head"><div><strong>${esc(r.title)}</strong>${r.employer ? `, ${esc(r.employer)}` : ''}${r.location ? ` (${esc(r.location)})` : ''}</div><span class="meta">${esc(dates(r))}</span></div>`;
    return `<style>${BASE}
body{font:9.5pt/1.35 ${t.font}}.page{padding:12mm 14mm}
.head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid ${t.accent};padding-bottom:5pt;margin-bottom:8pt}
h1{font-size:18pt;font-weight:700;color:${t.accent}}.headline{font-size:10pt;color:#333}.contact{font-size:8.5pt;color:#444;text-align:right;line-height:1.5}
h2{font-size:8.5pt;letter-spacing:1.6px;text-transform:uppercase;color:${t.accent};margin:9pt 0 4pt}
.role{margin-bottom:5pt}.role-head{display:flex;justify-content:space-between;gap:10pt}.meta{color:#555;font-size:8.5pt;white-space:nowrap}li{margin-bottom:1pt}
.edu{display:flex;gap:6pt}.edu-q{font-weight:600}.edu-i{color:#444}.edu-y{margin-left:auto;color:#555}.skills{line-height:1.5}</style>
<div class="page"><div class="head"><div><h1>${esc(cv.name)}</h1>${cv.headline ? `<div class="headline">${esc(cv.headline)}</div>` : ''}</div><div class="contact">${[cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links].filter(Boolean).map(esc).join('<br>')}</div></div>
${sections(cv, { heading, roleHead })}${cv.skills.length ? heading('Skills') + `<p class="skills">${join(cv.skills, ' · ')}</p>` : ''}</div>`;
  },

  minimal(cv, t) {
    const heading = (h) => `<h2>${esc(h)}</h2>`;
    const roleHead = (r) => `<div class="role-head"><div class="role-title">${esc(r.title)}</div><div class="role-meta">${join([r.employer, r.location])}${dates(r) ? ` <span>${esc(dates(r))}</span>` : ''}</div></div>`;
    return `<style>${BASE}
body{font:10.5pt/1.5 ${t.font};color:#222}.page{padding:20mm 22mm}
h1{font-size:26pt;font-weight:300;letter-spacing:-.5px}.headline{font-size:11pt;color:${t.accent};font-weight:600;margin-top:2pt}.contact{font-size:9.5pt;color:#666;margin:8pt 0 6pt}
h2{font-size:9.5pt;letter-spacing:2px;text-transform:uppercase;color:${t.accent};margin:18pt 0 8pt}
.role{margin-bottom:11pt}.role-title{font-weight:600}.role-meta{font-size:9.5pt;color:#666;margin-bottom:3pt}.role-meta span{margin-left:8pt}
ul{padding-left:12pt}.edu{margin-bottom:5pt}.edu-q{font-weight:600}.edu-i{color:#666;margin-left:6pt}.edu-y{color:#666;margin-left:6pt}.skills{color:#333}</style>
<div class="page"><h1>${esc(cv.name)}</h1>${cv.headline ? `<div class="headline">${esc(cv.headline)}</div>` : ''}<div class="contact">${join([cv.contact.email, cv.contact.phone, cv.contact.location, ...cv.contact.links])}</div>
${sections(cv, { heading, roleHead })}${cv.skills.length ? heading('Skills') + `<p class="skills">${join(cv.skills, '  ·  ')}</p>` : ''}</div>`;
  },
};

/** Full HTML document for a template. */
export function renderTemplate(id, cv) {
  const t = TEMPLATES[id] || TEMPLATES.standard;
  const body = (renderers[id] || renderers.standard)(cv, t);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(cv.name || 'CV')}</title></head><body>${body}</body></html>`;
}
