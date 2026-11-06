// Where a new line belongs in a CV draft. Pure functions; tested in Node.

const SECTION = /^(professional\s+|work\s+|employment\s+|technical\s+|core\s+|key\s+|relevant\s+)?(summary|profile|about( me)?|overview|personal statement|experience|history|career( history)?|skills|competencies|technologies|tech stack|expertise|education|qualifications|academic|certifications?|accreditations?|projects?|publications?|interests|hobbies|references|languages|awards|volunteering|training|courses|additional information|architecture frameworks)\b/i;
const EXPERIENCE = /^(professional\s+|work\s+|employment\s+|relevant\s+)?(experience|history|career( history)?)\b/i;
const SUMMARY = /^(professional\s+)?(summary|profile|about( me)?|overview|personal statement)\b/i;
const clean = (l) => l.replace(/[:#*_]/g, '').trim();
const words = (l) => l.trim().split(/\s+/).filter(Boolean).length;
const normalise = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

export const isSectionHeading = (l) => clean(l).length > 0 && clean(l).length < 60 && SECTION.test(clean(l));
/** A job-title / employer / dates line: short, with a year or "Present", and not a bullet. */
export const isRoleHeading = (l) => !isBullet(l) && words(l) <= 18 && /\b(19[89]\d|20[0-4]\d|present|current|to date)\b/i.test(l) && !/[.!?]$/.test(l.trim());
const isBullet = (l) => /^[•\-–—*▪◦●>]\s*/.test(l.trim());
const bulletPrefix = (l) => (l.trim().match(/^([•\-–—*▪◦●>]\s*)/) || [])[1] || '';

/**
 * Insert `line` into `draft` under the role whose heading matches `roleLine`.
 * Falls back to the end of the Experience section, then to the end of the document.
 * Returns { text, where } where `where` describes the placement for the UI.
 */
export function placeBullet(draft, line, roleLine) {
  const lines = draft.split('\n');
  let start = -1;
  if (roleLine) {
    const target = normalise(roleLine);
    start = lines.findIndex((l) => normalise(l) === target);
    if (start < 0) start = lines.findIndex((l) => normalise(l).includes(target));
    // Last resort: a role heading that is a prefix/part of what the model quoted (never a bare title line).
    if (start < 0) start = lines.findIndex((l) => isRoleHeading(l) && target.length > 20 && normalise(l).length > 12 && target.includes(normalise(l)));
  }
  if (start >= 0) {
    // Walk to the end of this role's block: stop at the next role heading or section heading.
    let end = start + 1;
    while (end < lines.length && !isRoleHeading(lines[end]) && !isSectionHeading(lines[end])) end++;
    let insertAt = end;
    while (insertAt > start + 1 && !lines[insertAt - 1].trim()) insertAt--; // before trailing blank lines
    const block = lines.slice(start + 1, insertAt);
    const prefix = bulletPrefix(block.find(isBullet) || '') || (block.some(isBullet) ? '• ' : '');
    lines.splice(insertAt, 0, prefix + line);
    return { text: lines.join('\n'), where: lines[start].trim() };
  }
  const exp = lines.findIndex((l) => clean(l).length < 60 && EXPERIENCE.test(clean(l)));
  if (exp >= 0) {
    let end = exp + 1;
    while (end < lines.length && !isSectionHeading(lines[end])) end++;
    let insertAt = end;
    while (insertAt > exp + 1 && !lines[insertAt - 1].trim()) insertAt--;
    const anyBullet = lines.slice(exp + 1, insertAt).find(isBullet);
    lines.splice(insertAt, 0, (anyBullet ? bulletPrefix(anyBullet) : '') + line);
    return { text: lines.join('\n'), where: 'end of your Experience section' };
  }
  return { text: draft.replace(/\s*$/, '') + '\n' + line, where: 'end of the draft' };
}

/** Insert a learning-goal line after the Summary paragraph; fall back to the end of the document. */
export function placeLearningLine(draft, line) {
  const lines = draft.split('\n');
  const sum = lines.findIndex((l) => clean(l).length < 60 && SUMMARY.test(clean(l)));
  if (sum >= 0) {
    let i = sum + 1;
    while (i < lines.length && !lines[i].trim()) i++;            // skip blanks after heading
    while (i < lines.length && lines[i].trim() && !isSectionHeading(lines[i])) i++; // to end of first paragraph
    lines.splice(i, 0, line);
    return { text: lines.join('\n'), where: 'after your Summary' };
  }
  return { text: draft.replace(/\s*$/, '') + '\n' + line, where: 'end of the draft' };
}
