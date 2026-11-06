// Heuristic CV structuring (no AI). Used as the instant first pass and as the fallback when AI is off.
// The AI structurer (/api/structure) produces the same shape with better splitting.

import { achievementLines } from './scan.js';

const SECTION = {
  summary: /^(professional\s+)?(summary|profile|about( me)?|overview|personal statement)\b/i,
  experience: /^(professional\s+|work\s+|employment\s+|relevant\s+)?(experience|history|career( history)?)\b/i,
  skills: /^(technical\s+|core\s+|key\s+)?(skills|competencies|technologies|tech stack|expertise)\b/i,
  education: /^(education|qualifications|academic)\b/i,
  certifications: /^(certifications?|accreditations?)\b/i,
};
const clean = (l) => l.replace(/[:#*_]/g, '').trim();
const words = (l) => l.trim().split(/\s+/).filter(Boolean).length;
const isBullet = (l) => /^[•\-–—*▪◦●>]\s*/.test(l);
const strip = (l) => l.replace(/^[•\-–—*▪◦●>]\s*/, '').trim();
const sectionOf = (l) => { const c = clean(l); if (c.length >= 60) return null; for (const [k, re] of Object.entries(SECTION)) if (re.test(c)) return k; return /^[A-Z][A-Za-z &/]{2,40}$/.test(c) && words(c) <= 5 ? 'other' : null; };
const isRole = (l) => !isBullet(l) && words(l) <= 18 && /\b(19[89]\d|20[0-4]\d|present|current|to date)\b/i.test(l) && !/[.!?]$/.test(l.trim());
const DATE = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(19[89]\d|20[0-4]\d)\s*(?:[–—-]|to)\s*((?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19[89]\d|20[0-4]\d)|present|current|to date|date)/i;

export function structureCV(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = { name: '', headline: '', contact: { email: '', phone: '', location: '', links: [] }, summary: '', experience: [], education: [], skills: [], certifications: [], extras: [] };
  out.contact.email = (text.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [''])[0];
  out.contact.phone = (text.match(/(\+\d{1,3}[\s-]?)?\(?\d{3,5}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/) || [''])[0].trim();
  out.contact.links = (text.match(/(?:linkedin\.com|github\.com)\/[\w\-/]+|\bLinkedIn\b|\bGitHub\b/gi) || []).slice(0, 3);
  let section = 'header', extra = null, role = null, summary = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const sec = sectionOf(l);
    // The name / headline lines in the header are not section headings.
    if (sec && !(section === 'header' && sec === 'other' && (!out.name || !out.headline))) { section = sec; role = null; extra = sec === 'other' ? { heading: clean(l), lines: [] } : null; if (extra) out.extras.push(extra); continue; }
    if (section === 'header') {
      if (!out.name && words(l) <= 5 && !/@|\d/.test(l)) { out.name = l; continue; }
      if (out.name && !out.headline && !/@|\d{3}/.test(l) && words(l) <= 12) { out.headline = l; continue; }
      if (/@|\+?\d{3}/.test(l)) { const loc = l.split(/\s*[|•·]\s*/).find((p) => !/@|\d{3}|linkedin|github/i.test(p) && words(p) <= 6); if (loc && !out.contact.location) out.contact.location = loc.trim(); }
      continue;
    }
    if (section === 'summary') { summary.push(l); continue; }
    if (section === 'experience') {
      if (isRole(l)) {
        const d = l.match(DATE);
        const parts = l.replace(DATE, '').split(/\s*[|,—–-]\s*/).map((p) => p.trim()).filter(Boolean);
        role = { title: parts[0] || l, employer: parts[1] || '', location: parts[2] || '', start: d ? `${d[1] || ''}${d[2]}`.trim() : '', end: d ? d[3] : '', bullets: [] };
        out.experience.push(role); continue;
      }
      if (role) { if (isBullet(l)) role.bullets.push(strip(l)); else role.bullets.push(...l.split(/(?<=[.!?])\s+(?=[A-Z])/).map((x) => x.trim()).filter(Boolean)); }
      continue;
    }
    if (section === 'skills') { out.skills.push(...strip(l).split(/\s*[,|•·;]\s*/).map((x) => x.trim()).filter((x) => x && x.length <= 60)); continue; }
    if (section === 'education') {
      const y = (l.match(/\b(19[89]\d|20[0-4]\d)\b/g) || []).pop() || '';
      const parts = strip(l).replace(/\s*[|,]\s*(19[89]\d|20[0-4]\d)(\s*[–—-]\s*(19[89]\d|20[0-4]\d))?\s*$/, '').split(/\s*[|,]\s*/);
      if (parts[0]) out.education.push({ qualification: parts[0], institution: parts.slice(1).join(', '), year: y });
      continue;
    }
    if (section === 'certifications') { out.certifications.push(strip(l)); continue; }
    if (extra) extra.lines.push(strip(l));
  }
  out.summary = summary.join(' ');
  if (!out.experience.length) { const ls = achievementLines(text); if (ls.length) out.experience.push({ title: 'Experience', employer: '', location: '', start: '', end: '', bullets: ls }); }
  return out;
}

/** Stable hash so we only re-structure when the draft changed. */
export function hashText(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return String(h >>> 0); }
